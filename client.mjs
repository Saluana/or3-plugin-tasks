import { createPortableClient, createPortablePlugin, defineOr3Plugin, definePortableUi, ui } from '@or3/plugin-sdk';
import { TASKS_MANIFEST } from './manifest.mjs';
import { createTaskStore } from './store.mjs';
import {
  LABELS,
  LABEL_TITLES,
  PAGE_SIZE,
  PRIORITIES,
  STATUSES,
  STATUS_TITLES,
  dueBadge,
  listSummary,
  newId,
  openCount,
  priorityBadge,
  taskFields,
  text,
  todayStamp,
  visibleTasks,
} from './tasks.mjs';
import { TASK_TOOLS } from './tools.mjs';
export { TASKS_MANIFEST };

/**
 * The workspace surface. Three regions, every one rendered by the host from the
 * declarative tree this module returns:
 * - the sidebar contributes the list navigation (`sidebarNodes`),
 * - the pane's wide column is the selected list,
 * - the pane's narrow column is the inspector for the selected task.
 *
 * The same validated store backs the chat tools, so a task edited in chat is the
 * task rendered here.
 */
const PRIORITY_TITLES = Object.freeze({
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
});
const FILTERS = Object.freeze([
  { value: 'all', label: 'All tasks' },
  { value: 'open', label: 'Open tasks' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'todo', label: 'Not started' },
  { value: 'doing', label: 'In progress' },
  { value: 'done', label: 'Completed' },
]);
const SORTS = Object.freeze([
  { value: 'manual', label: 'Manual order' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
]);
const preview = (value, limit = 90) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);
const muted = (value) => ({ type: 'text', text: value, tone: 'muted' });
const choice = (values, titles) => values.map((value) => ({ value, label: titles?.[value] ?? value }));

