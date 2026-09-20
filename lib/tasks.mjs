export const LIMITS = Object.freeze({ lists: 12, tasks: 100, subtasks: 12, bytes: 60000 });
export const LABELS = ['uncategorized', 'work', 'home', 'health'];
export const STATUSES = ['todo', 'doing', 'done'];
export function newId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
export function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`Enter ${required ? 'non-empty ' : ''}text up to ${limit} characters.`);
  return value.trim();
}
export function date(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Use a valid due date in YYYY-MM-DD format.');
  return value;
}
export function validateStore(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.lists) || value.lists.length > LIMITS.lists) throw new Error('Stored tasks use an unsupported format. Nothing has been overwritten.');
  let count = 0; const ids = new Set();
  const id = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value) || ids.has(value)) throw new Error('Stored task IDs are invalid.'); ids.add(value); };
  for (const list of value.lists) {
    id(list.id); text(list.title, 100, true);
    if (!Array.isArray(list.tasks)) throw new Error('Stored task list is invalid.');
    count += list.tasks.length;
    for (const task of list.tasks) {
      id(task.id); text(task.title, 160, true); text(task.notes, 1500); date(task.due);
      if (!STATUSES.includes(task.status) || !LABELS.includes(task.label) || !Number.isInteger(task.difficulty) || task.difficulty < 1 || task.difficulty > 5 || !Array.isArray(task.subtasks) || task.subtasks.length > LIMITS.subtasks) throw new Error('Stored task fields are invalid.');
      for (const sub of task.subtasks) { id(sub.id); text(sub.title, 160, true); if (typeof sub.done !== 'boolean') throw new Error('Stored subtask is invalid.'); }
    }
  }
  if (count > LIMITS.tasks || new TextEncoder().encode(JSON.stringify(value)).byteLength > LIMITS.bytes) throw new Error('Task storage is full. Remove or shorten a task before saving.');
  return value;
}
export function readStore(value) {
  if (value === null || value === undefined) return { schemaVersion: 1, lists: [{ id: 'default-list', title: 'My Tasks', tasks: [] }] };
  return validateStore(value);
}
export function taskFields(values) {
  const difficulty = Number(values.difficulty ?? 3);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error('Difficulty must be 1–5.');
  if (!LABELS.includes(values.label ?? 'uncategorized') || !STATUSES.includes(values.status ?? 'todo')) throw new Error('Choose a valid label and status.');
  return { title: text(values.title,160,true), notes: text(values.notes ?? '',1500), due: date(values.due ?? ''), label: values.label ?? 'uncategorized', status: values.status ?? 'todo', difficulty };
}
export function visibleTasks(tasks, query, filter, sort) {
  const q = query.toLowerCase();
  const visible = tasks.filter(t => (filter === 'all' || t.status === filter) && `${t.title} ${t.notes} ${t.label}`.toLowerCase().includes(q));
  if (sort === 'hardest') visible.sort((a,b)=>b.difficulty-a.difficulty);
  if (sort === 'easiest') visible.sort((a,b)=>a.difficulty-b.difficulty);
  if (sort === 'due') visible.sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  return visible;
}
