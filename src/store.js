import { createClient } from '@supabase/supabase-js';
import { DAY } from './tasks.js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const demo = !url && !key && (import.meta.env.DEV || import.meta.env.MODE === 'demo');
const validUrl = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
export const configured = Boolean(validUrl(url) && key && (/^sb_publishable_/.test(key) || isLegacyAnon(key)));
function isLegacyAnon(value) {
  try { return JSON.parse(atob(value.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role === 'anon'; }
  catch { return false; }
}
export const client = configured ? createClient(url, key) : null;

const columns = 'id,title,notes,is_important,due_at,completed_at,created_at';
function result({ data, error }) { if (error) throw error; return data; }
function existing(data) { if (!data) throw new Error('这条任务可能已在另一台设备删除，请刷新后再试。'); return data; }

export function cloudStore(userId) {
  return {
    async list() {
      const rows = [];
      const size = 100;
      let after;
      for (;;) {
        let query = client.from('tasks').select(columns).eq('user_id', userId).order('id').limit(size);
        if (after) query = query.gt('id', after);
        const page = result(await query);
        rows.push(...page);
        if (page.length < size) return rows;
        after = page.at(-1).id;
      }
    },
    async add(task) { return result(await client.from('tasks').insert({ ...task, user_id: userId }).select(columns).single()); },
    async edit(id, patch) { return existing(result(await client.from('tasks').update(patch).eq('id', id).eq('user_id', userId).select(columns).maybeSingle())); },
    async remove(id) { return existing(result(await client.from('tasks').delete().eq('id', id).eq('user_id', userId).select('id').maybeSingle())); }
  };
}

export function memoryStore() {
  const now = Date.now();
  const sample = [
    ['提交方案初稿', '发出前，确认预算和交付日期。', true, now + 4 * 3600_000],
    ['寄出退货包裹', '取件码在订单详情里。', false, now - 2 * 3600_000],
    ['整理下周阅读笔记', '从上次标记的三篇文章开始。', true, now + 3 * DAY],
    ['清理下载文件夹', null, false, null],
    ['确认会议时间', null, false, null, true]
  ];
  const values = new Map();
  for (const [title, notes, is_important, due, done] of sample) {
    const id = crypto.randomUUID();
    values.set(id, { id, title, notes, is_important, due_at: due ? new Date(due).toISOString() : null, completed_at: done ? new Date(now).toISOString() : null, created_at: new Date(now).toISOString() });
  }
  return {
    async list() { return [...values.values()]; },
    async add(task) { const row = { ...task, id: crypto.randomUUID(), completed_at: null, created_at: new Date().toISOString() }; values.set(row.id, row); return row; },
    async edit(id, patch) { const row = { ...existing(values.get(id)), ...patch }; values.set(id, row); return row; },
    async remove(id) { const row = existing(values.get(id)); values.delete(id); return row; }
  };
}
