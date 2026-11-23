import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import webpush from 'npm:web-push@3.6.7';

const env = (name: string) => Deno.env.get(name) ?? '';
const url = env('SUPABASE_URL');
const db = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const vapidPublic = env('COURSE_VAPID_PUBLIC_KEY');
const origins = env('COURSE_WEB_ORIGINS').split(',').map(origin => origin.trim());
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' });
type Device = { id: string; endpoint: string; auth: string; p256dh: string };
type Reminder = { device_id: string; term: string; starts_at: string; periods: string; title: string };

function permittedEndpoint(value: string) {
  try {
    const ep = new URL(value);
    return ep.protocol === 'https:' && !ep.port && !ep.username && !ep.password && !ep.hash && (
      ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(ep.hostname) ||
      ep.hostname.endsWith('.push.apple.com') || ep.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}

async function send(device: Device, title: string, body: string, ttl: number) {
  if (!permittedEndpoint(device.endpoint)) return false;
  try {
    await webpush.sendNotification({ endpoint: device.endpoint, keys: { auth: device.auth, p256dh: device.p256dh } }, JSON.stringify({ title, body }), {
      TTL: ttl, urgency: 'high', timeout: 4500,
      vapidDetails: { subject: env('COURSE_VAPID_SUBJECT'), publicKey: vapidPublic, privateKey: env('COURSE_VAPID_PRIVATE_KEY') },
    });
    return true;
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) await db.from('schedule_devices').delete().eq('id', device.id).eq('endpoint', device.endpoint);
    console.warn('Course notification not accepted', status ?? 'network/configuration error');
    return false;
  }
}

Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    ...(origins.includes(origin) && origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin',
  };
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return respond({}, 405);

  const cronToken = env('COURSE_CRON_TOKEN');
  const auth = req.headers.get('Authorization');
  const scheduled = cronToken && req.headers.get('X-Course-Cron') === cronToken;
  try {
    if (scheduled) {
      if (!vapidPublic || !env('COURSE_VAPID_PRIVATE_KEY') || !env('COURSE_VAPID_SUBJECT')) return respond({}, 503);
      const { data, error } = await db.rpc('claim_class_reminders');
      if (error) throw error;
      const due = data as Reminder[];
      let sent = 0;
      for (let i = 0; i < due.length; i += 20) {
        await Promise.all(due.slice(i, i + 20).map(async item => {
          const { data: active } = await db.from('schedule_devices').select('id, user_id, endpoint, p256dh, auth').eq('id', item.device_id).maybeSingle();
          if (!active) return;
          const { data: lesson } = await db.from('schedule_classes').select('place').eq('user_id', active.user_id)
            .eq('term', item.term).eq('starts_at', item.starts_at).eq('periods', item.periods).eq('title', item.title)
            .order('place').limit(1).maybeSingle();
          const ttl = Math.floor((Date.parse(item.starts_at) + 300_000 - Date.now()) / 1000);
          if (lesson && ttl > 0 && await send(active, item.title, `${clock.format(new Date(item.starts_at))} 上课 · ${lesson.place}`, ttl)) sent++;
        }));
      }
      return respond({ claimed: due.length, sent });
    }

    if (!auth?.startsWith('Bearer ')) return respond({}, 401);
    const { data: { user } } = await db.auth.getUser(auth.slice(7));
    if (!user) return respond({}, 401);
    const body = await req.json().catch(() => null);
    if (!vapidPublic || !env('COURSE_VAPID_PRIVATE_KEY') || !env('COURSE_VAPID_SUBJECT')) return respond({}, 503);
    if (body?.action === 'config') return respond({ publicKey: vapidPublic });
    if (body?.action !== 'test' || typeof body.endpoint !== 'string' || !permittedEndpoint(body.endpoint)) return respond({}, 400);
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: device, error } = await db.from('schedule_devices').update({ last_test_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('endpoint', body.endpoint).or(`last_test_at.is.null,last_test_at.lt.${cutoff}`)
      .select('id, endpoint, p256dh, auth').maybeSingle();
    if (error) throw error;
    if (!device) return respond({}, 429);
    return await send(device, '课表测试通知', '本机可以接收上课提醒。', 60) ? respond({ sent: true }) : respond({}, 502);
  } catch {
    console.error('Course push request failed');
    return respond({}, 500);
  }
});
