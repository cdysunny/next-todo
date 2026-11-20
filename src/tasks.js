export const DAY = 24 * 60 * 60 * 1000;
export const GROUPS = ['重要且紧急', '紧急但普通', '重要不紧急', '普通不紧急'];

const dueValue = task => task.due_at ? Date.parse(task.due_at) : Infinity;
export const isOverdue = (task, now) => dueValue(task) < now;
export const isUrgent = (task, now) => dueValue(task) - now <= DAY;
export const groupOf = (task, now) => isUrgent(task, now) ? (task.is_important ? 0 : 1) : (task.is_important ? 2 : 3);

export function summarize(tasks, now) {
  const counts = [0, 0, 0, 0];
  const pending = [];
  const done = [];
  for (const task of tasks) {
    if (task.completed_at) done.push(task);
    else { counts[groupOf(task, now)]++; pending.push(task); }
  }
  const byId = (a, b) => a.id.localeCompare(b.id);
  pending.sort((a, b) => groupOf(a, now) - groupOf(b, now) || dueValue(a) - dueValue(b) || Date.parse(a.created_at) - Date.parse(b.created_at) || byId(a, b));
  done.sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at) || byId(a, b));
  return { pending, done, counts };
}

export function localInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function endOfDay(offset, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  date.setHours(23, 59, 0, 0);
  return localInput(date);
}

export function fields(form) {
  const title = form.title.value.trim();
  const notes = form.notes?.value.trim() || '';
  if (!title || [...title].length > 120) throw new Error('请输入 1–120 个字符的任务名称。');
  if ([...notes].length > 2000) throw new Error('备注不能超过 2,000 个字符。');
  const local = form.due.value;
  const due = local ? new Date(local) : null;
  if (due && (!Number.isFinite(+due) || localInput(due) !== local)) throw new Error('请输入有效的当地截止时间。');
  return { title, notes: notes || null, is_important: form.important.checked, due_at: due?.toISOString() ?? null };
}
