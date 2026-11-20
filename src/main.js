import './style.css';
import { client, demo, cloudStore, memoryStore } from './store.js';
import { GROUPS, summarize, groupOf, isOverdue, isUrgent, fields, localInput, endOfDay } from './tasks.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function button(text, className, action) { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; }
function message(node, text) { node.textContent = text; node.hidden = !text; }
function readable(error, fallback) { return error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message) ? error.message : fallback; }
const auth = $('#auth'), dash = $('#dashboard'), quick = $('#quick'), editor = $('#editor'), editForm = $('#editor-form'), confirmDialog = $('#confirm');
const fmt = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortFmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const formatDue = value => `${shortFmt.format(new Date(value))} 截止`;
const preferredMotion = matchMedia('(prefers-reduced-motion: reduce)');
let store, userId, deck = [], view = 'pending', filter = null, expanded = null, editing = null, editTrigger, editBusy = false;
let loadTicket = 0, writeVersion = 0, writeCount = 0, hasLoaded = false, firstLoad = true, pendingScroll = 0, bannerAction;
const rowBusy = new Set();
const site = new URL(location.pathname, location.origin);
const params = new URLSearchParams(location.search);
const requested = params.get('view');
const callbackHash = new URLSearchParams(location.hash.slice(1));
const recoveryLink = requested === 'reset' || callbackHash.get('type') === 'recovery';
const authLinkError = params.has('error') || callbackHash.has('error');
let recovery = false, authMode = ['register', 'forgot'].includes(requested) ? requested : 'login';
let awaitingRecovery = recoveryLink;

function notice(text, label, action) {
  bannerAction = action;
  $('#notice').hidden = !text;
  $('#notice-text').textContent = text;
  message($('#notice-action'), label ?? '');
}
$('#notice-action').onclick = () => bannerAction?.();
$('#notice-close').onclick = () => { notice(''); $('.tabs button[aria-pressed="true"]').focus(); };

const legendButtons = GROUPS.map((label, index) => {
  const item = button('', '', () => { if (view === 'done') changeView('pending'); filter = filter === index ? null : index; render(); });
  item.setAttribute('aria-pressed', 'false');
  const dot = el('span', null, 'dot'); dot.style.setProperty('--dot', `var(--group-${index})`);
  item.append(dot, el('span', label), el('span', null, 'legend-count'));
  $('#legend').append(item);
  return item;
});

