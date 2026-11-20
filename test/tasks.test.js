import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, fields, endOfDay, groupOf, isUrgent, isOverdue, summarize } from '../src/tasks.js';

const now = Date.parse('2026-11-20T10:00:00Z');
function task(id, important, delta, extra = {}) {
  return { id, is_important: important, due_at: delta === null ? null : new Date(now + delta).toISOString(), created_at: new Date(now).toISOString(), completed_at: null, ...extra };
}

test('紧急阈值按实际 24 小时计算，并区分到期与逾期', () => {
  assert.equal(isUrgent(task('a', true, DAY), now), true);
  assert.equal(isUrgent(task('a', true, DAY + 1), now), false);
  assert.equal(isUrgent(task('a', true, null), now), false);
  assert.equal(isOverdue(task('a', true, 0), now), false);
  assert.equal(isOverdue(task('a', true, -1), now), true);
  assert.equal(groupOf(task('a', false, -1), now), 1);
});

test('四组顺序、同组到期排序、创建时间与稳定 ID', () => {
  const rows = [task('z', false, null), task('b', true, 20), task('d', true, null), task('c', true, DAY + 1), task('f', false, -800), task('a', true, 20), task('older', true, 20, { created_at: '2025-01-01T00:00:00Z' }), task('first', true, 10)];
  const info = summarize(rows, now);
  assert.deepEqual(info.pending.map(t => t.id), ['first', 'older', 'a', 'b', 'f', 'c', 'd', 'z']);
  assert.deepEqual(info.counts, [4, 1, 2, 1]);
  assert.equal(rows[0].id, 'z');
});

test('完成状态从图表移除；重新打开按当前时间重新分组', () => {
  const old = task('old', true, 1, { completed_at: '2026-11-19T00:00:00Z' });
  const recent = task('recent', true, DAY + 1, { completed_at: '2026-11-20T00:00:00Z' });
  assert.deepEqual(summarize([old, recent], now).done.map(t => t.id), ['recent', 'old']);
  assert.deepEqual(summarize([old, recent], now).counts, [0, 0, 0, 0]);
  assert.deepEqual(summarize([old, { ...recent, completed_at: null }], now + 1).counts, [1, 0, 0, 0]);
});

test('表单清理空白并把本地截止时间转为绝对时间', () => {
  const form = { title: { value: ' 交方案 ' }, notes: { value: '  ' }, important: { checked: true }, due: { value: '2026-11-20T18:00' } };
  assert.deepEqual(fields(form), { title: '交方案', notes: null, is_important: true, due_at: new Date('2026-11-20T18:00').toISOString() });
  form.title.value = ' '.repeat(3); assert.throws(() => fields(form), /任务名称/);
  form.title.value = '有效任务'; form.due.value = '2026-02-31T18:00'; assert.throws(() => fields(form), /截止时间/);
  assert.equal(endOfDay(1, new Date(2026, 11, 31, 18)), '2027-01-01T23:59');
});
