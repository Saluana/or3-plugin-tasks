import { expect, test } from 'bun:test';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import { createTasksPlugin, TASKS_MANIFEST } from './client.mjs';
import { LEGACY_KEY, ROOT_KEY, taskFields, visibleTasks } from './tasks.mjs';
import { createTaskStore } from './store.mjs';

const docKey = (id) => `task-list-v2:${id}`;
const snapshot = (storage) => Object.fromEntries(storage);

test('interrupted migration never publishes an index with missing task documents', async () => {
  const legacy = { schemaVersion: 1, lists: [{ id: 'saved', title: 'Saved', tasks: [] }] };
  const values = new Map([[LEGACY_KEY, legacy]]);
  let fail = true;
  const storage = {
    get: async (key) => ({ ok: true, value: values.get(key) }),
    set: async (key, value) => {
      if (fail && key.startsWith('task-list-v2:')) return { ok: false };
      values.set(key, value);
      return { ok: true };
    },
    delete: async (key) => ({ ok: values.delete(key) }),
  };
  await expect(createTaskStore(storage).load()).rejects.toThrow('save');
  expect(values.has(ROOT_KEY)).toBe(false);
  expect(values.get(LEGACY_KEY)).toEqual(legacy);
  fail = false;
  const store = createTaskStore(storage);
  await store.load();
  expect(store.lists()[0].title).toBe('Saved');
  values.delete('task-list-v2:saved');
  await expect(createTaskStore(storage).load()).rejects.toThrow();
});

function sidebarItems(view) {
  return (view.navigation ?? []).filter((node) => node.type === 'item');
}

function itemRows(view) {
  const rows = [];
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.type === 'item') rows.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(view.nodes);
  return rows;
}

async function activate(storage, deny) {
  const host = createPortableTestHost({
    approvedGrants: TASKS_MANIFEST.requestedGrants,
    initialStorage: storage,
  });
  const client = deny
    ? {
        ...host.client,
        call: (method, ...args) =>
          method === deny
            ? Promise.resolve({ ok: false, code: 'permission-denied', message: 'denied' })
            : host.client.call(method, ...args),
      }
    : host.client;
  const plugin = createTasksPlugin(client);
  await createPortablePlugin(plugin.definition, { client, bootstrap: host.bootstrap }).ready;
  const send = (method, params) => host.invokeRequest(method, params);
  const unwrap = (response) => {
    if (!response.ok) throw new Error(response.message);
    return response.result;
  };
  // The UI handler never rejects: it reports failure inside its own result.
  const rail = async (action, values = {}, formId) =>
    unwrap(
      await send('runtime.ui-event', {
        action,
        values,
        ...(formId === undefined ? {} : { formId }),
      })
    );
  return {
    ...host,
    state: plugin.state,
    rail,
    act: async (action, values = {}, formId) => {
      const result = await rail(action, values, formId);
      if (result.ok !== true) throw new Error(result.message);
      return result;
    },
    send,
    tool: async (name, args = {}) => unwrap(await send('runtime.tool', { name, args })).result,
    view: () => host.renders[host.renders.length - 1],
  };
}

test('quick add, inspect, subtasks and completion persist across reloads', async () => {
  const h = await activate();
  expect(h.state.loaded).toBe(true);
  expect(h.state.lists).toHaveLength(1);

  expect(await h.act('tasks.quick-add', { quickTitle: 'Ship plugin' })).toMatchObject({
    ok: true,
    fieldValues: { quickTitle: '' },
  });
  const task = h.state.lists[0].tasks[0];
  expect(task).toMatchObject({ title: 'Ship plugin', status: 'todo', subtasks: [] });

  expect(await h.act(`tasks.open:${task.id}`)).toMatchObject({
    fieldValues: { title: 'Ship plugin', priority: 'none', label: 'none' },
  });
  await h.act('tasks.save-task', {
    title: 'Ship tested plugin',
    notes: 'Check staging',
    due: '2026-09-22',
    priority: 'high',
    label: 'work',
  });
  await h.act('tasks.sub-add', { subtask: 'Install' });
  const subtask = h.state.lists[0].tasks[0].subtasks[0];
  await h.act(`tasks.sub-toggle:${subtask.id}`);
  await h.act(`tasks.toggle:${task.id}`);

  const restored = await activate(snapshot(h.storage));
  expect(restored.state.lists[0].tasks[0]).toMatchObject({
    title: 'Ship tested plugin',
    notes: 'Check staging',
    due: '2026-09-22',
    priority: 'high',
    label: 'work',
    status: 'done',
    subtasks: [{ title: 'Install', done: true }],
  });
});

