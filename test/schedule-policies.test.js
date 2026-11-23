import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('课表隔离、原子替换、推送过期及每设备去重', async () => {
  const db = new PGlite();
  const a = '00000000-0000-4000-a000-000000000001', b = '00000000-0000-4000-a000-000000000002';
  const q = (...args) => db.query(...args);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/example';
  const course = { week: 2, day: 3, periods: '1-2-3-4', title: '实验课', teacher: '老师', place: '实验室', time: '08:30' };
  const replace = (courses, monday = '2026-09-07') => q('select public.replace_schedule($1,$2,$3)', ['2026-2027-1', monday, JSON.stringify(courses)]);
  const asUser = async id => {
    await db.exec('reset role; set role authenticated');
    await q("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;`);
    await q('insert into auth.users values ($1),($2)', [a,b]);
    await db.exec(await readFile(new URL('../supabase/migrations/202611230001_schedule.sql', import.meta.url), 'utf8'));
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('_set_schedule_current_week.sql'))) {
      await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    }
    await db.exec('set role anon');
    await assert.rejects(q('select * from schedule_classes'), { code: '42501' });
    await assert.rejects(replace([course]), { code: '42501' });
    await assert.rejects(q("select public.set_schedule_current_week('2026-2027-1', 2)"), { code: '42501' });
    await asUser(a);
    await replace([course, course]); await replace([course]);
    const { rows } = await q('select starts_at from schedule_classes');
    assert.equal(rows.length, 1); assert.equal(rows[0].starts_at.toISOString(), '2026-09-16T00:30:00.000Z');
    await assert.rejects(replace([{ ...course, place: '智慧树' }]), { code: '23514' });
    assert.deepEqual((await q('select place from schedule_classes')).rows, [{ place: '实验室' }]);
    await q('insert into schedule_devices(user_id,endpoint,p256dh,auth) values($1,$2,$3,$4),($1,$5,$3,$4)', [a,endpoint,'a'.repeat(87),'b'.repeat(22),`${endpoint}-2`]);
    await assert.rejects(q('select * from claim_class_reminders()'), { code: '42501' });
    await asUser(b);
    assert.equal((await q('select * from schedule_terms')).rows.length, 0);
    assert.equal((await q('select * from schedule_classes')).rows.length, 0);
    assert.equal((await q('select * from schedule_devices')).rows.length, 0);
    await replace([{ ...course, title: '其他账号课程' }]);
    await asUser(a);
    await replace([course, { ...course, title: '过期课' }, { ...course, title: '未开课' }]);
    await db.exec(`reset role; update schedule_classes set starts_at = now() + case title when '过期课' then interval '-6 minutes' when '未开课' then interval '1 hour' else interval '-1 minute' end;
      set role service_role;`);
    const claimed = (await q('select * from claim_class_reminders()')).rows;
    assert.equal(claimed.length, 2);
    assert.ok(claimed.every(row => row.title === '实验课' && row.place === '实验室'));
    assert.equal((await q('select * from claim_class_reminders()')).rows.length, 0);
    await asUser(a);
    await q('delete from schedule_devices');
    await db.exec("reset role; update schedule_classes set starts_at=now() where title = '未开课'; set role service_role");
    assert.equal((await q('select * from claim_class_reminders()')).rows.length, 0);

    await asUser(a);
    await replace([course, { ...course, week: 3 }]);
    await q("select set_config('request.jwt.claim.sub', $1, false)", [b]);
    const { rows: [calibration] } = await q("select public.set_schedule_current_week('2026-2027-1', 12) as monday");
    assert.ok(calibration.monday, '校准应返回第 1 周周一');
    await asUser(a);
    assert.equal((await q('select monday::text from schedule_terms')).rows[0].monday, '2026-09-07');
    await q("select public.set_schedule_current_week('2026-2027-1', 2)");
    await q("select public.set_schedule_current_week('2026-2027-1', 3)");
    await q("select public.set_schedule_current_week('2026-2027-1', 4)");
    await q("select public.set_schedule_current_week('2026-2027-1', 3)");
    const shifted = (await q(`select c.week, (c.starts_at at time zone 'Asia/Shanghai')::date - t.monday as offset,
      to_char(c.starts_at at time zone 'Asia/Shanghai', 'HH24:MI') as clock,
      ((now() at time zone 'Asia/Shanghai')::date - t.monday) / 7 + 1 as current_week
      from schedule_classes c join schedule_terms t using (user_id,term) order by c.week`)).rows;
    assert.deepEqual(shifted, [{ week: 2, offset: 9, clock: '08:30', current_week: 3 }, { week: 3, offset: 16, clock: '08:30', current_week: 3 }]);
    await assert.rejects(q("select public.set_schedule_current_week('2026-2027-1', 0)"), { code: '22023' });
    await q('insert into schedule_devices(user_id,endpoint,p256dh,auth) values($1,$2,$3,$4)', [a,endpoint,'a'.repeat(87),'b'.repeat(22)]);
    await db.exec("reset role; update schedule_classes set starts_at=now() - interval '1 minute' where user_id = '00000000-0000-4000-a000-000000000001' and week=3; set role service_role");
    assert.equal((await q('select * from claim_class_reminders()')).rows.length, 0, '不补发校准前已开课的课程');
  } finally { await db.close(); }
});
