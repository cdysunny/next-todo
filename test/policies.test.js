import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('数据库隔离两个账号：仅所有者可以读写任务，匿名不能访问', async () => {
  const db = new PGlite();
  const first = '00000000-0000-4000-a000-000000000001';
  const second = '00000000-0000-4000-a000-000000000002';
  const query = (...args) => db.query(...args);
  const rejects = (sql, params = [], code = '42501') => assert.rejects(query(sql, params), { code });
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
    `);
    await query('insert into auth.users values ($1), ($2)', [first, second]);
    await db.exec(await readFile(new URL('../supabase/migrations/202611200001_tasks.sql', import.meta.url), 'utf8'));
    await db.exec('set role anon');
    await rejects('select * from public.tasks');
    await rejects('insert into public.tasks (user_id, title) values ($1, $2)', [first, '匿名']);

    const signIn = async id => {
      await db.exec('reset role; set role authenticated');
      await query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    };
    await signIn(first);
    const { rows: [created] } = await query('insert into public.tasks (user_id,title) values ($1,$2) returning id', [first, '任务 A']);
    await rejects('insert into public.tasks (user_id,title) values ($1,$2)', [first, ' \t '], '23514');
    await rejects('insert into public.tasks (user_id,title) values ($1,$2)', [second, '冒名任务']);
    await rejects('update public.tasks set user_id=$1 where id=$2', [second, created.id]);
    await rejects('update public.tasks set created_at=now() where id=$1', [created.id]);

    await signIn(second);
    assert.deepEqual((await query('select id from public.tasks where id=$1', [created.id])).rows, []);
    assert.deepEqual((await query("update public.tasks set title='修改' where id=$1 returning id", [created.id])).rows, []);
    assert.deepEqual((await query('delete from public.tasks where id=$1 returning id', [created.id])).rows, []);
    await query('insert into public.tasks (user_id,title) values ($1,$2)', [second, '任务 B']);

    await signIn(first);
    assert.deepEqual((await query('select title from public.tasks')).rows, [{ title: '任务 A' }]);
    assert.equal((await query('update public.tasks set completed_at=now() where id=$1 returning id', [created.id])).rows[0].id, created.id);
    assert.equal((await query('delete from public.tasks where id=$1 returning id', [created.id])).rows[0].id, created.id);
    await signIn(second);
    assert.deepEqual((await query('select title from public.tasks')).rows, [{ title: '任务 B' }]);
  } finally { await db.close(); }
});