test('lists can be created, renamed, deleted and restored', async () => {
  const h = await activate();
  expect((await h.act('tasks.create-list', { newListTitle: 'Work' })).ok).toBe(true);
  expect(h.state.lists).toHaveLength(2);
  expect(h.state.listId).toBe(h.state.lists[1].id);

  await h.act('tasks.rename-list', { listTitle: 'Home' });
  expect(h.state.lists[1].title).toBe('Home');

  await h.act('tasks.ask-delete-list');
  expect(h.state.lists).toHaveLength(2);
  await h.act('tasks.cancel-delete');
  expect(await h.rail('tasks.confirm-delete')).toMatchObject({ ok: false });

  await h.act('tasks.ask-delete-list');
  await h.act('tasks.confirm-delete');
  expect(h.state.lists).toHaveLength(1);

  await h.act('tasks.undo');
  expect(h.state.lists.map((entry) => entry.title)).toContain('Home');
  expect(h.state.lists[1].title).toBe('Home');
});

test('a committed list deletion stays successful when orphan cleanup fails and retries after reload', async () => {
  const h = await activate(undefined, 'storage.delete');
  await h.act('tasks.create-list', { newListTitle: 'Temporary' });
  const removedId = h.state.listId;
  await h.act('tasks.ask-delete-list');

  const result = await h.rail('tasks.confirm-delete');
  expect(result.ok).toBe(true);
  expect(h.state.lists.some((list) => list.id === removedId)).toBe(false);
  expect(h.state.error).toBe('');
  expect(h.state.cleanupNotice).toContain('cleanup will retry');
  expect(h.storage.get(ROOT_KEY).cleanupPending).toContain(removedId);
  expect(h.storage.has(docKey(removedId))).toBe(true);

  await h.act('tasks.create-list', { newListTitle: 'Another' });
  expect(h.state.notice).toContain('Another');
  expect(h.state.cleanupNotice).toContain('cleanup will retry');

  const restored = await activate(snapshot(h.storage));
  expect(restored.state.lists.some((list) => list.id === removedId)).toBe(false);
  expect(restored.storage.has(docKey(removedId))).toBe(false);
  expect(restored.storage.get(ROOT_KEY).cleanupPending).toEqual([]);
});

test('switching lists cancels a pending deletion', async () => {
  const h = await activate();
  await h.act('tasks.create-list', { newListTitle: 'Second' });
  const second = h.state.lists[1].id;
  await h.act(`navigation.open:${h.state.lists[0].id}`);
  await h.act('tasks.ask-delete-list');
  expect(h.state.pending).toMatchObject({ kind: 'list' });
  await h.act(`navigation.open:${second}`);
  expect(h.state.pending).toBeNull();
  expect((await h.rail('tasks.confirm-delete')).ok).toBe(false);
  expect(h.state.lists).toHaveLength(2);
});

test('migrates the 0.2.0 blob without disturbing it', async () => {
  const legacy = {
    schemaVersion: 1,
    lists: [
      {
        id: 'list-legacy',
        title: 'Migrated',
        tasks: [
          {
            id: 'task-legacy',
            title: 'Old task',
            notes: 'Legacy notes',
            due: '2026-01-05',
            label: 'uncategorized',
            difficulty: '5',
            status: 'doing',
            subtasks: [{ id: 'sub-legacy', title: 'Old step', done: true }],
          },
        ],
      },
    ],
  };
  const h = await activate({ [LEGACY_KEY]: legacy });
  expect(h.state.lists[0].title).toBe('Migrated');
  expect(h.state.lists[0].tasks[0]).toMatchObject({
    id: 'task-legacy',
    title: 'Old task',
    priority: 'high',
    label: 'none',
    status: 'doing',
    subtasks: [{ title: 'Old step', done: true }],
  });
  // The old key stays readable so a rollback to 0.2.0 still finds the data.
  expect(h.storage.get(LEGACY_KEY)).toEqual(legacy);
  expect(h.storage.get(ROOT_KEY)).toMatchObject({ schemaVersion: 2 });
  expect(h.storage.get(docKey('list-legacy')).tasks).toHaveLength(1);
});

