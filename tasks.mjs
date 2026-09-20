/**
 * Task data layer: schema, validation, storage migration and view helpers.
 *
 * Storage layout (schemaVersion 2):
 * - `task-lists-v2`      one small index: the ordered lists with title and color.
 * - `task-list-v2:<id>`  one document per list: its tasks and subtasks.
 *
 * One document per list keeps a write proportional to the list the user touched
 * and keeps every stored value inside the host's per-value budget. The
 * schemaVersion 1 blob (`task-lists-v1`) is read once, migrated and left in
 * place, so a rollback to the previous release still finds the old data.
 */
export const ROOT_KEY = 'task-lists-v2';
export const LEGACY_KEY = 'task-lists-v1';
export const SCHEMA_VERSION = 2;
export const LIMITS = Object.freeze({
  lists: 40,
  tasks: 300,
  subtasks: 20,
  /** The host refuses a stored value over 32 KiB; stay a little under it. */
  bytes: 30 * 1024,
});
/** Rows rendered at once; the rest are one "Show more" away. */
export const PAGE_SIZE = 60;
export const STATUSES = ['todo', 'doing', 'done'];
export const PRIORITIES = ['none', 'low', 'medium', 'high'];
export const LABELS = ['none', 'work', 'home', 'health', 'study', 'errand'];
export const LIST_COLORS = ['blue', 'violet', 'pink', 'green', 'amber', 'orange', 'red', 'slate'];
export const PRIORITY_TONES = Object.freeze({ none: 'neutral', low: 'info', medium: 'warning', high: 'danger' });
export const LABEL_TITLES = Object.freeze({
  none: 'No label',
  work: 'Work',
  home: 'Home',
  health: 'Health',
  study: 'Study',
  errand: 'Errand',
});
export const STATUS_TITLES = Object.freeze({ todo: 'To do', doing: 'In progress', done: 'Done' });

const TITLE_LIMIT = 160;
const NOTE_LIMIT = 1500;
const LIST_TITLE_LIMIT = 80;

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function text(value, limit, required = false) {
  const raw = value === undefined || value === null ? '' : value;
  if (typeof raw !== 'string' || raw.length > limit || (required && !raw.trim())) {
    throw new Error(`${required ? 'Enter a value' : 'Use text'} up to ${limit} characters.`);
  }
  return raw.trim();
}

export function date(value) {
  if (!value) return '';
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Use a valid due date in YYYY-MM-DD format, or leave it empty.');
  }
  return value;
}

/** Local calendar day, so "today" matches the user's clock rather than UTC. */
export function todayStamp(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function oneOf(value, allowed, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new Error(`Choose a valid ${field}.`);
  return value;
}

/** Normalize the editable task fields shared by the UI and the chat tools. */
export function taskFields(values = {}) {
  return {
    title: text(values.title, TITLE_LIMIT, true),
    notes: text(values.notes ?? '', NOTE_LIMIT),
    due: date(values.due ?? ''),
    priority: oneOf(values.priority, PRIORITIES, 'none', 'priority'),
    label: oneOf(values.label, LABELS, 'none', 'label'),
  };
}

function legacyPriority(difficulty) {
  const level = Number(difficulty);
  if (!Number.isFinite(level)) return 'none';
  if (level >= 4) return 'high';
  if (level === 3) return 'medium';
  if (level >= 1) return 'low';
  return 'none';
}

/** Migrate one schemaVersion 1 task: difficulty becomes a priority. */
function migrateTask(task) {
  const fields = taskFields({
    title: task.title,
    notes: task.notes ?? '',
    due: task.due ?? '',
    priority: task.priority ?? legacyPriority(task.difficulty),
    label: task.label === 'uncategorized' ? 'none' : task.label ?? 'none',
  });
  return {
    id: task.id,
    ...fields,
    status: STATUSES.includes(task.status) ? task.status : 'todo',
    subtasks: Array.isArray(task.subtasks)
      ? task.subtasks.map((sub) => ({
          id: sub.id,
          title: text(sub.title, TITLE_LIMIT, true),
          done: sub.done === true,
        }))
      : [],
  };
}

function validateId(value, seen, what) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) {
    throw new Error(`Stored ${what} IDs are invalid.`);
  }
  if (seen.has(value)) throw new Error(`Stored ${what} IDs are not unique.`);
  seen.add(value);
}

export function validateTask(task, ids) {
  validateId(task.id, ids, 'task');
  taskFields(task);
  if (!STATUSES.includes(task.status)) throw new Error('Stored task status is invalid.');
  if (!Array.isArray(task.subtasks) || task.subtasks.length > LIMITS.subtasks) {
    throw new Error('Stored subtasks are invalid.');
  }
  for (const sub of task.subtasks) {
    validateId(sub.id, ids, 'subtask');
    text(sub.title, TITLE_LIMIT, true);
    if (typeof sub.done !== 'boolean') throw new Error('Stored subtask is invalid.');
  }
}

export function assertStoredSize(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > LIMITS.bytes) {
    throw new Error('This list is out of storage. Remove or shorten a task before saving.');
  }
  return bytes;
}