export function createTasksPlugin(client = createPortableClient()) {
  const state = {
    loaded: false,
    lists: [],
    listId: '',
    selectedId: '',
    drafting: false,
    query: '',
    filter: 'all',
    sort: 'manual',
    shown: PAGE_SIZE,
    expanded: new Set(),
    error: '',
    notice: '',
    cleanupNotice: '',
    undo: null,
    pending: null,
    listSettings: false,
    addingList: false,
    busy: false,
  };
  let context;
  let store;

  const today = () => todayStamp();
  const currentList = () => state.lists.find((entry) => entry.id === state.listId) ?? null;
  const selectedTask = () => currentList()?.tasks.find((task) => task.id === state.selectedId) ?? null;

  /** Re-read the store into render state and retire selections that vanished. */
  function sync() {
    state.lists = store.lists();
    if (!state.lists.some((entry) => entry.id === state.listId)) {
      state.listId = state.lists[0]?.id ?? '';
      state.expanded.clear();
      state.listSettings = false;
      state.addingList = false;
      state.pending = null;
      state.undo = null;
    }
    if (!selectedTask()) state.selectedId = '';
  }

  /** The inspector editor ids, seeded from the task currently on screen. */
  function editorValues(task) {
    if (!task) return { title: '', notes: '', due: '', priority: 'none', label: 'none' };
    return {
      title: task.title,
      notes: task.notes,
      due: task.due,
      priority: task.priority,
      label: task.label,
    };
  }

  function badgesOf(task) {
    const badges = [];
    const due = dueBadge(task.due, today());
    if (due) badges.push(due);
    const priority = priorityBadge(task.priority);
    if (priority) badges.push(priority);
    if (task.label !== 'none') {
      badges.push({ label: LABEL_TITLES[task.label] ?? task.label, tone: 'neutral' });
    }
    return badges.slice(0, 4);
  }

  function sidebarNodes() {
    const nodes = [
      ui.row(
        ui.col(
          'fill',
          ui.heading('My Lists', {
            level: 3,
            description: state.loaded
              ? `${state.lists.length} ${state.lists.length === 1 ? 'list' : 'lists'}`
              : undefined,
          })
        ),
        ui.button('toggle-new-list', 'New list', 'tasks.toggle-new-list', {
          icon: 'plus',
          iconOnly: true,
          disabled: state.busy,
        })
      ),
    ];
    if (!state.loaded) return nodes;
    for (const list of state.lists) {
      nodes.push(
        ui.item({
          id: `list-${list.id}`,
          label: preview(list.title, 40),
          meta: String(openCount(list.tasks)),
          selected: list.id === state.listId,
          color: list.color,
          action: `navigation.open:${list.id}`,
        })
      );
    }
    if (state.addingList) {
      nodes.push(
        ui.form(
          'new-list',
          [
            ui.textField('newListTitle', '', { placeholder: 'List name', required: true }),
            ui.button('create-list', 'Create list', 'tasks.create-list', {
              variant: 'primary',
              submit: true,
              disabled: state.busy,
            }),
            ui.button('cancel-new-list', 'Cancel', 'tasks.cancel-new-list', { disabled: state.busy }),
          ],
          { layout: 'plain' }
        )
      );
    }
    return nodes;
  }

  function toolbar() {
    return ui.row(
      ui.col(
        'fill',
        ui.form(
          'search',
          [
            ui.textField('query', '', {
              value: state.query,
              search: true,
              placeholder: 'Search tasks…',
              // Filtering runs while the user types, so the toolbar needs no
              // separate submit command next to the field.
              onChange: 'tasks.search',
            }),
          ],
          { layout: 'inline' }
        )
      ),
      ui.col('sm', ui.select('filter', 'Filter', FILTERS, { value: state.filter, onChange: 'tasks.toolbar' })),
      ui.col('sm', ui.select('sort', 'Sort', SORTS, { value: state.sort, onChange: 'tasks.toolbar' })),
      ui.button('new-task', 'New task', 'tasks.new-task', { icon: 'plus', variant: 'primary', disabled: state.busy })
    );
  }

  function subtaskRows(task) {
    return task.subtasks.map((subtask) =>
      ui.item({
        id: `sub-${subtask.id}`,
        label: preview(subtask.title, 100),
        checked: subtask.done,
        action: `tasks.sub-toggle:${subtask.id}`,
      })
    );
  }

  function taskRow(task) {
    const steps = task.subtasks.length
      ? `${task.subtasks.filter((subtask) => subtask.done).length}/${task.subtasks.length} steps`
      : '';
    const row = {
      id: `task-${task.id}`,
      label: preview(task.title, 120),
      checked: task.status === 'done',
      selected: task.id === state.selectedId,
      action: `tasks.toggle:${task.id}`,
      detailAction: `tasks.open:${task.id}`,
      badges: badgesOf(task),
      meta: steps,
    };
    if (!task.subtasks.length) return ui.item(row);
    const expanded = state.expanded.has(task.id);
    return ui.item({
      ...row,
      expandAction: `tasks.expand:${task.id}`,
      expanded,
      ...(expanded ? { children: subtaskRows(task) } : {}),
    });
  }

  function listColumn(current) {
    const summary = listSummary(current.tasks, today());
    const tasks = visibleTasks(current.tasks, state.query, state.filter, state.sort, today());
    const visible = tasks.slice(0, state.shown);
    const nodes = [
      ui.row(
        ui.col(
          'fill',
          ui.heading(current.title, {
            meta: today(),
            description: summary.total
              ? `${summary.total} ${summary.total === 1 ? 'task' : 'tasks'} · ${
                  summary.overdue ? `${summary.overdue} overdue · ` : ''
                }${summary.open} open`
              : 'No tasks yet',
          })
        ),
        ui.button('list-settings', 'List settings', 'tasks.list-settings', { icon: 'settings', iconOnly: true, disabled: state.busy })
      ),
    ];
    if (state.listSettings) {
      nodes.push(
        ui.box(
          ui.heading('List settings', { level: 3 }),
          ui.form(
            'list-form',
            [
              ui.textField('listTitle', 'List name', { value: current.title, required: true }),
              ui.button('rename-list', 'Save name', 'tasks.rename-list', {
                variant: 'primary',
                submit: true,
                disabled: state.busy,
              }),
              ui.button('delete-list', 'Delete list', 'tasks.ask-delete-list', {
                variant: 'danger',
                disabled: state.busy,
              }),
            ],
            { layout: 'plain' }
          )
        )
      );
    }
    nodes.push(toolbar());
    if (summary.total) {
      nodes.push(
        ui.progress(summary.done, {
          max: summary.total,
          label: `${summary.done} of ${summary.total} complete`,
        })
      );
    }
    nodes.push(ui.divider());
    if (visible.length) nodes.push(...visible.map(taskRow));
    else {
      nodes.push(
        muted(
          current.tasks.length
            ? 'No tasks match this search or filter.'
            : 'No tasks yet — add the first one below.'
        )
      );
    }
    if (tasks.length > visible.length) {
      nodes.push(
        ui.button(
          'show-more',
          `Show ${Math.min(PAGE_SIZE, tasks.length - visible.length)} more`,
          'tasks.more',
          { disabled: state.busy }
        )
      );
    }
    nodes.push(
      ui.form(
        'quick-add',
        [
          ui.textField('quickTitle', '', { value: '', placeholder: 'Add another task' }),
          ui.button('quick-add', 'Add task', 'tasks.quick-add', {
            icon: 'plus',
            iconOnly: true,
            variant: 'primary',
            submit: true,
            disabled: state.busy,
          }),
        ],
        { layout: 'inline' }
      )
    );
    return nodes;
  }

  function inspectorColumn() {
    const task = selectedTask();
    if (!task && !state.drafting) {
      return [];
    }
    const draft = state.drafting || !task;
    const steps = draft ? [] : task.subtasks;
    const nodes = [
      ui.row(ui.col('fill', ui.heading(draft ? 'New task' : preview(task.title, 70), {
        level: 2,
        ...(draft ? {} : { meta: STATUS_TITLES[task.status] }),
      })), ui.button('close-details', 'Close details', 'tasks.close-details', { icon: 'x', iconOnly: true })),
    ];
    const badges = draft ? [] : badgesOf(task);
    if (badges.length) {
      nodes.push(ui.row(...badges.map((badge) => ui.badge(badge.label, badge.tone))));
    }
    nodes.push(ui.divider());
    nodes.push(
      ui.column(
        ui.textField('title', 'Title', { value: draft ? '' : task.title, required: true }),
        ui.textarea('notes', 'Notes', {
          value: draft ? '' : task.notes,
          rows: 4,
          placeholder: 'Add notes…',
        }),
        ui.textField('due', 'Due date', {
          value: draft ? '' : task.due,
          placeholder: 'YYYY-MM-DD',
          date: true,
        }),
        ui.select('priority', 'Priority', choice(PRIORITIES, PRIORITY_TITLES), {
          value: draft ? 'none' : task.priority,
        }),
        ui.select('label', 'Label', choice(LABELS, LABEL_TITLES), {
          value: draft ? 'none' : task.label,
        }),
        ui.row(
          ui.button('save-task', draft ? 'Create task' : 'Save changes', 'tasks.save-task', {
            variant: 'primary',
            disabled: state.busy,
          }),
          draft
            ? ui.button('cancel-draft', 'Cancel', 'tasks.cancel-draft', { disabled: state.busy })
            : ui.button('ask-delete-task', 'Delete', 'tasks.ask-delete-task', {
                variant: 'danger',
                disabled: state.busy,
              })
        )
      )
    );
    if (draft) return nodes;
    nodes.push(ui.divider());
    nodes.push(
      ui.heading('Subtasks', {
        level: 3,
        ...(steps.length
          ? { meta: `${steps.filter((subtask) => subtask.done).length}/${steps.length} done` }
          : {}),
      })
    );
    nodes.push(...(steps.length ? subtaskRows(task) : [muted('No subtasks yet.')]));
    nodes.push(
      ui.form(
        'sub-add',
        [
          ui.textField('subtask', '', { placeholder: 'Add a subtask' }),
          ui.button('add-subtask', 'Add subtask', 'tasks.sub-add', {
            icon: 'plus',
            iconOnly: true,
            submit: true,
            disabled: state.busy,
          }),
        ],
        { layout: 'inline' }
      )
    );
    return nodes;
  }

  /** Destructive work always shows what it will remove, or how to reverse it. */
  function banner() {
    if (state.pending) {
      const what =
        state.pending.kind === 'list'
          ? 'this list, its tasks and their subtasks'
          : 'this task and its subtasks';
      return ui.box(
        { type: 'text', text: `Delete ${what}?`, tone: 'warning' },
        ui.row(
          ui.button('confirm-delete', 'Delete', 'tasks.confirm-delete', {
            variant: 'danger',
            disabled: state.busy,
          }),
          ui.button('cancel-delete', 'Keep it', 'tasks.cancel-delete', { disabled: state.busy })
        )
      );
    }
    if (!state.undo) return null;
    return ui.box(
      ui.row(
        { type: 'text', text: state.undo.message },
        ui.button('undo', 'Undo', 'tasks.undo', { disabled: state.busy })
      )
    );
  }

  function render() {
    const nodes = [];
    if (state.error) nodes.push({ type: 'text', text: state.error, tone: 'danger' });
    if (state.notice) nodes.push({ type: 'text', text: state.notice, tone: 'success' });
    if (state.cleanupNotice) nodes.push({ type: 'text', text: state.cleanupNotice, tone: 'warning' });
    const bannerNode = banner();
    if (bannerNode) nodes.push(bannerNode);
    if (!state.loaded) {
      nodes.push(ui.heading('Tasks'), muted(state.error || 'Loading your task lists…'));
      if (state.error) {
        nodes.push(ui.button('retry', 'Retry', 'tasks.reload', { variant: 'primary' }));
      }
    } else if (!currentList()) {
      nodes.push(ui.heading('Tasks'), muted('Create a list in the sidebar to get started.'));
    } else {
      const inspector = inspectorColumn();
      nodes.push({ ...ui.cols(ui.col('lg', ...listColumn(currentList())),
        ...(inspector.length ? [ui.col('md', ...inspector)] : [])), layout: 'workspace' });
    }
    context.render(
      definePortableUi({
        title: 'OR3 Tasks',
        key: state.listId,
        nodes,
        navigation: sidebarNodes(),
      })
    );
  }

  /** Sync after the index commit; orphan cleanup is retryable maintenance. */
  async function save(change) {
    if (state.busy) throw new Error('A save is already in progress.');
    state.busy = true;
    try {
      const outcome = await store.mutate(change);
      sync();
      state.cleanupNotice = store.pendingCleanupCount() > 0
        ? 'Old list data could not be removed; cleanup will retry when tasks reload or you save again.'
        : '';
      return outcome;
    } finally {
      state.busy = false;
    }
  }

  async function handleTool(name, args) {
    if (!TASK_TOOLS.some((entry) => entry.function.name === name)) {
      throw new Error('Unknown Tasks tool.');
    }
    const operation = name.slice('or3sal_tasks_'.length);
    if (operation === 'search_lists') {
      const query = text(args.query ?? '', 160).toLowerCase();
      return {
        lists: state.lists
          .map((entry) => {
            const titleMatches = entry.title.toLowerCase().includes(query);
            return {
              ...entry,
              // A list-title match is a lookup for that list, so return its
              // complete task snapshot. Task-text searches stay filtered.
              tasks: !query || titleMatches
                ? entry.tasks
                : entry.tasks.filter((task) =>
                    `${task.title} ${task.notes}`.toLowerCase().includes(query)
                  ),
            };
          })
          .filter(
            (entry) => !query || entry.title.toLowerCase().includes(query) || entry.tasks.length > 0
          ),
      };
    }
    return save(({ root, documents }) => {
      const requireList = (listId) => {
        const entry = root.lists.find((list) => list.id === listId);
        if (!entry) throw new Error('Task list not found. Search lists to get its current ID.');
        return entry;
      };
      const requireDocument = (listId) => {
        requireList(listId);
        const document = documents.get(listId);
        if (!document) throw new Error('Task list not found.');
        return document;
      };
      if (operation === 'create_list') {
        const list = { id: newId(), title: text(args.title, 80, true), color: 'blue' };
        root.lists.push(list);
        documents.set(list.id, { id: list.id, tasks: [] });
        return list;
      }
      if (operation === 'update_list') {
        const list = requireList(args.listId);
        list.title = text(args.title, 80, true);
        return list;
      }
      if (operation === 'delete_list') {
        const list = requireList(args.listId);
        root.lists = root.lists.filter((entry) => entry.id !== list.id);
        documents.delete(list.id);
        return { deleted: list.id };
      }
      const document = requireDocument(args.listId);
      if (operation === 'add_item') {
        const task = { id: newId(), ...taskFields(args), status: 'todo', subtasks: [] };
        document.tasks.push(task);
        return task;
      }
      if (operation === 'reorganize') {
        const ids = args.taskIds;
        const complete =
          Array.isArray(ids) &&
          ids.length === document.tasks.length &&
          new Set(ids).size === ids.length &&
          ids.every((id) => document.tasks.some((task) => task.id === id));
        if (!complete) throw new Error('Include every task ID of this list exactly once.');
        document.tasks = ids.map((id) => document.tasks.find((task) => task.id === id));
        return { ordered: ids };
      }
      const task = document.tasks.find((entry) => entry.id === args.taskId);
      if (!task) throw new Error('Task not found. Search lists to get its current ID.');
      if (operation === 'update_item') {
        Object.assign(task, taskFields({ ...task, ...args, title: args.title ?? task.title }));
        if (args.status !== undefined) {
          if (!STATUSES.includes(args.status)) throw new Error('Choose a valid status.');
          task.status = args.status;
        }
        return task;
      }
      if (operation === 'remove_item') {
        document.tasks = document.tasks.filter((entry) => entry.id !== task.id);
        return { deleted: task.id };
      }
      if (operation === 'create_subtask') {
        const subtask = { id: newId(), title: text(args.title, 160, true), done: false };
        task.subtasks.push(subtask);
        return subtask;
      }
      const subtask = task.subtasks.find((entry) => entry.id === args.subtaskId);
      if (!subtask) throw new Error('Subtask not found.');
      if (operation === 'complete_subtask') {
        if (typeof args.done !== 'boolean') throw new Error('done must be a boolean.');
        subtask.done = args.done;
        return subtask;
      }
      if (operation === 'remove_subtask') {
        task.subtasks = task.subtasks.filter((entry) => entry.id !== subtask.id);
        return { deleted: subtask.id };
      }
      throw new Error('Unknown Tasks tool.');
    });
  }

  async function runTool({ name, args = {} } = {}) {
    if (!context.grants.has('tools.register.client')) {
      throw new Error('Chat tools were not approved for this workspace.');
    }
    if (!state.loaded) throw new Error('Task storage is unavailable.');
    const result = await handleTool(name, args ?? {});
    render();
    return { ok: true, result };
  }

  async function handle(params = {}) {
    const action = typeof params.action === 'string' ? params.action : '';
    const formId = typeof params.formId === 'string' ? params.formId : '';
    const values = params.values ?? {};
    state.error = '';
    state.notice = '';
    try {
      if (action === 'tasks.reload' || action === 'host.first-action.run') {
        await load();
        render();
        return { ok: true, fieldValues: editorValues(selectedTask()) };
      }
      if (!state.loaded) throw new Error('Load your saved tasks before editing.');
      const list = currentList();
      const task = selectedTask();

      // Search, filter and sort apply together, so one toolbar action is enough.
      if (action === 'tasks.toolbar') {
        if (FILTERS.some((entry) => entry.value === values.filter)) state.filter = values.filter;
        if (SORTS.some((entry) => entry.value === values.sort)) state.sort = values.sort;
        if (typeof values.query === 'string') state.query = text(values.query, 160);
        state.shown = PAGE_SIZE;
        render();
        return { ok: true };
      }
      if (action === 'tasks.search' || (action === 'submit' && formId === 'search')) {
        state.query = text(values.query ?? '', 160);
        state.shown = PAGE_SIZE;
        render();
        return { ok: true };
      }
      if (action === 'tasks.more') {
        state.shown += PAGE_SIZE;
        render();
        return { ok: true };
      }
      if (action === 'tasks.quick-add' || (action === 'submit' && formId === 'quick-add')) {
        if (!list) throw new Error('Create a list in the sidebar before adding a task.');
        const title = text(values.quickTitle, 160, true);
        await save(({ documents }) => {
          const document = documents.get(list.id);
          if (!document) throw new Error('That list no longer exists.');
          document.tasks.unshift({
            id: newId(),
            ...taskFields({ title }),
            status: 'todo',
            subtasks: [],
          });
        });
        state.notice = 'Task added.';
        render();
        return { ok: true, fieldValues: { quickTitle: '' } };
      }

      if (action === 'tasks.create-list' || (action === 'submit' && formId === 'new-list')) {
        const title = text(values.newListTitle, 80, true);
        const created = await save(({ root, documents }) => {
          const list = { id: newId(), title, color: 'blue' };
          root.lists.push(list);
          documents.set(list.id, { id: list.id, tasks: [] });
          return list;
        });
        state.listId = created.id;
        state.addingList = false;
        state.notice = `List “${created.title}” created.`;
        render();
        return { ok: true, fieldValues: { newListTitle: '', listTitle: created.title } };
      }
      if (action === 'tasks.toggle-new-list') {
        state.addingList = !state.addingList;
        render();
        return { ok: true, fieldValues: { newListTitle: '' } };
      }
      if (action === 'tasks.cancel-new-list') {
        state.addingList = false;
        render();
        return { ok: true, fieldValues: { newListTitle: '' } };
      }
      if ((action === 'tasks.rename-list' || (action === 'submit' && formId === 'list-form')) && list) {
        const title = text(values.listTitle, 80, true);
        await save(({ root }) => {
          const target = root.lists.find((entry) => entry.id === list.id);
          if (!target) throw new Error('That list no longer exists.');
          target.title = title;
        });
        state.notice = 'List renamed.';
        render();
        return { ok: true, fieldValues: { listTitle: title } };
      }
      if (action === 'tasks.list-settings') {
        state.listSettings = !state.listSettings;
        render();
        return { ok: true, fieldValues: { listTitle: list?.title ?? '' } };
      }

      if (action === 'tasks.new-task') {
        state.drafting = true;
        state.selectedId = '';
        state.pending = null;
        render();
        return { ok: true, fieldValues: editorValues(null) };
      }
      if (action === 'tasks.cancel-draft') {
        state.drafting = false;
        render();
        return { ok: true };
      }
      if (action === 'tasks.close-details') {
        state.selectedId = '';
        state.drafting = false;
        state.pending = null;
        render();
        return { ok: true };
      }
      // Sidebar rows are list selectors: choosing one focuses the pane on that
      // list and drops any selection or confirmation that belonged to the old
      // list. The host focuses the plugin pane alongside this state change.
      if (action.startsWith('navigation.open:')) {
        const id = action.slice('navigation.open:'.length);
        if (!state.lists.some((entry) => entry.id === id)) {
          throw new Error('That task list no longer exists.');
        }
        state.listId = id;
        state.selectedId = '';
        state.drafting = false;
        state.listSettings = false;
        state.pending = null;
        state.expanded.clear();
        state.shown = PAGE_SIZE;
        render();
        return { ok: true, fieldValues: editorValues(null) };
      }
      if (action.startsWith('tasks.open:')) {
        const id = action.slice('tasks.open:'.length);
        const opened = list?.tasks.find((entry) => entry.id === id);
        if (!opened) throw new Error('That task is no longer in this list.');
        state.selectedId = id;
        state.drafting = false;
        state.pending = null;
        render();
        return { ok: true, fieldValues: editorValues(opened) };
      }
      if (action.startsWith('tasks.expand:')) {
        const id = action.slice('tasks.expand:'.length);
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        render();
        return { ok: true };
      }

      if (action === 'tasks.save-task') {
        const fields = taskFields({
          title: values.title,
          notes: values.notes,
          due: values.due,
          priority: values.priority,
          label: values.label,
        });
        if (state.drafting) {
          if (!list) throw new Error('Select a list before adding a task.');
          const created = await save(({ documents }) => {
            const document = documents.get(list.id);
            if (!document) throw new Error('That list no longer exists.');
            const task = { id: newId(), ...fields, status: 'todo', subtasks: [] };
            document.tasks.push(task);
            return task;
          });
          state.drafting = false;
          state.selectedId = created.id;
          state.notice = 'Task created.';
          render();
          return { ok: true, fieldValues: editorValues(created) };
        }
        if (!task) throw new Error('Select a task before saving changes.');
        await save(({ documents }) => {
          const target = documents.get(list.id)?.tasks.find((entry) => entry.id === task.id);
          if (!target) throw new Error('That task is no longer in this list.');
          Object.assign(target, fields);
        });
        state.notice = 'Changes saved.';
        render();
        return { ok: true, fieldValues: editorValues({ ...task, ...fields }) };
      }
      if (action.startsWith('tasks.toggle:')) {
        const id = action.slice('tasks.toggle:'.length);
        await save(({ documents }) => {
          const target = documents.get(list.id)?.tasks.find((entry) => entry.id === id);
          if (!target) throw new Error('That task is no longer in this list.');
          target.status = target.status === 'done' ? 'todo' : 'done';
        });
        render();
        return { ok: true };
      }

      // Deleting a list is list-scoped, so it must not require a selected task.
      if (action === 'tasks.ask-delete-list') {
        if (!list) throw new Error('Select a list first.');
        state.pending = { kind: 'list', id: list.id };
        render();
        return { ok: true };
      }

      // Resolving, cancelling and undoing a deletion is not task-scoped: a
      // pending list deletion must stay confirmable with nothing selected.
      const taskScoped =
        action !== 'tasks.cancel-delete' &&
        action !== 'tasks.confirm-delete' &&
        action !== 'tasks.undo';
      if (taskScoped && !task) throw new Error('Select a task first.');
      if (action === 'tasks.sub-add' || (action === 'submit' && formId === 'sub-add')) {
        const title = text(values.subtask, 160, true);
        await save(({ documents }) => {
          const target = documents.get(list.id)?.tasks.find((entry) => entry.id === task.id);
          if (!target) throw new Error('That task is no longer in this list.');
          target.subtasks.push({ id: newId(), title, done: false });
        });
        render();
        return { ok: true, fieldValues: { subtask: '' } };
      }
      if (action.startsWith('tasks.sub-toggle:') || action.startsWith('tasks.sub-remove:')) {
        const removing = action.startsWith('tasks.sub-remove:');
        const id = action.slice(action.indexOf(':') + 1);
        await save(({ documents }) => {
          const target = documents.get(list.id)?.tasks.find((entry) => entry.id === task.id);
          const subtask = target?.subtasks.find((entry) => entry.id === id);
          if (!target || !subtask) throw new Error('That subtask no longer exists.');
          if (removing) target.subtasks = target.subtasks.filter((entry) => entry.id !== id);
          else subtask.done = !subtask.done;
        });
        render();
        return { ok: true };
      }

      if (action === 'tasks.ask-delete-task') {
        state.pending = { kind: 'task', id: task.id };
        render();
        return { ok: true };
      }
      if (action === 'tasks.cancel-delete') {
        state.pending = null;
        render();
        return { ok: true };
      }
      if (action === 'tasks.confirm-delete') {
        const pending = state.pending;
        const target = pending?.kind === 'list' ? list?.id : task?.id;
        if (!pending || pending.id !== target) {
          throw new Error('That deletion is no longer pending. Pick the item again.');
        }
        state.pending = null;
        if (pending.kind === 'list') {
          const index = state.lists.findIndex((entry) => entry.id === list.id);
          const snapshot = JSON.parse(JSON.stringify(list));
          await save(({ root, documents }) => {
            root.lists = root.lists.filter((entry) => entry.id !== list.id);
            documents.delete(list.id);
          });
          state.undo = {
            kind: 'list',
            listId: snapshot.id,
            index,
            snapshot,
            message: `Deleted the list “${snapshot.title}”.`,
          };
          render();
          return { ok: true, fieldValues: editorValues(selectedTask()) };
        }
        const index = list.tasks.findIndex((entry) => entry.id === task.id);
        const snapshot = JSON.parse(JSON.stringify(task));
        await save(({ documents }) => {
          const document = documents.get(list.id);
          document.tasks = document.tasks.filter((entry) => entry.id !== task.id);
        });
        state.selectedId = '';
        state.expanded.delete(task.id);
        state.undo = {
          kind: 'task',
          listId: list.id,
          index,
          snapshot,
          message: `Deleted “${snapshot.title}”.`,
        };
        render();
        return { ok: true };
      }
      if (action === 'tasks.undo') {
        const undo = state.undo;
        if (!undo) throw new Error('There is nothing to undo.');
        state.undo = null;
        if (undo.kind === 'list') {
          await save(({ root, documents }) => {
            if (root.lists.some((entry) => entry.id === undo.snapshot.id)) return;
            root.lists.splice(Math.min(undo.index, root.lists.length), 0, {
              id: undo.snapshot.id,
              title: undo.snapshot.title,
              color: undo.snapshot.color,
            });
            documents.set(undo.snapshot.id, {
              id: undo.snapshot.id,
              tasks: undo.snapshot.tasks,
            });
          });
          state.listId = undo.snapshot.id;
          state.notice = 'List restored.';
          render();
          return { ok: true, fieldValues: { listTitle: undo.snapshot.title } };
        }
        await save(({ documents }) => {
          const document = documents.get(undo.listId);
          if (!document || document.tasks.some((entry) => entry.id === undo.snapshot.id)) return;
          document.tasks.splice(Math.min(undo.index, document.tasks.length), 0, undo.snapshot);
        });
        state.selectedId = undo.snapshot.id;
        state.notice = 'Task restored.';
        render();
        return { ok: true, fieldValues: editorValues(selectedTask()) };
      }
      throw new Error('Unknown task action.');
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Task action failed.';
      render();
      return { ok: false, message: state.error };
    }
  }

  async function load() {
    state.loaded = false;
    await store.load();
    state.loaded = true;
    sync();
    state.cleanupNotice = store.pendingCleanupCount() > 0
      ? 'Old list data could not be removed; cleanup will retry when tasks reload or you save again.'
      : '';
  }

  const definition = defineOr3Plugin({
    manifest: TASKS_MANIFEST,
    async setup(ctx) {
      context = ctx;
      store = createTaskStore(ctx.storage);
      ctx.features.require('or3-portable-client-v1');
      ctx.onRequest('runtime.ui-event', handle);
      ctx.onRequest('runtime.tools', () => TASK_TOOLS);
      ctx.onRequest('runtime.tool', runTool);
      try {
        await load();
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'Tasks could not be loaded.';
      }
      render();
    },
  });
  return { definition, client, state };
}

const plugin = createTasksPlugin();
export default createPortablePlugin(plugin.definition, { client: plugin.client });