test('refuses corrupt data and denied storage without overwriting', async () => {
  const broken = { schemaVersion: 99, lists: [] };
  const h = await activate({ [ROOT_KEY]: broken });
  expect(h.state.error).toBeTruthy();
  expect((await h.rail('tasks.quick-add', { quickTitle: 'Nope' })).ok).toBe(false);
  expect(h.storage.get(ROOT_KEY)).toEqual(broken);

  const denied = await activate(undefined, 'storage.set');
  expect(denied.state.loaded).toBe(false);
  expect(denied.storage.has(ROOT_KEY)).toBe(false);

  const unreadable = await activate(undefined, 'storage.get');
  expect(unreadable.state.loaded).toBe(false);
  expect(unreadable.state.error).toBeTruthy();
});

test('validates task input and enforces storage limits', async () => {
  expect(() => taskFields({ title: '' })).toThrow();
  expect(() => taskFields({ title: 'x', due: '2026-02-30' })).toThrow();
  expect(() => taskFields({ title: 'x', priority: 'urgent' })).toThrow();

  const h = await activate();
  expect((await h.rail('tasks.quick-add', { quickTitle: 'x'.repeat(161) })).ok).toBe(false);
  expect(h.state.lists[0].tasks).toHaveLength(0);

  const tooMany = {
    [ROOT_KEY]: {
      schemaVersion: 2,
      lists: Array.from({ length: 41 }, (_, index) => ({
        id: `list-${index}`,
        title: 'List',
        color: 'blue',
      })),
    },
  };
  const overflow = await activate(tooMany);
  expect(overflow.state.error).toBeTruthy();
});

test('search, filter and sort helpers do not mutate their input', async () => {
  const tasks = [
    { title: 'A', notes: 'urgent', label: 'work', priority: 'low', status: 'todo', due: '' },
    { title: 'B', notes: '', label: 'home', priority: 'high', status: 'done', due: '2026-09-20' },
    { title: 'C', notes: '', label: 'work', priority: 'high', status: 'todo', due: '2026-09-19' },
  ];
  expect(visibleTasks(tasks, 'urgent', 'all', 'manual')).toEqual([tasks[0]]);
  expect(visibleTasks(tasks, '', 'open', 'priority').map((task) => task.title)).toEqual(['C', 'A']);
  expect(visibleTasks(tasks, '', 'all', 'title')[0].title).toBe('A');
  expect(tasks.map((task) => task.title)).toEqual(['A', 'B', 'C']);
});

test('the chat tools operate on the same store as the interface', async () => {
  const h = await activate();
  const listId = h.state.lists[0].id;

  const tools = (await h.invokeRequest('runtime.tools', {})).result;
  expect(tools.map((entry) => entry.function.name)).toContain('or3sal_tasks_add_item');

  const added = await h.tool('or3sal_tasks_add_item', {
    listId,
    title: 'From chat',
    priority: 'medium',
  });
  expect(h.state.lists[0].tasks[0]).toMatchObject({ title: 'From chat', priority: 'medium' });

  await h.act('tasks.quick-add', { quickTitle: 'From the pane' });
  const found = await h.tool('or3sal_tasks_search_lists', { query: 'from' });
  expect(found.lists[0].tasks.map((task) => task.title).sort()).toEqual([
    'From chat',
    'From the pane',
  ]);
  const foundByList = await h.tool('or3sal_tasks_search_lists', {
    query: h.state.lists[0].title,
  });
  expect(foundByList.lists[0].tasks.map((task) => task.title).sort()).toEqual([
    'From chat',
    'From the pane',
  ]);

  await h.tool('or3sal_tasks_update_item', { listId, taskId: added.id, status: 'done' });
  expect(h.state.lists[0].tasks.find((task) => task.id === added.id).status).toBe('done');

  await h.tool('or3sal_tasks_reorganize', {
    listId,
    taskIds: h.state.lists[0].tasks.map((task) => task.id).reverse(),
  });
  expect(h.state.lists[0].tasks.map((task) => task.title)).toEqual([
    'From chat',
    'From the pane',
  ]);

  await h.tool('or3sal_tasks_create_subtask', { listId, taskId: added.id, title: 'Chat step' });
  const sub = h.state.lists[0].tasks.find((task) => task.id === added.id).subtasks[0];
  await h.tool('or3sal_tasks_complete_subtask', {
    listId,
    taskId: added.id,
    subtaskId: sub.id,
    done: true,
  });
  expect(h.state.lists[0].tasks.find((task) => task.id === added.id).subtasks[0].done).toBe(true);

  expect((await h.send('runtime.tool', { name: 'or3sal_tasks_nope', args: {} })).ok).toBe(false);
  expect(
    (
      await h.send('runtime.tool', {
        name: 'or3sal_tasks_add_item',
        args: { listId: 'missing', title: 'x' },
      })
    ).ok
  ).toBe(false);
});