/** One list document: the tasks of a single list. */
export function validateListDocument(document, expectedId) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.tasks)) {
    throw new Error('Stored task list is invalid.');
  }
  if (expectedId && document.id !== expectedId) {
    throw new Error('Stored task list does not match its index entry.');
  }
  if (document.tasks.length > LIMITS.tasks) {
    throw new Error('This list is full. Remove or shorten a task before saving.');
  }
  const ids = new Set();
  for (const task of document.tasks) validateTask(task, ids);
  assertStoredSize(document);
  return document;
}

/** The index document: ordered list metadata only. */
export function validateRoot(root) {
  if (!root || typeof root !== 'object' || root.schemaVersion !== SCHEMA_VERSION || !Array.isArray(root.lists)) {
    throw new Error('Stored tasks use an unsupported format. Nothing has been overwritten.');
  }
  if (root.lists.length > LIMITS.lists) {
    throw new Error(`Keep the number of lists at ${LIMITS.lists} or fewer.`);
  }
  const ids = new Set();
  for (const entry of root.lists) {
    validateId(entry.id, ids, 'list');
    text(entry.title, LIST_TITLE_LIMIT, true);
    oneOf(entry.color, LIST_COLORS, 'blue', 'list colour');
  }
  return root;
}

export function createRoot(lists) {
  return {
    schemaVersion: SCHEMA_VERSION,
    lists: lists ?? [{ id: 'default-list', title: 'My Tasks', color: 'blue' }],
  };
}

export function emptyListDocument(id) {
  return { id, tasks: [] };
}

/**
 * Convert a schemaVersion 1 blob into index entries plus one document per list.
 * Nothing is written here: the caller validates the whole plan, then writes.
 */
export function planLegacyMigration(legacy) {
  if (!legacy || legacy.schemaVersion !== 1 || !Array.isArray(legacy.lists)) {
    throw new Error('Stored tasks use an unsupported format. Nothing has been overwritten.');
  }
  if (legacy.lists.length > LIMITS.lists) {
    throw new Error(`Keep the number of lists at ${LIMITS.lists} or fewer.`);
  }
  const seen = new Set();
  const lists = [];
  const documents = [];
  let colorIndex = 0;
  for (const list of legacy.lists) {
    validateId(list.id, seen, 'list');
    lists.push({
      id: list.id,
      title: text(list.title, LIST_TITLE_LIMIT, true),
      color: LIST_COLORS[colorIndex++ % LIST_COLORS.length],
    });
    documents.push({
      id: list.id,
      tasks: Array.isArray(list.tasks) ? list.tasks.map(migrateTask) : [],
    });
  }
  if (lists.length === 0) lists.push({ id: 'default-list', title: 'My Tasks', color: 'blue' });
  for (const document of documents) validateListDocument(document, document.id);
  validateRoot({ schemaVersion: SCHEMA_VERSION, lists });
  return { root: { schemaVersion: SCHEMA_VERSION, lists }, documents };
}

export function isOverdue(task, today) {
  return task.status !== 'done' && task.due !== '' && task.due < today;
}

export function isDueToday(task, today) {
  return task.status !== 'done' && task.due === today;
}

export function isUpcoming(task, today, days = 7) {
  if (task.status === 'done' || task.due === '' || task.due <= today) return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return task.due <= limit.toISOString().slice(0, 10);
}

/** Short due-date pill, relative to the user's day. */
export function dueBadge(due, today) {
  if (!due) return null;
  if (due < today) return { label: 'Overdue', tone: 'danger' };
  if (due === today) return { label: 'Today', tone: 'info' };
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (due === tomorrow.toISOString().slice(0, 10)) return { label: 'Tomorrow', tone: 'info' };
  return { label: due.slice(5).replace('-', '/'), tone: 'neutral' };
}

export function priorityBadge(priority) {
  if (priority === 'none') return null;
  return { label: `${priority[0].toUpperCase()}${priority.slice(1)}`, tone: PRIORITY_TONES[priority] };
}

function dueRank(task) {
  return task.due === '' ? '9999-12-31' : task.due;
}

export function sortTasks(tasks, sort) {
  const list = [...tasks];
  if (sort === 'due') return list.sort((a, b) => dueRank(a).localeCompare(dueRank(b)));
  if (sort === 'priority') {
    const rank = { high: 0, medium: 1, low: 2, none: 3 };
    return list.sort((a, b) => rank[a.priority] - rank[b.priority]);
  }
  if (sort === 'title') return list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

export function matchesQuery(task, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return `${task.title} ${task.notes} ${task.label} ${task.priority}`.toLowerCase().includes(needle);
}

export function matchesFilter(task, filter, today = todayStamp()) {
  if (!filter || filter === 'all') return true;
  if (filter === 'open') return task.status !== 'done';
  if (filter === 'overdue') return isOverdue(task, today);
  if (filter === 'today') return isDueToday(task, today);
  return task.status === filter;
}

/** The rows a surface shows, after filtering and sorting. */
export function visibleTasks(tasks, query, filter, sort, today = todayStamp()) {
  return sortTasks(
    tasks.filter((task) => matchesFilter(task, filter, today) && matchesQuery(task, query)),
    sort
  );
}

export function listSummary(tasks, today) {
  const done = tasks.filter((task) => task.status === 'done').length;
  return {
    total: tasks.length,
    done,
    open: tasks.length - done,
    overdue: tasks.filter((task) => isOverdue(task, today)).length,
    dueToday: tasks.filter((task) => isDueToday(task, today)).length,
  };
}

export function openCount(tasks) {
  return tasks.filter((task) => task.status !== 'done').length;
}