function render() {
  if (!store) return;
  const now = Date.now(), { pending, done, counts } = summarize(deck, now);
  const visiblePending = filter === null ? pending : pending.filter(row => groupOf(row, now) === filter);
  $('#pending-count').textContent = pending.length;
  $('#done-count').textContent = done.length;
  $('#total').textContent = pending.length;
  let start = 0;
  const stops = counts.flatMap((count, index) => {
    const old = start;
    start += count;
    return count ? [`var(--group-${index}) ${100 * old / pending.length}% ${100 * start / pending.length}%`] : [];
  });
  $('#ring').style.setProperty('--slices', stops.join(',') || 'var(--border) 0% 100%');
  legendButtons.forEach((item, index) => {
    item.setAttribute('aria-pressed', String(view === 'pending' && filter === index));
    item.lastElementChild.textContent = `${counts[index]} 件 · ${pending.length ? Math.round(100 * counts[index] / pending.length) : 0}%`;
    item.disabled = !hasLoaded;
  });
  $('#filter-bar').hidden = view !== 'pending' || filter === null;
  $('#filter-label').textContent = filter === null ? '' : `正在查看：${GROUPS[filter]}`;
  for (const tab of $$('[data-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
  const pendingList = $('#pending-list'), doneList = $('#done-list');
  pendingList.hidden = view !== 'pending'; doneList.hidden = view !== 'done';
  const list = view === 'pending' ? pendingList : doneList;
  const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  if (hasLoaded) {
    const items = view === 'pending' ? visiblePending : done;
    const renderKey = JSON.stringify([view, filter, expanded, [...rowBusy], items.map(t => [t, isUrgent(t, now), isOverdue(t, now)]), pending[0]?.id]);
    if (list.dataset.renderKey !== renderKey) {
      list.dataset.renderKey = renderKey;
      if (items.length) list.replaceChildren(...items.map(t => makeRow(t, now, t.id === pending[0]?.id)));
      else list.replaceChildren(el('p', view === 'done' ? '还没有已完成的任务。' : filter === null ? '暂时没有待办，记下你想做的第一件事吧。' : '这个分组暂时没有任务。', 'empty'));
      if (focusKey) (list.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`) || $(`[data-view="${view}"]`)).focus({ preventScroll: true });
    }
  } else {
    delete list.dataset.renderKey;
    list.replaceChildren();
  }
}

function makeRow(row, now, next) {
  const article = el('article', null, 'task');
  if (next) article.dataset.next = '';
  const line = el('div', null, 'task-line');
  const check = button('', 'task-check', () => setCompleted(row, !row.completed_at));
  check.dataset.focus = `check-${row.id}`;
  check.setAttribute('aria-label', `${row.completed_at ? '重新打开' : '完成'}：${row.title}`);
  check.setAttribute('aria-pressed', String(Boolean(row.completed_at)));
  check.setAttribute('aria-disabled', String(rowBusy.has(row.id)));
  const glyph = el('span', '✓'); glyph.setAttribute('aria-hidden', 'true'); check.append(glyph);
  const title = button('', 'task-title', () => {
    const old = expanded && dash.querySelector(`[data-focus="title-${CSS.escape(expanded)}"]`);
    if (old && old !== title) setFold(old, false);
    expanded = expanded === row.id ? null : row.id;
    setFold(title, expanded === row.id);
  });
  title.dataset.focus = `title-${row.id}`;
  const detailId = `details-${row.id}`;
  title.setAttribute('aria-controls', detailId);
  const tags = el('span', null, 'task-meta');
  if (next) tags.append(el('span', '建议先做', 'label next'));
  if (row.is_important) tags.append(el('span', '重要', 'label'));
  if (!row.completed_at && isOverdue(row, now)) tags.append(el('span', '已逾期', 'label overdue'));
  else if (!row.completed_at && isUrgent(row, now)) tags.append(el('span', '紧急', 'label urgent'));
  if (row.due_at) tags.append(el('span', formatDue(row.due_at)));
  else if (row.completed_at) tags.append(el('span', `${shortFmt.format(new Date(row.completed_at))} 完成`));
  else if (!tags.childElementCount) tags.append(el('span', '无截止时间'));
  const arrow = el('span', '⌄', 'chevron'); arrow.setAttribute('aria-hidden', 'true');
  title.append(el('strong', row.title), tags, arrow);
  const fold = el('div', null, 'fold'); fold.id = detailId;
  const inner = el('div'), info = el('div', null, 'task-details');
  const edit = button('编辑', 'link', () => openEditor(row, edit));
  edit.dataset.focus = `edit-${row.id}`;
  info.append(el('p', row.due_at ? `截止：${fmt.format(new Date(row.due_at))}` : '未设置截止时间'), el('p', row.notes || '无备注', 'task-notes'), edit);
  inner.append(info); fold.append(inner); line.append(check, title); article.append(line, fold);
  setFold(title, row.id === expanded, fold);
  return article;
}
function setFold(title, isOpen, panel = document.getElementById(title.getAttribute('aria-controls'))) {
  if (!panel) return;
  title.setAttribute('aria-expanded', String(isOpen));
  panel.toggleAttribute('data-open', isOpen);
  panel.inert = !isOpen;
}
function changeView(next) {
  if (view === next) return;
  if (view === 'pending') pendingScroll = window.scrollY;
  view = next; expanded = null;
  render();
  if (next === 'pending') window.scrollTo({ top: pendingScroll, behavior: 'instant' });
}
for (const control of $$('[data-view]')) control.onclick = () => changeView(control.dataset.view);
$('#clear-filter').onclick = () => { filter = null; render(); $('[data-view="pending"]').focus({ preventScroll: true }); };

async function load(initial = false) {
  if (!store || (writeCount && !initial)) return;
  const source = store, ticket = ++loadTicket, version = writeVersion;
  if (!hasLoaded) { $('#load-state').hidden = false; $('#load-message').textContent = '正在载入待办…'; $('#retry-load').hidden = true; }
  try {
    const rows = await source.list();
    if (source !== store || ticket !== loadTicket || version !== writeVersion) return;
    deck = rows; hasLoaded = true; $('#load-state').hidden = true; render();
  } catch {
    if (source !== store || ticket !== loadTicket || version !== writeVersion) return;
    $('#load-state').hidden = false;
    $('#load-message').textContent = hasLoaded ? '没有同步到最新待办。当前显示上次载入的内容。' : '暂时无法载入待办，请检查网络后重试。';
    $('#retry-load').hidden = false;
  }
}
$('#retry-load').onclick = () => void load();

async function write(operation, update) {
  const source = store;
  if (!source) return false;
  const needsLoad = !hasLoaded;
  writeCount++;
  writeVersion++;
  try {
    const row = await operation(source);
    if (source !== store) return false;
    update(row);
    return true;
  } catch (error) {
    if (source !== store) return false;
    throw error;
  } finally {
    if (source === store) {
      writeCount--;
      if (needsLoad && !writeCount) void load();
    }
  }
}
function put(row) { deck = [...deck.filter(t => t.id !== row.id), row]; render(); }
async function setCompleted(row, completed) {
  if (rowBusy.has(row.id)) return;
  const source = store;
  rowBusy.add(row.id); render();
  try {
    if (!await write(s => s.edit(row.id, { completed_at: completed ? new Date().toISOString() : null }), put)) return;
    notice(`${completed ? '已完成' : '已重新打开'}：${row.title}`, completed ? '撤销' : null, completed ? () => void setCompleted(row, false) : null);
  } catch (error) { notice(readable(error, '暂时无法更新任务。'), '重试', () => void setCompleted(row, completed)); }
  finally { if (store === source) { rowBusy.delete(row.id); render(); } }
}

const dueToggle = $('#quick-due-toggle');
function openQuickDue(open) { $('#quick-due').hidden = !open; dueToggle.setAttribute('aria-expanded', String(open)); }
function showQuickDue() { dueToggle.textContent = quick.elements.due.value ? formatDue(new Date(quick.elements.due.value)) : '截止时间'; }
dueToggle.onclick = () => openQuickDue($('#quick-due').hidden);
for (const preset of $$('[data-day]')) preset.onclick = () => { quick.elements.due.value = preset.dataset.day === 'clear' ? '' : endOfDay(Number(preset.dataset.day)); showQuickDue(); };
quick.elements.due.addEventListener('input', showQuickDue);
let quickBusy = false;
quick.onsubmit = async event => {
  event.preventDefault();
  if (quickBusy || !store) return;
  const source = store;
  message($('#quick-error'), '');
  let values;
  try { values = fields(quick.elements); } catch (error) { message($('#quick-error'), error.message); return; }
  const submit = quick.querySelector('[type="submit"]');
  const snapshot = JSON.stringify(values);
  quickBusy = true; submit.disabled = true; submit.textContent = '添加中…';
  try {
    let added;
    if (!await write(s => s.add(values), row => { added = row; put(row); })) return;
    try { if (JSON.stringify(fields(quick.elements)) === snapshot) { quick.reset(); openQuickDue(false); showQuickDue(); } } catch { /* Preserve any new input typed during the save. */ }
    const visible = view === 'pending' && (filter === null || groupOf(added, Date.now()) === filter);
    notice(`已添加：${added.title}`, visible ? null : '查看新任务', visible ? null : () => {
      changeView('pending'); filter = null; render();
      const node = $(`[data-focus="title-${CSS.escape(added.id)}"]`);
      node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'nearest' });
    });
  } catch (error) { message($('#quick-error'), readable(error, '未能添加任务，已保留输入，请重试。')); }
  finally { if (source === store) { quickBusy = false; submit.disabled = false; submit.textContent = '＋ 添加'; } }
};

function openEditor(row, trigger) {
  editing = row; editTrigger = trigger;
  editForm.elements.title.value = row.title;
  editForm.elements.important.checked = row.is_important;
  editForm.elements.due.value = localInput(row.due_at);
  editForm.elements.notes.value = row.notes || '';
  message($('#editor-error'), '');
  editor.showModal();
}
function ask(title, body, action) {
  $('#confirm-title').textContent = title; $('#confirm-message').textContent = body; $('#confirm-action').textContent = action;
  confirmDialog.returnValue = '';
  return new Promise(resolve => { confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true }); confirmDialog.showModal(); });
}
function dirty() {
  if (!editing) return false;
  const form = editForm.elements;
  return form.title.value !== editing.title || form.notes.value !== (editing.notes || '') || form.important.checked !== editing.is_important || form.due.value !== localInput(editing.due_at);
}
async function closeEditor() {
  if (!editor.open || editor.dataset.closing) return;
  editor.dataset.closing = 'true';
  if (!preferredMotion.matches) await Promise.allSettled(editor.getAnimations().map(a => a.finished));
  editor.close(); delete editor.dataset.closing;
  if (editTrigger?.isConnected) editTrigger.focus({ preventScroll: true });
  else if (editing) ($(`[data-focus="title-${CSS.escape(editing.id)}"]`) || $(`[data-view="${view}"]`))?.focus({ preventScroll: true });
  editing = null;
}
async function requestEditorClose() {
  if (editBusy || confirmDialog.open || editor.dataset.closing) return;
  if (dirty() && !await ask('放弃未保存的修改？', '关闭后，这次修改不会保留。', '放弃修改')) return;
  await closeEditor();
}
for (const b of $$('[data-close-editor]')) b.onclick = () => void requestEditorClose();
editor.addEventListener('cancel', event => { event.preventDefault(); void requestEditorClose(); });
function editorBusy(value) { editBusy = value; for (const control of editForm.querySelectorAll('button,input,textarea')) control.disabled = value; }
editForm.onsubmit = async event => {
  event.preventDefault(); if (!editing || editBusy || editor.dataset.closing) return;
  const source = store, id = editing.id; let values;
  try { values = fields(editForm.elements); } catch (error) { message($('#editor-error'), error.message); return; }
  const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => {
    if (key === 'due_at') return localInput(value) !== localInput(editing.due_at);
    return value !== (key === 'notes' ? editing.notes || null : editing[key]);
  }));
  if (!Object.keys(patch).length) { await closeEditor(); return; }
  editorBusy(true); message($('#editor-error'), '');
  try { if (await write(s => s.edit(id, patch), put)) { await closeEditor(); if (source === store) notice(`已保存：${values.title}`); } }
  catch (error) { message($('#editor-error'), readable(error, '未能保存修改，已保留输入，请重试。')); }
  finally { if (source === store) editorBusy(false); }
};
$('#delete-task').onclick = async () => {
  if (!editing || editBusy || confirmDialog.open) return;
  const source = store, row = editing;
  if (!await ask('删除这件待办？', `「${row.title}」删除后不可恢复。`, '删除') || source !== store) return;
  editorBusy(true); message($('#editor-error'), '');
  try {
    if (await write(s => s.remove(row.id), () => { deck = deck.filter(t => t.id !== row.id); if (expanded === row.id) expanded = null; render(); })) {
      await closeEditor(); if (source === store) notice(`已删除：${row.title}`);
    }
  } catch (error) { message($('#editor-error'), readable(error, '未能删除任务，请重试。')); }
  finally { if (source === store) editorBusy(false); }
};

function clearDashboard() {
  store = null; userId = null; deck = []; view = 'pending'; filter = null; expanded = null; editing = null; editTrigger = null;
  hasLoaded = false; writeCount = 0; rowBusy.clear(); pendingScroll = 0; loadTicket++;
  if (confirmDialog.open) confirmDialog.close(); if (editor.open) editor.close();
  delete editor.dataset.closing; editForm.reset(); editorBusy(false); message($('#editor-error'), '');
  quick.reset(); quickBusy = false; quick.querySelector('[type="submit"]').disabled = false; quick.querySelector('[type="submit"]').textContent = '＋ 添加';
  openQuickDue(false); showQuickDue(); message($('#quick-error'), ''); notice('');
  for (const list of [$('#pending-list'), $('#done-list')]) { list.replaceChildren(); delete list.dataset.renderKey; }
}
function showDashboard(id) {
  if (store && userId === id) return;
  clearDashboard(); userId = id; store = demo ? memoryStore() : cloudStore(id);
  auth.hidden = true; auth.replaceChildren(); dash.hidden = false; $('#demo-note').hidden = !demo; $('#sign-out').hidden = demo;
  render(); void load(true);
}

function authURL(mode) { const target = new URL(site); if (mode !== 'login') target.searchParams.set('view', mode); return target; }
function authLink(label, mode) {
  const node = el('a', label); node.href = authURL(mode);
  node.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); awaitingRecovery = false; history.pushState({}, '', authURL(mode)); authMode = mode; showAuth(mode); });
  return node;
}
function showAuth(mode, initialNotice = '') {
  dash.hidden = true; $('#sign-out').hidden = true; auth.hidden = false;
  const names = { login: '登录', register: '注册', forgot: '找回密码', reset: '设置新密码', expired: '链接无效或已过期', unconfigured: '站点尚未配置', loading: '正在检查登录状态…' };
  const box = el('div', null, 'auth-card'), title = el('h1', names[mode]); title.id = 'auth-title'; box.append(title); auth.replaceChildren(box);
  if (mode === 'loading') return;
  if (mode === 'unconfigured') { box.append(el('p', '当前站点还没有可用的 Supabase 配置，请联系站点管理员。')); return; }
  if (mode === 'expired') { box.append(el('p', '请重新申请密码重置邮件后，打开最新一封邮件中的链接。'), authLink('重新申请', 'forgot'), authLink('返回登录', 'login')); return; }
  const result = el('p', initialNotice, 'auth-message'); result.setAttribute('role', 'status'); result.hidden = !initialNotice;
  const failure = el('p', null, 'error'); failure.setAttribute('role', 'alert'); failure.hidden = true;
  const form = el('form', null, 'auth-form');
  const addInput = (label, type, name, autocomplete) => {
    const wrap = el('label', label), input = el('input'); input.type = type; input.name = name; input.autocomplete = autocomplete; input.required = true;
    if (type === 'password' && mode !== 'login') input.minLength = 8;
    wrap.append(input); form.append(wrap);
  };
  if (mode !== 'reset') addInput('邮箱', 'email', 'email', 'email');
  if (mode !== 'forgot') addInput(mode === 'reset' ? '新密码（至少 8 个字符）' : mode === 'register' ? '密码（至少 8 个字符）' : '密码', 'password', 'password', mode === 'login' ? 'current-password' : 'new-password');
  if (mode === 'reset') addInput('再次输入新密码', 'password', 'repeat', 'new-password');
  const submit = el('button', { login: '登录', register: '注册', forgot: '发送重置邮件', reset: '保存新密码' }[mode], 'primary'); submit.type = 'submit';
  form.append(failure, submit); box.append(result, form);
  const links = el('nav', null, 'auth-links'); links.setAttribute('aria-label', '账号操作');
  if (mode === 'login') links.append(authLink('创建账号', 'register'), authLink('忘记密码？', 'forgot'));
  else if (mode !== 'reset') links.append(authLink('返回登录', 'login'));
  if (links.childElementCount) box.append(links);
  form.onsubmit = async event => {
    event.preventDefault(); if (submit.disabled) return;
    message(failure, ''); message(result, '');
    const email = form.elements.email?.value.trim(), password = form.elements.password?.value;
    if (mode === 'reset' && password !== form.elements.repeat.value) { message(failure, '两次输入的密码不一致。'); return; }
    submit.disabled = true; form.setAttribute('aria-busy', 'true');
    try {
      if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error;
      } else if (mode === 'register') {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: String(site) } }); if (error) throw error;
        if (!data.session) { form.reset(); message(result, '请查收邮箱验证邮件，验证之后即可登录。'); }
      } else if (mode === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: String(authURL('reset')) }); if (error) throw error;
        message(result, '如果该邮箱已注册，你将收到重置邮件。');
      } else if (mode === 'reset' && recovery) {
        const { error } = await client.auth.updateUser({ password }); if (error) throw error;
        const { error: signoutError } = await client.auth.signOut({ scope: 'local' }); if (signoutError) throw signoutError;
        recovery = false; authMode = 'login'; history.replaceState({}, '', site); showAuth('login', '密码已更新，请用新密码登录。');
      }
    } catch (error) {
      const messages = { login: '登录失败，请检查邮箱、密码和网络。', register: '暂时无法注册，请检查输入或稍后再试。', forgot: '暂时无法发送重置邮件，请稍后再试。', reset: '暂时无法设置新密码，请重试或重新申请链接。' };
      message(failure, error?.code === 'email_not_confirmed' ? '请先在邮件中验证邮箱地址。' : messages[mode]);
    } finally { submit.disabled = false; form.removeAttribute('aria-busy'); }
  };
}

$('#sign-out').onclick = async () => {
  const control = $('#sign-out'); control.disabled = true;
  try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; }
  catch { notice('退出登录失败，请重试。'); }
  finally { control.disabled = false; }
};
function authEvent(event, session) {
  if (event === 'PASSWORD_RECOVERY' && session && awaitingRecovery) { recovery = true; clearDashboard(); showAuth('reset'); return; }
  if (event === 'SIGNED_OUT') {
    const expired = Boolean(store) && !$('#sign-out').disabled;
    recovery = false; awaitingRecovery = false; clearDashboard(); authMode = 'login'; history.replaceState({}, '', site);
    showAuth('login', expired ? '会话已结束，请重新登录。' : ''); return;
  }
  if (recovery || awaitingRecovery) return;
  if (session) { if (document.visibilityState === 'visible' && userId === session.user.id && !firstLoad) return; history.replaceState({}, '', site); showDashboard(session.user.id); }
  else { clearDashboard(); showAuth(authMode, authLinkError ? '验证链接无法使用，请重新申请或返回登录。' : ''); }
  firstLoad = false;
}
window.addEventListener('popstate', () => { if (!store && !recovery && client) { const mode = new URLSearchParams(location.search).get('view'); awaitingRecovery = mode === 'reset'; authMode = ['register', 'forgot'].includes(mode) ? mode : 'login'; showAuth(awaitingRecovery ? 'expired' : authMode); } });
window.addEventListener('hashchange', () => {
  const next = new URLSearchParams(location.hash.slice(1));
  if (client && next.get('type') === 'recovery' && next.has('access_token')) location.reload();
});
const narrow = matchMedia('(max-width: 720px)');
function overviewLayout() { $('#overview').open = !narrow.matches; }
overviewLayout(); narrow.addEventListener('change', overviewLayout);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store) { render(); void load(); } });
window.addEventListener('pageshow', event => { if (event.persisted && store) void load(); });
setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30_000);

if (demo) showDashboard('demo');
else if (!client) showAuth('unconfigured');
else {
  showAuth('loading');
  client.auth.onAuthStateChange((event, session) => { queueMicrotask(() => authEvent(event, session)); });
  const { data } = await client.auth.getSession().catch(() => ({ data: null }));
  if (recoveryLink) {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!recovery && !store) showAuth('expired');
  } else if (!store && !recovery && firstLoad) authEvent('INITIAL_SESSION', data?.session);
}