test('the sidebar and pane render lists, counts and expandable subtasks', async () => {
  const h = await activate();
  await h.act('tasks.quick-add', { quickTitle: 'Parent' });
  const task = h.state.lists[0].tasks[0];
  await h.act(`tasks.open:${task.id}`);
  await h.act('tasks.sub-add', { subtask: 'Step one' });

  const view = h.view();
  const sidebar = sidebarItems(view);
  expect(sidebar.some((node) => node.selected && node.meta === '1')).toBe(true);
  expect(view.key).toBe(h.state.listId);

  const row = itemRows(view).find((node) => node.id === `task-${task.id}`);
  expect(row).toMatchObject({
    checked: false,
    selected: true,
    expandAction: `tasks.expand:${task.id}`,
  });
  expect(row.children).toBeUndefined();

  await h.act(`tasks.expand:${task.id}`);
  const expanded = itemRows(h.view()).find((node) => node.id === `task-${task.id}`);
  expect(expanded.expanded).toBe(true);
  expect(expanded.children.map((child) => child.label)).toEqual(['Step one']);
});

test('a full workspace renders inside the host budgets', async () => {
  // The test host validates every render (identifiers, per-string bytes, the
  // whole-tree text/node/item ceilings), so loading and rendering this tree is
  // the assertion: a product-sized surface must not be refused by the host.
  const lists = Array.from({ length: 40 }, (_, index) => ({
    id: `list-${index}`,
    title: `List ${index}`,
    color: 'blue',
  }));
  const tasks = Array.from({ length: 30 }, (_, index) => ({
    id: `task-${index}`,
    ...taskFields({ title: 'T'.repeat(160), notes: 'N'.repeat(200) }),
    status: index % 3 === 0 ? 'done' : 'todo',
    subtasks: Array.from({ length: 2 }, (_, step) => ({
      id: `sub-${index}-${step}`,
      title: 'S'.repeat(100),
      done: false,
    })),
  }));
  const storage = {
    [ROOT_KEY]: { schemaVersion: 2, lists },
    ...Object.fromEntries(
      lists.map((list) => [docKey(list.id), { id: list.id, tasks: list.id === 'list-0' ? tasks : [] }])
    ),
  };

  const h = await activate(storage);
  expect(h.state.error).toBe('');
  expect(h.state.lists).toHaveLength(40);
  expect(h.state.lists[0].tasks).toHaveLength(30);
  expect(sidebarItems(h.view())).toHaveLength(40);
  expect(itemRows(h.view()).length).toBeGreaterThanOrEqual(30);

  await h.act(`tasks.open:task-0`);
  await h.act(`tasks.expand:task-0`);
  expect(h.state.error).toBe('');
});

test('refuses chat tools when the workspace has not approved them', async () => {
  const host = createPortableTestHost({ approvedGrants: ['storage.read', 'storage.write'] });
  const plugin = createTasksPlugin(host.client);
  await createPortablePlugin(plugin.definition, {
    client: host.client,
    bootstrap: host.bootstrap,
  }).ready;
  const response = await host.invokeRequest('runtime.tool', {
    name: 'or3sal_tasks_add_item',
    args: { listId: 'default-list', title: 'Nope' },
  });
  expect(response).toMatchObject({ ok: false });
  expect(plugin.state.lists[0].tasks).toHaveLength(0);
});
