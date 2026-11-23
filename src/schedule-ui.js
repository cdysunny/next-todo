import { beijingDate, currentWeek, dateCourses, readSchedule } from './schedule.js';

const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const weekNames = ['一', '二', '三', '四', '五', '六', '日'];
const localTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const appRoot = new URL('./', location.href);
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
const worker = 'serviceWorker' in navigator ? navigator.serviceWorker.register(new URL('course-worker.js', appRoot), { updateViaCache: 'none' }).catch(() => null) : Promise.resolve(null);
const numberOfWeeks = rows => Math.max(1, ...rows.map(row => row.week));

function list(id, rows) {
  $(id).replaceChildren(...rows.map(row => {
    const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('span');
    title.textContent = row.title;
    const time = row.time ?? localTime.format(new Date(row.starts_at));
    const periods = row.periods.split('-');
    const date = row.starts_at ? `${beijingDate(new Date(row.starts_at)).slice(5)} ` : '';
    detail.textContent = `${date}周${weekNames[row.day - 1]} ${time} · ${periods.length > 1 ? `${periods[0]}–${periods.at(-1)}` : periods[0]}节 · ${row.place}${row.teacher ? ` · ${row.teacher}` : ''}`;
    li.append(title, detail); return li;
  }));
}

export function createScheduleUI(client) {
  let owner, epoch = 0, fileEpoch = 0, open = false, terms = [], classes = [], monday, selectedWeek = 1, byWeek = false, parsed, loaded = false, loading = false, saving = false, pushBusy = false;
  let openOnSignIn = new URLSearchParams(location.search).has('courses');
  const termBox = $('course-term'), dateBox = $('course-start'), save = $('course-save'), previewWeek = $('course-preview-week');
  const weekSettings = $('course-week-settings'), weekInput = $('course-current-week'), weekSave = $('course-week-save');
  let calibrating = false;

  function selectView(value) {
    open = value;
    $('course-view').hidden = !open; $('todo-view').hidden = open;
    $('todo-tab').setAttribute('aria-pressed', String(!open)); $('course-tab').setAttribute('aria-pressed', String(open));
    $('dashboard').setAttribute('aria-labelledby', open ? 'course-title' : 'dashboard-title');
    if (open) { if (!loaded && !loading) void load(); else render(); void pushState(); }
  }

  function render() {
    const max = numberOfWeeks(classes);
    const actual = monday ? currentWeek(monday) : 0;
    weekSettings.hidden = !owner || !monday;
    weekSave.disabled = calibrating || loading || !monday;
    text('course-week-summary', actual >= 1 && actual <= 30 ? `设置当前周（第 ${actual} 周）` : '设置当前周');
    if (!weekSettings.open) weekInput.value = actual >= 1 && actual <= 30 ? actual : '';
    if (!byWeek && actual >= 1 && actual <= max) selectedWeek = actual;
    $('course-today').setAttribute('aria-pressed', String(!byWeek)); $('course-week').setAttribute('aria-pressed', String(byWeek));
    $('course-week-nav').hidden = !monday || !byWeek;
    $('course-prev').disabled = selectedWeek <= 1; $('course-next').disabled = selectedWeek >= max;
    text('course-week-label', `第 ${selectedWeek} 周`);
    const today = beijingDate();
    const filtered = byWeek ? classes.filter(row => row.week === selectedWeek) : classes.filter(row => beijingDate(new Date(row.starts_at)) === today);
    list('course-list', filtered);
    text('course-load', !monday ? (owner ? '还没有课表，从下方导入。' : '演示模式可以预览，登录后才能保存和开启推送。') : filtered.length ? `${filtered.length} 场 · 北京时间` : byWeek ? '本周没有排课。' : '今天没有排课。');
  }

  async function load(preferred) {
    if (!owner) { render(); return; }
    const token = ++epoch;
    loading = true; loaded = false; monday = undefined; classes = []; weekSettings.hidden = true; list('course-list', []); text('course-load', '正在读取课表…');
    termBox.disabled = true;
    try {
      const { data, error } = await client.from('schedule_terms').select('term,monday').order('term', { ascending: false });
      if (error) throw error;
      if (epoch !== token) return;
      terms = data;
      termBox.replaceChildren(...terms.map(row => new Option(row.term, row.term)));
      if (terms.some(row => row.term === preferred)) termBox.value = preferred;
      const term = terms.find(row => row.term === termBox.value);
      if (term) {
        const result = await client.from('schedule_classes').select('week,day,periods,title,place,teacher,starts_at')
          .eq('term', term.term).order('starts_at').order('periods').order('title').order('place').order('teacher').limit(1000);
        if (result.error) throw result.error;
        if (epoch !== token) return;
        classes = result.data; monday = term.monday;
        selectedWeek = Math.min(numberOfWeeks(classes), Math.max(1, currentWeek(monday)));
      }
      loaded = true; render(); preview();
    } catch {
      if (epoch === token) text('course-load', '未能读取课表。确认后端已部署后，切回待办再进入课表重试。');
    } finally { if (epoch === token) { loading = false; termBox.disabled = calibrating || !terms.length; weekSave.disabled = calibrating || !monday; } }
  }

  function preview() {
    if (!parsed) return;
    const { term, courses, errors, excluded } = parsed;
    let validDate = false, dateError = '', rows = courses ?? [];
    const chosenWeek = Number(previewWeek.value) || 1;
    if (dateBox.value && !errors.length) {
      try { rows = dateCourses(courses, dateBox.value); validDate = true; } catch (error) { dateError = error.message; }
    }
    const existing = terms.some(row => row.term === term);
    save.textContent = existing ? '确认替换该学期课表' : '确认导入';
    save.disabled = saving || calibrating || !owner || !validDate || !!errors.length;
    const details = [term ? `${term} 学期 · ${courses.length} 场课` : '', excluded?.length ? `不提醒智慧树：${excluded.join('、')}` : '',
      ...errors, dateError || (!dateBox.value && !errors.length ? '请选择学校第 1 周周一的日期。' : '')].filter(Boolean);
    text('course-import-status', details.join('\n'));
    $('course-preview').hidden = !courses?.length;
    list('course-preview-list', rows.filter(row => row.week === chosenWeek));
  }

  $('todo-tab').onclick = () => selectView(false);
  $('course-tab').onclick = () => selectView(true);
  termBox.onchange = () => void load(termBox.value);
  $('course-today').onclick = () => { byWeek = false; render(); };
  $('course-week').onclick = () => { if (!byWeek && monday) selectedWeek = Math.min(numberOfWeeks(classes), Math.max(1, currentWeek(monday))); byWeek = true; render(); };
  $('course-prev').onclick = () => { if (selectedWeek > 1) selectedWeek--; render(); };
  $('course-next').onclick = () => { if (selectedWeek < numberOfWeeks(classes)) selectedWeek++; render(); };
  weekSettings.ontoggle = () => { if (weekSettings.open && monday) { const value = currentWeek(monday); weekInput.value = value >= 1 && value <= 30 ? value : ''; } };
  $('course-week-form').onsubmit = async event => {
    event.preventDefault();
    const week = weekInput.valueAsNumber, account = owner, term = termBox.value;
    if (!account || !term || loading || saving || calibrating || !Number.isInteger(week) || week < 1 || week > 30) return;
    const ticket = epoch;
    calibrating = weekSave.disabled = termBox.disabled = save.disabled = true;
    text('course-week-status', '正在保存当前周…');
    try {
      const { error } = await client.rpc('set_schedule_current_week', { p_term: term, p_week: week });
      if (owner !== account || epoch !== ticket) return;
      if (error) throw error;
      weekSettings.open = false; byWeek = false;
      if (parsed?.term === term) { parsed = undefined; $('course-form').reset(); $('course-preview').hidden = true; text('course-import-status', '当前周已调整，请重新选择文件后再替换课表。'); }
      text('course-week-status', `已将本周设为第 ${week} 周。`);
      await load(term);
    } catch { if (owner === account && epoch === ticket) text('course-week-status', '未能保存当前周，请重试。'); }
    finally { if (owner === account && (epoch === ticket || epoch === ticket + 1)) { calibrating = false; termBox.disabled = loading || !terms.length; weekSave.disabled = loading || !monday; preview(); } }
  };
  dateBox.onchange = preview; previewWeek.onchange = preview;
  $('course-file').onchange = async event => {
    const ticket = ++fileEpoch, file = event.target.files[0];
    parsed = undefined; save.disabled = true; $('course-preview').hidden = true; text('course-import-status', '');
    if (!file) return;
    if (!/\.xls$/i.test(file.name) || file.size > 2 * 1024 * 1024) { text('course-import-status', '请选择 2 MB 以内的 .xls 课表。'); return; }
    text('course-import-status', '正在解析课表…');
    try {
      const result = await readSchedule(await file.arrayBuffer());
      if (fileEpoch !== ticket) return;
      parsed = result;
      const known = terms.find(row => row.term === parsed.term);
      if (known) dateBox.value = known.monday;
      previewWeek.replaceChildren(...Array.from({ length: numberOfWeeks(parsed.courses ?? []) }, (_, i) => new Option(`第 ${i + 1} 周`, String(i + 1))));
      preview();
    } catch { if (fileEpoch === ticket) text('course-import-status', '无法读取此文件，请重新选择教务系统导出的 .xls。'); }
  };

  $('course-form').onsubmit = async event => {
    event.preventDefault();
    if (save.disabled || calibrating || !owner || !parsed || parsed.errors.length) return;
    const target = owner, ticket = fileEpoch, input = parsed, mondayValue = dateBox.value;
    saving = true; save.disabled = true; $('course-file').disabled = dateBox.disabled = true;
    try {
      dateCourses(input.courses, mondayValue);
      const { error } = await client.rpc('replace_schedule', { p_term: input.term, p_monday: mondayValue, p_courses: input.courses });
      if (owner !== target || fileEpoch !== ticket) return;
      if (error) throw error;
      parsed = undefined; $('course-form').reset(); $('course-preview').hidden = true;
      text('course-import-status', `已保存 ${input.courses.length} 场课程。`);
      await load(input.term);
    } catch { if (owner === target && fileEpoch === ticket) text('course-import-status', '未能保存课表，原课表未被替换。可以重试。'); }
    finally { if (owner === target && fileEpoch === ticket) { saving = false; $('course-file').disabled = dateBox.disabled = false; save.disabled = !parsed; } }
  };

  async function registration() {
    const registered = await worker;
    if (!registered) throw new Error('本机无法启动通知组件。');
    if (registered.active?.state === 'activated') return registered;
    let timer;
    try { return await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('通知组件还未就绪，请刷新再试。')), 6000); })]); }
    finally { clearTimeout(timer); }
  }

  async function ownedSubscription(reg, account) {
    const sub = await reg.pushManager.getSubscription();
    if (!sub || !account) return { sub, enabled: false };
    const { data, error } = await client.from('schedule_devices').select('id').eq('user_id', account).eq('endpoint', sub.endpoint).maybeSingle();
    if (error) throw error;
    return { sub, enabled: !!data };
  }

  function pushButtons(enable, enabled, removable = enabled) {
    $('course-enable').disabled = pushBusy || !enable; $('course-test').disabled = pushBusy || !enabled; $('course-disable').disabled = pushBusy || !removable;
  }

  async function pushState(override) {
    const account = owner; if (!open) return;
    pushButtons(false, false);
    if (!account || !supported) { text('course-push-state', !account ? '登录后可以开启推送。' : '当前浏览器不支持网页推送，请尝试从手机主屏幕打开应用。'); return; }
    try {
      const { enabled } = await ownedSubscription(await registration(), account);
      if (owner !== account || !open) return;
      const denied = Notification.permission === 'denied';
      pushButtons(!enabled && !denied, enabled && !denied, enabled);
      text('course-push-state', override || (denied ? '通知权限已关闭。可到系统设置里重新授权。' : enabled ? '本机提醒已开启。' : '本机提醒未开启。'));
    } catch { if (owner === account && open) text('course-push-state', override || '无法读取本机提醒状态，请确认推送后端已部署。'); }
  }

  async function invoke(body) {
    const { data, error } = await client.functions.invoke('course-push', { body });
    if (error) throw new Error(error.context?.status === 429 ? '测试通知每分钟只能发送一次。' : '推送服务暂不可用，请确认后端配置后重试。');
    return data;
  }

  async function unsubscribe(account) {
    if (!supported || !account) return;
    const reg = await worker;
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const { error } = await client.from('schedule_devices').delete().eq('user_id', account).eq('endpoint', sub.endpoint);
    if (error) throw error;
    await sub.unsubscribe().catch(() => false);
  }

  async function perform(action) {
    const account = owner;
    if (!account || pushBusy) return;
    pushBusy = true; pushButtons(false, false); let result;
    try { result = await action(account); }
    catch (error) { result = error instanceof Error ? error.message : '操作未完成，请稍后重试。'; }
    finally { if (account === owner) { pushBusy = false; await pushState(result); } }
  }

  $('course-enable').onclick = () => void perform(async account => {
    if (await Notification.requestPermission() !== 'granted') return '本机未授权通知。';
    const reg = await registration(), { publicKey } = await invoke({ action: 'config' });
    if (owner !== account || !publicKey) throw new Error('会话或提醒配置已变化，请重试。');
    const previous = await ownedSubscription(reg, account);
    if (previous.enabled) return '本机提醒已开启。';
    if (previous.sub) await previous.sub.unsubscribe();
    const applicationServerKey = Uint8Array.from(atob(publicKey.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    try {
      if (owner !== account) throw new Error('会话已变化，请重新登录。');
      const { error } = await client.from('schedule_devices').insert({ user_id: account, endpoint: sub.endpoint, ...sub.toJSON().keys });
      if (error) throw new Error('未能保存本机提醒，请确认后端已部署后重试。');
    } catch (error) { await sub.unsubscribe().catch(() => false); throw error; }
    return '本机提醒已开启，可以发送一条测试通知。';
  });
  $('course-disable').onclick = () => void perform(async account => { await unsubscribe(account); return '本机提醒已关闭。'; });
  $('course-test').onclick = () => void perform(async account => {
    const { sub, enabled } = await ownedSubscription(await registration(), account);
    if (!enabled) return '请先开启本机提醒。';
    await invoke({ action: 'test', endpoint: sub.endpoint });
    return '测试通知已提交给推送服务，请检查手机通知栏。';
  });
  $('course-install').onclick = async () => {
    if (installPrompt) { const prompt = installPrompt; installPrompt = null; await prompt.prompt(); }
    else text('course-push-state', 'iPhone：用 Safari 分享菜单「添加到主屏幕」。安卓：用 Chrome 菜单里的「安装应用」或「添加到主屏幕」。');
  };
  document.addEventListener('visibilitychange', () => { if (open && !document.hidden) { if (loaded) render(); if (!pushBusy) void pushState(); } });

  return {
    reset(account) {
      owner = account; epoch++; fileEpoch++; loaded = loading = byWeek = saving = pushBusy = false; monday = parsed = undefined; classes = []; terms = [];
      calibrating = false; weekSettings.hidden = true; weekSettings.open = false; weekInput.value = ''; text('course-week-status', '');
      selectView(false); termBox.replaceChildren(); list('course-list', []); list('course-preview-list', []);
      $('course-form').reset(); $('course-file').disabled = dateBox.disabled = false; $('course-preview').hidden = true; $('course-import').open = false;
      save.disabled = true; text('course-import-status', ''); text('course-load', ''); text('course-push-state', ''); pushButtons(false, false);
    },
    beforeSignOut: () => unsubscribe(owner),
    showFromNotification() { if (openOnSignIn) { openOnSignIn = false; selectView(true); } },
  };
}
