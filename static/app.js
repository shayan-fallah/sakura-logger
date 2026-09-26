/* ✿ Sakura Log — frontend (vanilla JS, no build step) */
'use strict';

// ------------------------------------------------------------------ constants

const PALETTE = ['#e0508f', '#3b9ee8', '#e8a317', '#8b6cf0', '#22b58a', '#f0654f', '#14a3b8', '#b04fc9'];
const NO_PROJECT_COLOR = '#b9a6c2';
const DEFAULT_PREFS = {
  calendar: 'jalali', persian: true, weekStart: 'auto', theme: 'auto',
  wallpaper: '', petals: true, mascot: true, goal: 8,
};
const JM_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const JM_EN = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];
const GM_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const WD_FA_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LINES = {
  idle: ['Ready when you are, senpai~ ✿', 'What shall we work on today?', "Let's do our best! 頑張ろう!",
    'Pick a project and press ▶ ♡', 'امروز روی چی کار کنیم؟ ✿', 'Hehe~ I kept your seat warm (´｡• ᵕ •｡`)'],
  working: ['Focus mode ON! (ง •̀_•́)ง', "You're doing great~ ✧", "I'll keep the time for you ⏱",
    'Sugoi! Keep going~', "Don't forget to drink water 💧", 'داری عالی پیش میری! ✧', 'Ganbatte, senpai! ٩(◕‿◕)۶'],
  tea: ["It's been a while… tea break? 🍵", 'Stretch a little, senpai~ (｡•̀ᴗ-)✧', 'Your eyes need a rest too ♡'],
  shock: ['Ehh?! Did you forget to stop the timer?! (⊙_⊙;)'],
  done: ['Otsukare-sama deshita~! {d} ✧', 'Nice session! {d} logged ♡', 'خسته نباشی! ✿ {d}'],
  goal: ["Daily goal reached!! You're amazing ☆彡", 'Goal cleared! Sugoi sugoi~ ✧*｡٩(ˊᗜˋ*)و✧*｡'],
};

// ------------------------------------------------------------------ state

const S = {
  prefs: { ...DEFAULT_PREFS },
  projects: [], P: new Map(), T: new Map(),
  running: null,
  recent: [], days: 14,
  draft: loadDraft(),
  view: 'timer',
  cal: null, calEntries: [],
  rep: { preset: 'week', from: null, to: null }, repEntries: [], repOpen: new Set(),
  moodKey: '',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowS = () => Math.floor(Date.now() / 1000);
const ts = (d) => Math.floor(d.getTime() / 1000);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const val = (sel) => (sel.value === '' || sel.value.startsWith('__') ? null : Number(sel.value));

function loadDraft() {
  try { return JSON.parse(localStorage.getItem('sakura-draft')) || {}; } catch { return {}; }
}
function saveDraft() {
  try { localStorage.setItem('sakura-draft', JSON.stringify(S.draft)); } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------------ api & ui helpers

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('Please log in again');
  }
  if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
  return data;
}

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 2600);
}

// Wraps an async action so failures surface as a toast instead of disappearing.
const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { toast(e.message || 'Something went wrong', true); }
};

function modal(html) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="card modal" role="dialog">${html}</div>`;
  document.body.append(bd);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { bd.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  const first = bd.querySelector('input:not([type=hidden]), select');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: bd.firstElementChild, close };
}

function confirmBox(title, msg, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p>
      <div class="actions"><button class="btn ghost" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(okLabel)}</button></div>`);
    m.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      m.close();
      resolve(a.dataset.a === 'yes');
    });
    $('[data-a=yes]', m.el).focus();
  });
}

function promptBox(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const m = modal(`<form><h2>${esc(title)}</h2><input class="input" maxlength="120" placeholder="${esc(placeholder)}" value="${esc(value)}">
      <div class="actions"><button type="button" class="btn ghost" data-a="no">Cancel</button><button class="btn primary">OK</button></div></form>`);
    const input = $('input', m.el);
    $('form', m.el).addEventListener('submit', (e) => {
      e.preventDefault();
      m.close();
      resolve(input.value.trim() || null);
    });
    $('[data-a=no]', m.el).onclick = () => { m.close(); resolve(null); };
  });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ dates & calendars

const isJ = () => S.prefs.calendar === 'jalali';
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const jn = (x) => (S.prefs.persian ? faDigits(x) : String(x)); // number in Jalali style
const pad = (n) => String(n).padStart(2, '0');

const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function jalaliLabel(d, weekday = false) {
  const j = Jalali.fromDate(d);
  if (S.prefs.persian) {
    const s = `${weekday ? WD_FA[d.getDay()] + ' ' : ''}${faDigits(j.jd)} ${JM_FA[j.jm - 1]} ${faDigits(j.jy)}`;
    return `<span class="fa" dir="rtl">${s}</span>`;
  }
  return `${weekday ? WD_EN[d.getDay()] + ', ' : ''}${j.jd} ${JM_EN[j.jm - 1]} ${j.jy}`;
}
function gregLabel(d, weekday = false) {
  return d.toLocaleDateString('en-GB', { weekday: weekday ? 'short' : undefined, day: 'numeric', month: 'short', year: 'numeric' });
}
const primaryDate = (d, wd) => (isJ() ? jalaliLabel(d, wd) : gregLabel(d, wd));
const secondaryDate = (d, wd) => (isJ() ? gregLabel(d, wd) : jalaliLabel(d, wd));

function shortSecondary(d) {
  if (isJ()) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const j = Jalali.fromDate(d);
  return S.prefs.persian ? `<span class="fa">${faDigits(j.jd)} ${JM_FA[j.jm - 1]}</span>` : `${j.jd} ${JM_EN[j.jm - 1].slice(0, 3)}`;
}
const dayNum = (d) => (isJ() ? jn(Jalali.fromDate(d).jd) : String(d.getDate()));

function monthOf(d) {
  if (isJ()) { const j = Jalali.fromDate(d); return { y: j.jy, m: j.jm }; }
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}
const monthStart = (y, m) => (isJ() ? Jalali.toDate(y, m, 1) : new Date(y, m - 1, 1));
function shiftMonth(y, m, k) {
  const i = y * 12 + (m - 1) + k;
  return { y: Math.floor(i / 12), m: (((i % 12) + 12) % 12) + 1 };
}
function monthRange(y, m) {
  const n = shiftMonth(y, m, 1);
  return [monthStart(y, m), monthStart(n.y, n.m)];
}
function monthTitle(y, m, compact = false) {
  if (!isJ()) return `${GM_EN[m - 1]} ${y}`;
  const fa = `<span class="fa" dir="rtl">${JM_FA[m - 1]} ${faDigits(y)}</span>`;
  if (S.prefs.persian) return compact ? fa : `${fa} <span class="muted small">· ${JM_EN[m - 1]}</span>`;
  return `${JM_EN[m - 1]} ${y}`;
}
function yearRange(d) {
  if (isJ()) { const jy = Jalali.fromDate(d).jy; return [Jalali.toDate(jy, 1, 1), Jalali.toDate(jy + 1, 1, 1)]; }
  return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear() + 1, 0, 1)];
}
function weekStartDay() {
  const w = S.prefs.weekStart;
  return w === 'auto' ? (isJ() ? 6 : 1) : Number(w);
}
const startOfWeek = (d) => addDays(sod(d), -((d.getDay() - weekStartDay() + 7) % 7));
function gridDays(y, m) {
  const [a, b] = monthRange(y, m);
  const out = [];
  for (let d = startOfWeek(a); d < b || out.length % 7; d = addDays(d, 1)) out.push(d);
  return out;
}
function weekdayHeads() {
  const ws = weekStartDay();
  return Array.from({ length: 7 }, (_, i) => {
    const wd = (ws + i) % 7;
    return `<div class="cal-wd">${isJ() && S.prefs.persian ? `<span class="fa">${WD_FA_SHORT[wd]}</span>` : WD_EN[wd]}</div>`;
  }).join('');
}
// Persian-script Shamsi calendars read right to left, Saturday first on the right.
const gridDir = () => (isJ() && S.prefs.persian ? 'dir="rtl"' : '');
const isWeekend = (d) => (isJ() ? d.getDay() === 5 : d.getDay() === 0 || d.getDay() === 6);

const hm = (t) => { const d = new Date(t * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}
function hrs(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? ' ' + pad(m % 60) + 'm' : ''}`;
}
const endOf = (e) => e.end_ts ?? nowS();
const overlap = (e, a, b) => Math.max(0, Math.min(endOf(e), b) - Math.max(e.start_ts, a));
const sumRange = (list, a, b) => list.reduce((s, e) => s + overlap(e, a, b), 0);

// ------------------------------------------------------------------ mascot

function mascotSVG(cls = '') {
  return `<svg class="mascot ${cls}" viewBox="0 0 120 140" role="img" aria-label="Sakura-chan, your time keeper">
  <path d="M24 44C4 58 2 96 16 124c2-20 8-38 18-54z" fill="var(--hair-dark)"/>
  <path d="M96 44c20 14 22 52 8 80-2-20-8-38-18-54z" fill="var(--hair-dark)"/>
  <path d="M34 112c4-10 14-14 26-14s22 4 26 14l6 28H28z" fill="#fff"/>
  <path d="M40 104l20 20 20-20c-6-4-13-6-20-6s-14 2-20 6z" fill="#5b7fe0"/>
  <path d="M43 106l17 15 17-15" stroke="#fff" stroke-width="1.5" fill="none"/>
  <path d="M52 112l8 8 8-8-4 16-4-6-4 6z" fill="#e0508f"/>
  <rect x="54" y="88" width="12" height="14" rx="4" fill="var(--skin)"/>
  <path d="M22 62c-2-34 20-48 38-48s40 14 38 48l-2 30c-8 4-64 4-72 0z" fill="var(--hair-dark)"/>
  <ellipse cx="60" cy="64" rx="30" ry="29" fill="var(--skin)"/>
  <ellipse cx="41" cy="78" rx="6" ry="3.2" fill="#ff8fb3" opacity=".55"/>
  <ellipse cx="79" cy="78" rx="6" ry="3.2" fill="#ff8fb3" opacity=".55"/>
  <g class="eyes-open">
    <ellipse cx="47" cy="68" rx="6.5" ry="8.5" fill="var(--eye)"/>
    <ellipse cx="47" cy="70.5" rx="4.6" ry="5.4" fill="var(--eye-2)"/>
    <circle cx="44.8" cy="65" r="2.7" fill="#fff"/><circle cx="49.5" cy="72.5" r="1.2" fill="#fff"/>
    <ellipse cx="73" cy="68" rx="6.5" ry="8.5" fill="var(--eye)"/>
    <ellipse cx="73" cy="70.5" rx="4.6" ry="5.4" fill="var(--eye-2)"/>
    <circle cx="70.8" cy="65" r="2.7" fill="#fff"/><circle cx="75.5" cy="72.5" r="1.2" fill="#fff"/>
    <path d="M38.5 62.5Q47 56 55.5 61M64.5 61Q73 56 81.5 62.5" stroke="#3b2340" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </g>
  <g class="eyes-happy" stroke="#3b2340" stroke-width="2.6" fill="none" stroke-linecap="round">
    <path d="M40 70q7-9 14 0"/><path d="M66 70q7-9 14 0"/>
  </g>
  <path class="mouth-smile" d="M55 83q5 5 10 0" stroke="#c0395f" stroke-width="2" fill="none" stroke-linecap="round"/>
  <ellipse class="mouth-o" cx="60" cy="85" rx="3" ry="3.6" fill="#c0395f"/>
  <path d="M28 60c-2-28 16-40 32-40s34 12 32 40l-6-12-4 8-8-16-6 14-6-16-6 16-8-14-6 15-6-9z" fill="var(--hair)"/>
  <path d="M30 50c-4 16-2 32 2 42 2-12 4-26 6-36zM90 50c4 16 2 32-2 42-2-12-4-26-6-36z" fill="var(--hair)"/>
  <path class="ahoge" d="M60 21c-4-13 6-19 14-15-8 1-12 6-14 15z" fill="var(--hair)"/>
  <g fill="#ff5fa2"><circle cx="26" cy="46" r="5"/><circle cx="94" cy="46" r="5"/></g>
  <g fill="#fff"><circle cx="26" cy="46" r="1.8"/><circle cx="94" cy="46" r="1.8"/></g>
  <path class="sweat" d="M88 50c-4 6-2 10 1 10s4-4-1-10z" fill="#8fd3ff"/>
</svg>`;
}

function mood() {
  if (!S.running) return 'idle';
  const el = nowS() - S.running.start_ts;
  if (el > 12 * 3600) return 'shock';
  if (el > 3 * 3600) return 'tea';
  return 'working';
}

function say(text, cls) {
  const b = $('#bubble'), m = $('.hero .mascot');
  if (!b || !m) return;
  b.textContent = text;
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  m.classList.remove('happy', 'shock', 'working');
  if (cls) m.classList.add(cls);
  m.classList.remove('bounce'); void m.getBoundingClientRect(); m.classList.add('bounce');
}

function sayMood(force = false) {
  const md = mood();
  if (!force && md === S.moodKey) return;
  S.moodKey = md;
  const cls = { idle: '', working: 'working', tea: 'working', shock: 'shock' }[md];
  say(pick(LINES[md]), cls);
}

// ------------------------------------------------------------------ prefs & ambience

function applyPrefs() {
  const p = S.prefs;
  const dark = p.theme === 'night' || (p.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'night' : 'day';
  const wp = $('#wallpaper');
  if (p.wallpaper) {
    wp.style.backgroundImage = `url(${JSON.stringify(p.wallpaper)})`;
    wp.classList.add('on');
  } else {
    wp.style.backgroundImage = '';
    wp.classList.remove('on');
  }
  const sky = $('#sky');
  sky.innerHTML = '';
  if (p.petals) {
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('i');
      el.className = 'petal';
      const dur = 9 + Math.random() * 10;
      el.style.left = `${Math.random() * 100}%`;
      el.style.animationDuration = dark ? `${1.5 + Math.random() * 3}s` : `${dur}s, ${2 + Math.random() * 3}s`;
      el.style.animationDelay = `${-Math.random() * dur}s`;
      if (dark) el.style.top = `${Math.random() * 100}%`;
      el.style.scale = String(0.6 + Math.random() * 0.8);
      sky.append(el);
    }
  }
  $('#today-chip').innerHTML = `${primaryDate(new Date(), true)}`;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefs());

async function savePrefs(patch) {
  Object.assign(S.prefs, patch);
  applyPrefs();
  await api('PUT', '/api/prefs', S.prefs);
}

// ------------------------------------------------------------------ data loading

async function loadProjects() {
  S.projects = await api('GET', '/api/projects');
  S.P = new Map(S.projects.map((p) => [p.id, p]));
  S.T = new Map(S.projects.flatMap((p) => p.tasks.map((t) => [t.id, t])));
}
async function loadTimer() {
  S.running = (await api('GET', '/api/timer')).running;
}
async function loadRecent() {
  const from = addDays(sod(new Date()), -(S.days - 1));
  S.recent = await api('GET', `/api/entries?from=${ts(from)}&to=${nowS() + 86400}`);
}
const fetchRange = (a, b) => api('GET', `/api/entries?from=${ts(a)}&to=${ts(b)}`);

const projColor = (pid) => (S.P.get(pid)?.color || NO_PROJECT_COLOR);
const projName = (pid) => (pid == null ? 'No project' : S.P.get(pid)?.name || 'Deleted project');

function projectOptions(sel) {
  const list = S.projects.filter((p) => !p.archived || p.id === sel);
  return `<option value="">— No project —</option>${list.map((p) =>
    `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
    <option value="__new">＋ New project…</option>`;
}
function taskOptions(pid, sel) {
  if (!pid) return '<option value="">— No task —</option>';
  const tasks = (S.P.get(pid)?.tasks || []).filter((t) => !t.done || t.id === sel);
  return `<option value="">— No task —</option>${tasks.map((t) =>
    `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
    <option value="__new">＋ New task…</option>`;
}

// Hooks up a project/task select pair, including the "＋ New …" shortcuts.
function wirePT(ps, tsel, onChange) {
  let lastP = ps.value, lastT = tsel.value;
  ps.onchange = safe(async () => {
    if (ps.value === '__new') {
      const name = await promptBox('New project ✿', 'Project name');
      if (!name) { ps.value = lastP; return; }
      const p = await api('POST', '/api/projects', { name, color: PALETTE[S.projects.length % PALETTE.length] });
      await loadProjects();
      ps.innerHTML = projectOptions(p.id);
      toast(`Project “${p.name}” created ✿`);
    }
    lastP = ps.value;
    tsel.innerHTML = taskOptions(val(ps), null);
    lastT = tsel.value;
    onChange();
  });
  tsel.onchange = safe(async () => {
    if (tsel.value === '__new') {
      const name = await promptBox('New task ✧', 'Task name');
      if (!name) { tsel.value = lastT; return; }
      const t = await api('POST', '/api/tasks', { project_id: val(ps), name });
      await loadProjects();
      tsel.innerHTML = taskOptions(val(ps), t.id);
    }
    lastT = tsel.value;
    onChange();
  });
}

// ------------------------------------------------------------------ login & navigation

function showLogin() {
  $('#main').hidden = true;
  $('#login').hidden = false;
  $('#login-mascot').innerHTML = mascotSVG('happy');
  $('#login-pw').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-err');
  err.textContent = '';
  try {
    await api('POST', '/api/login', { password: $('#login-pw').value });
    $('#login-pw').value = '';
    await showMain();
  } catch (ex) {
    err.textContent = ex.message + ' (｡•́︿•̀｡)';
  }
});

async function showMain() {
  S.prefs = { ...DEFAULT_PREFS, ...(await api('GET', '/api/prefs')) };
  applyPrefs();
  await Promise.all([loadProjects(), loadTimer()]);
  $('#login').hidden = true;
  $('#main').hidden = false;
  go(location.hash.slice(1) || 'timer');
}

const VIEWS = {};
function go(view) {
  if (!VIEWS[view]) view = 'timer';
  S.view = view;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  safe(VIEWS[view])();
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});
window.addEventListener('hashchange', () => { if (!$('#main').hidden) go(location.hash.slice(1)); });

const rerender = () => go(S.view);

// ------------------------------------------------------------------ timer view

VIEWS.timer = async function () {
  const r = S.running;
  const cur = r || S.draft;
  const pid = cur.project_id ?? null, tid = cur.task_id ?? null;
  $('#view').innerHTML = `
  <section class="card hero ${S.prefs.mascot ? '' : 'solo'}">
    <div class="mascot-box" ${S.prefs.mascot ? '' : 'hidden'}>${mascotSVG(r ? 'working' : '')}<div class="bubble" id="bubble" dir="auto"></div></div>
    <div class="timer-main">
      <input class="input" id="t-desc" maxlength="500" placeholder="What are you working on, senpai? ✎" value="${esc(cur.description || '')}">
      <div class="row">
        <select class="input" id="t-proj" aria-label="Project">${projectOptions(pid)}</select>
        <select class="input" id="t-task" aria-label="Task">${taskOptions(pid, tid)}</select>
      </div>
      <div class="timer-row">
        <div class="clock ${r ? 'on' : ''}" id="clock">${r ? clock(nowS() - r.start_ts) : '0:00:00'}</div>
        <button class="go ${r ? 'stop' : ''}" id="go" title="${r ? 'Stop timer' : 'Start timer'}">${r ? '■' : '▶'}</button>
      </div>
      <div class="stats">
        <div class="stat"><span>TODAY</span><b id="st-today">–</b></div>
        <div class="stat"><span>THIS WEEK</span><b id="st-week">–</b></div>
        <div class="stat"><span>DAILY GOAL</span><b id="st-goal">–</b></div>
      </div>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h2><span class="deco">✿</span> Recent entries</h2>
      <button class="btn sm" id="add-entry">＋ Manual entry</button></div>
    <div id="entries"><div class="empty-state">Loading… ✧</div></div>
    <div style="text-align:center"><button class="btn ghost sm" id="more">Show older ↓</button></div>
  </section>`;

  S.moodKey = '';
  sayMood(true);
  $('.hero .mascot')?.addEventListener('click', () => { S.moodKey = ''; sayMood(true); });

  const desc = $('#t-desc'), ps = $('#t-proj'), tsel = $('#t-task');
  const sync = safe(async () => {
    const data = { description: desc.value.trim(), project_id: val(ps), task_id: val(tsel) };
    if (S.running) {
      S.running = await api('PATCH', `/api/entries/${S.running.id}`, data);
      await refreshEntries();
    } else {
      S.draft = data;
      saveDraft();
    }
  });
  wirePT(ps, tsel, sync);
  desc.addEventListener('change', sync);
  desc.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!S.running) startTimer(); else desc.blur(); } });
  $('#go').onclick = () => (S.running ? stopTimer() : startTimer());
  $('#add-entry').onclick = () => openEntryEditor(null);
  $('#more').onclick = safe(async () => { S.days += 14; await refreshEntries(); });
  $('#entries').addEventListener('click', onEntryAction);
  await refreshEntries();
};

const startTimer = safe(async (preset) => {
  const data = preset || {
    description: $('#t-desc')?.value.trim() || '',
    project_id: $('#t-proj') ? val($('#t-proj')) : null,
    task_id: $('#t-task') ? val($('#t-task')) : null,
  };
  S.running = (await api('POST', '/api/timer/start', data)).running;
  S.draft = {};
  saveDraft();
  if (S.view === 'timer') await VIEWS.timer(); else go('timer');
  say(pick(LINES.working), 'working');
  S.moodKey = 'working';
});

const stopTimer = safe(async () => {
  // Celebrate only when this session is what pushed today over the goal.
  const today = todayTotal();
  const session = S.running ? overlap(S.running, ts(sod(new Date())), nowS() + 1) : 0;
  const res = await api('POST', '/api/timer/stop');
  S.running = null;
  S.draft = {};
  saveDraft();
  await VIEWS.timer();
  if (res.stopped) {
    const d = hrs(res.stopped.end_ts - res.stopped.start_ts);
    const goal = S.prefs.goal * 3600;
    const reached = goal > 0 && today >= goal && today - session < goal;
    say((reached ? pick(LINES.goal) : pick(LINES.done)).replace('{d}', d), 'happy');
    S.moodKey = 'idle';
  }
});

async function refreshEntries() {
  await loadRecent();
  if (S.view === 'timer') renderEntries();
}

function entryRow(e, dayA, dayB) {
  const p = S.P.get(e.project_id), t = S.T.get(e.task_id);
  const running = e.end_ts == null;
  const secs = dayA != null ? overlap(e, dayA, dayB) : endOf(e) - e.start_ts;
  const multiDay = !running && !sameDay(new Date(e.start_ts * 1000), new Date(e.end_ts * 1000));
  return `<div class="entry ${running ? 'running' : ''}" data-id="${e.id}">
    <div class="what">
      <div class="desc ${e.description ? '' : 'empty'}" dir="auto">${esc(e.description) || '(no description)'}${running ? '<span class="tag-live">LIVE</span>' : ''}</div>
      <div class="proj"><span class="dot" style="background:${projColor(e.project_id)}"></span>${esc(p ? p.name : projName(e.project_id))}${t ? ` <span class="muted">› ${esc(t.name)}</span>` : ''}</div>
    </div>
    <div class="span">${hm(e.start_ts)} – ${running ? 'now' : hm(e.end_ts)}${multiDay ? ' <span title="Ends on another day">⁺¹</span>' : ''}</div>
    <div class="dur" ${running && dayA == null ? `data-live="${e.start_ts}"` : ''}>${clock(secs)}</div>
    <div class="acts">
      <button class="icon-btn" data-act="continue" title="Continue this">▶</button>
      <button class="icon-btn" data-act="edit" title="Edit">✎</button>
      <button class="icon-btn" data-act="del" title="Delete">✕</button>
    </div>
  </div>`;
}

function renderEntries() {
  const box = $('#entries');
  if (!box) return;
  if (!S.recent.length) {
    box.innerHTML = `<div class="empty-state"><span class="big">🌸</span>No entries yet — press ▶ to start your first session!</div>`;
    return;
  }
  const groups = new Map();
  for (const e of S.recent) {
    const k = dayKey(new Date(e.start_ts * 1000));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  box.innerHTML = [...groups.values()].map((list) => {
    const d = sod(new Date(list[0].start_ts * 1000));
    const done = list.filter((e) => e.end_ts != null).reduce((s, e) => s + e.end_ts - e.start_ts, 0);
    const run = list.find((e) => e.end_ts == null);
    return `<div class="day">
      <div class="day-head"><div><span class="d">${primaryDate(d, true)}</span><span class="d2">${secondaryDate(d)}</span></div>
      <span class="tot" data-base="${done}" ${run ? `data-run="${run.start_ts}"` : ''}>${clock(done + (run ? nowS() - run.start_ts : 0))}</span></div>
      ${list.map((e) => entryRow(e)).join('')}
    </div>`;
  }).join('');
  tick();
}

const findEntry = (id) => [...S.recent, ...S.calEntries, ...S.repEntries].find((e) => e.id === id);

async function onEntryAction(ev) {
  const btn = ev.target.closest('[data-act]');
  const row = ev.target.closest('.entry');
  if (!btn || !row) return;
  const e = findEntry(Number(row.dataset.id));
  if (!e) return;
  if (btn.dataset.act === 'continue') {
    startTimer({ description: e.description, project_id: e.project_id, task_id: e.task_id });
  } else if (btn.dataset.act === 'edit') {
    openEntryEditor(e);
  } else if (btn.dataset.act === 'del') {
    if (!(await confirmBox('Delete entry?', `${e.description || '(no description)'} · ${clock(endOf(e) - e.start_ts)}`))) return;
    await safe(async () => {
      await api('DELETE', `/api/entries/${e.id}`);
      if (S.running?.id === e.id) S.running = null;
      toast('Entry deleted');
      await afterEntryChange();
    })();
  }
}

async function afterEntryChange() {
  await loadProjects();
  await loadTimer();
  rerender();
}

// ------------------------------------------------------------------ entry editor & date picker

function miniPicker(el, date, onPick) {
  let { y, m } = monthOf(date);
  const today = new Date();
  const draw = () => {
    el.innerHTML = `<div class="mini">
      <div class="mini-head"><button type="button" class="icon-btn" data-k="-1">‹</button><span>${monthTitle(y, m, true)}</span><button type="button" class="icon-btn" data-k="1">›</button></div>
      <div class="cal-grid" ${gridDir()}>${weekdayHeads()}${gridDays(y, m).map((d) => {
        const mo = monthOf(d);
        const cls = [mo.y === y && mo.m === m ? '' : 'out', sameDay(d, date) ? 'sel' : '', sameDay(d, today) ? 'today' : '', isWeekend(d) ? 'holiday' : ''].join(' ');
        return `<div class="cal-cell ${cls}" data-t="${d.getTime()}"><span class="n">${dayNum(d)}</span></div>`;
      }).join('')}</div></div>`;
  };
  el.onclick = (e) => {
    const k = e.target.closest('[data-k]');
    if (k) { ({ y, m } = shiftMonth(y, m, Number(k.dataset.k))); draw(); return; }
    const c = e.target.closest('[data-t]');
    if (c) { date = new Date(Number(c.dataset.t)); draw(); onPick(date); }
  };
  draw();
}

function openEntryEditor(entry, defaultDate) {
  const isNew = !entry;
  const running = entry && entry.end_ts == null;
  let date, start, end;
  if (entry) {
    const s = new Date(entry.start_ts * 1000);
    date = sod(s);
    start = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
    end = running ? '' : hm(entry.end_ts);
  } else {
    date = sod(defaultDate || new Date());
    if (sameDay(date, new Date())) {
      const n = new Date();
      const e = new Date(n.getTime() - (n.getMinutes() % 5) * 60000);
      const s = new Date(e.getTime() - 3600000);
      if (sameDay(s, e)) { start = `${pad(s.getHours())}:${pad(s.getMinutes())}`; end = `${pad(e.getHours())}:${pad(e.getMinutes())}`; }
      else { start = '00:00'; end = `${pad(e.getHours())}:${pad(e.getMinutes())}`; }
    } else { start = '09:00'; end = '10:00'; }
  }
  const pid = entry ? entry.project_id : (S.draft.project_id ?? null);
  const tid = entry ? entry.task_id : (S.draft.task_id ?? null);

  const m = modal(`<form>
    <h2><span class="deco">✎</span> ${isNew ? 'Add time entry' : running ? 'Edit running entry' : 'Edit entry'}</h2>
    <label class="field">What did you do?<input class="input" name="desc" maxlength="500" dir="auto" value="${esc(entry?.description || '')}" placeholder="Description"></label>
    <div class="row">
      <label class="field">Project<select class="input" name="proj">${projectOptions(pid)}</select></label>
      <label class="field">Task<select class="input" name="task">${taskOptions(pid, tid)}</select></label>
    </div>
    <label class="field">Date<button type="button" class="input" name="date" style="text-align:left;cursor:pointer"></button></label>
    <div class="picker-pop" hidden></div>
    <div class="row">
      <label class="field">Start<input class="input" type="time" name="start" required value="${start}"></label>
      <label class="field">End<input class="input" type="time" name="end" ${running ? 'disabled placeholder="running"' : 'required'} value="${end}"></label>
    </div>
    <div class="small muted" id="span-hint"></div>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn danger ghost left" data-a="del">Delete</button>'}
      <button type="button" class="btn ghost" data-a="cancel">Cancel</button>
      <button class="btn primary">${isNew ? 'Add ♡' : 'Save ♡'}</button>
    </div></form>`);
  const f = $('form', m.el);
  const dateBtn = f.elements.date, pop = $('.picker-pop', m.el), hint = $('#span-hint', m.el);
  wirePT(f.elements.proj, f.elements.task, () => {});

  const compute = () => {
    const [sh, sm] = f.elements.start.value.split(':').map(Number);
    const a = new Date(date.getFullYear(), date.getMonth(), date.getDate(), sh, sm);
    if (running) return [a, null];
    const [eh, em] = f.elements.end.value.split(':').map(Number);
    let b = new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh, em);
    if (b <= a) b = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, eh, em);
    return [a, b];
  };
  const refresh = () => {
    dateBtn.innerHTML = `${primaryDate(date, true)} <span class="muted small">· ${secondaryDate(date)}</span>`;
    if (!f.elements.start.value || (!running && !f.elements.end.value)) { hint.textContent = ''; return; }
    const [a, b] = compute();
    const secs = ((b ? b.getTime() : Date.now()) - a.getTime()) / 1000;
    hint.innerHTML = `Duration: <b>${clock(secs)}</b>${b && !sameDay(a, b) ? ' · ends the next day ☾' : ''}`;
  };
  dateBtn.onclick = () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) miniPicker(pop, date, (d) => { date = d; pop.hidden = true; refresh(); });
  };
  f.elements.start.oninput = refresh;
  f.elements.end.oninput = refresh;
  refresh();

  $('[data-a=cancel]', m.el).onclick = m.close;
  const del = $('[data-a=del]', m.el);
  if (del) del.onclick = async () => {
    m.close();
    if (!(await confirmBox('Delete entry?', 'This cannot be undone.'))) return;
    await safe(async () => { await api('DELETE', `/api/entries/${entry.id}`); toast('Entry deleted'); await afterEntryChange(); })();
  };
  f.addEventListener('submit', safe(async (ev) => {
    ev.preventDefault();
    const [a, b] = compute();
    const data = {
      description: f.elements.desc.value.trim(),
      project_id: val(f.elements.proj),
      task_id: val(f.elements.task),
      start_ts: ts(a),
    };
    if (b) data.end_ts = ts(b);
    if (running && data.start_ts >= nowS()) throw new Error('Start must be in the past');
    if (isNew) await api('POST', '/api/entries', data);
    else await api('PATCH', `/api/entries/${entry.id}`, data);
    m.close();
    toast(isNew ? 'Entry added ✿' : 'Saved ✿');
    await afterEntryChange();
  }));
}

// ------------------------------------------------------------------ projects view

function colorPicker(name, selected) {
  return `<div class="swatches">${PALETTE.map((c) =>
    `<button type="button" class="swatch ${c === selected ? 'sel' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
    <input type="color" class="swatch-custom" name="${name}" value="${selected}" title="Custom color"></div>`;
}
function wireColorPicker(root) {
  const input = $('input[type=color]', root);
  root.addEventListener('click', (e) => {
    const s = e.target.closest('[data-color]');
    if (!s) return;
    input.value = s.dataset.color;
    $$('.swatch', root).forEach((x) => x.classList.toggle('sel', x === s));
  });
  input.addEventListener('input', () => $$('.swatch', root).forEach((x) => x.classList.toggle('sel', x.dataset.color === input.value)));
}

VIEWS.projects = async function () {
  await loadProjects();
  const showArch = S.showArchived;
  const list = S.projects.filter((p) => showArch || !p.archived);
  const nextColor = PALETTE[S.projects.length % PALETTE.length];
  $('#view').innerHTML = `
  <section class="card">
    <div class="card-head"><h2><span class="deco">❀</span> Projects</h2>
      <label class="small muted" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" class="check" id="show-arch" ${showArch ? 'checked' : ''}> show archived</label></div>
    <form id="new-proj" class="row">
      <input class="input" name="name" maxlength="80" placeholder="New project name… ✧" required style="flex:2 1 220px">
      <div id="new-colors" style="flex:2 1 260px">${colorPicker('color', nextColor)}</div>
      <button class="btn primary" style="flex:0 0 auto">＋ Create</button>
    </form>
  </section>
  <div class="projects">${list.length ? list.map(projectCard).join('') : `<div class="card empty-state" style="grid-column:1/-1"><span class="big">📒</span>No projects yet. Create your first one above~</div>`}</div>`;

  wireColorPicker($('#new-colors'));
  $('#show-arch').onchange = (e) => { S.showArchived = e.target.checked; VIEWS.projects(); };
  $('#new-proj').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const f = e.target;
    await api('POST', '/api/projects', { name: f.elements.name.value, color: f.elements.color.value });
    toast('Project created ✿');
    await VIEWS.projects();
    $('#new-proj input[name=name]').focus();
  }));
  $('.projects').addEventListener('click', safe(onProjectAction));
  $('.projects').addEventListener('change', safe(async (e) => {
    if (!e.target.matches('.task .check')) return;
    const tid = Number(e.target.closest('.task').dataset.tid);
    await api('PATCH', `/api/tasks/${tid}`, { done: e.target.checked });
    if (e.target.checked) toast('Task done! ✧ yatta~');
    await VIEWS.projects();
  }));
  $$('.add-task').forEach((f) => f.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const pid = Number(f.closest('[data-pid]').dataset.pid);
    await api('POST', '/api/tasks', { project_id: pid, name: f.elements.name.value });
    await VIEWS.projects();
    $(`[data-pid="${pid}"] .add-task input`).focus();
  })));
};

function projectCard(p) {
  const done = p.tasks.filter((t) => t.done).length;
  const isRunning = (id, key) => S.running && S.running[key] === id;
  return `<div class="card proj-card ${p.archived ? 'archived' : ''}" data-pid="${p.id}">
    <div class="band" style="background:linear-gradient(90deg, ${p.color}, ${p.color}88)"></div>
    <div class="inner">
      <div class="title"><span class="dot" style="background:${p.color}"></span><h3>${esc(p.name)}</h3>
        <button class="icon-btn" data-act="start" title="Start timer on this project">▶</button>
        <button class="icon-btn" data-act="edit" title="Edit">✎</button>
        <button class="icon-btn" data-act="archive" title="${p.archived ? 'Unarchive' : 'Archive'}">${p.archived ? '↺' : '⌂'}</button>
        <button class="icon-btn" data-act="del" title="Delete">✕</button></div>
      <div class="total">⏱ ${hrs(p.total)}${p.tasks.length ? ` · ${done}/${p.tasks.length} tasks done` : ''}${isRunning(p.id, 'project_id') ? ' · <span class="tag-live">LIVE</span>' : ''}</div>
      ${p.tasks.map((t) => `<div class="task ${t.done ? 'done' : ''}" data-tid="${t.id}">
        <input type="checkbox" class="check" ${t.done ? 'checked' : ''} title="Mark done">
        <span class="name">${esc(t.name)}${isRunning(t.id, 'task_id') ? '<span class="tag-live">LIVE</span>' : ''}</span>
        <span class="t">${t.total ? hrs(t.total) : ''}</span>
        <button class="icon-btn" data-act="tstart" title="Start timer on this task">▶</button>
        <button class="icon-btn" data-act="tedit" title="Rename">✎</button>
        <button class="icon-btn" data-act="tdel" title="Delete task">✕</button>
      </div>`).join('')}
      <form class="add-task"><input class="input" name="name" maxlength="120" placeholder="＋ add a sub task…" required><button class="btn sm">Add</button></form>
    </div></div>`;
}

async function onProjectAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const p = S.P.get(Number(btn.closest('[data-pid]').dataset.pid));
  const tEl = btn.closest('[data-tid]');
  const t = tEl && S.T.get(Number(tEl.dataset.tid));
  switch (btn.dataset.act) {
    case 'start': return startTimer({ project_id: p.id, task_id: null, description: '' });
    case 'tstart': return startTimer({ project_id: p.id, task_id: t.id, description: '' });
    case 'archive':
      await api('PATCH', `/api/projects/${p.id}`, { archived: !p.archived });
      toast(p.archived ? 'Project restored' : 'Project archived');
      return VIEWS.projects();
    case 'del':
      if (!(await confirmBox(`Delete “${p.name}”?`, 'This deletes the project, its tasks AND all its time entries. Archive it instead if you want to keep the history.'))) return;
      await api('DELETE', `/api/projects/${p.id}`);
      await loadTimer();
      toast('Project deleted');
      return VIEWS.projects();
    case 'edit': return editProject(p);
    case 'tedit': {
      const name = await promptBox('Rename task', 'Task name', t.name);
      if (!name) return;
      await api('PATCH', `/api/tasks/${t.id}`, { name });
      return VIEWS.projects();
    }
    case 'tdel':
      if (!(await confirmBox(`Delete task “${t.name}”?`, 'Its time entries stay with the project, just without a task.'))) return;
      await api('DELETE', `/api/tasks/${t.id}`);
      return VIEWS.projects();
  }
}

function editProject(p) {
  const m = modal(`<form><h2><span class="deco">✎</span> Edit project</h2>
    <label class="field">Name<input class="input" name="name" maxlength="80" required value="${esc(p.name)}"></label>
    <label class="field">Color<div id="edit-colors">${colorPicker('color', p.color)}</div></label>
    <div class="actions"><button type="button" class="btn ghost" data-a="cancel">Cancel</button><button class="btn primary">Save ♡</button></div></form>`);
  wireColorPicker($('#edit-colors', m.el));
  $('[data-a=cancel]', m.el).onclick = m.close;
  $('form', m.el).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await api('PATCH', `/api/projects/${p.id}`, { name: e.target.elements.name.value, color: e.target.elements.color.value });
    m.close();
    toast('Saved ✿');
    await VIEWS.projects();
  }));
}

// ------------------------------------------------------------------ calendar view

VIEWS.calendar = async function () {
  if (!S.cal || S.cal.mode !== S.prefs.calendar) {
    S.cal = { ...monthOf(new Date()), sel: sod(new Date()), mode: S.prefs.calendar };
  }
  const { y, m } = S.cal;
  const days = gridDays(y, m);
  const [a, b] = monthRange(y, m);
  S.calEntries = await fetchRange(days[0], addDays(days[days.length - 1], 1));
  const today = new Date();
  const goal = Math.max(1, S.prefs.goal) * 3600;
  const last = addDays(b, -1);
  const sub = isJ()
    ? `${gregLabel(a)} – ${gregLabel(last)}`
    : `${jalaliLabel(a)} – ${jalaliLabel(last)}`;
  let monthTotal = 0;

  const cells = days.map((d) => {
    const da = ts(d), db = ts(addDays(d, 1));
    const by = new Map();
    let tot = 0;
    for (const e of S.calEntries) {
      const o = overlap(e, da, db);
      if (!o) continue;
      by.set(e.project_id, (by.get(e.project_id) || 0) + o);
      tot += o;
    }
    const mo = monthOf(d);
    const inMonth = mo.y === y && mo.m === m;
    if (inMonth) monthTotal += tot;
    const cls = [inMonth ? '' : 'out', sameDay(d, today) ? 'today' : '', S.cal.sel && sameDay(d, S.cal.sel) ? 'sel' : '', isWeekend(d) ? 'holiday' : ''].join(' ');
    const segs = [...by.entries()].sort((p, q) => q[1] - p[1]);
    return `<div class="cal-cell ${cls}" data-t="${d.getTime()}" title="${tot ? hrs(tot) : ''}">
      ${tot ? `<span class="heat" style="opacity:${(Math.min(tot / goal, 1) * 0.16).toFixed(3)}"></span>` : ''}
      <span class="n">${dayNum(d)}</span><span class="n2">${shortSecondary(d)}</span>
      ${tot ? `<span class="h">${hrs(tot)}</span><span class="bar">${segs.map(([pid, s]) => `<i style="flex:${s};background:${projColor(pid)}"></i>`).join('')}</span>` : ''}
    </div>`;
  }).join('');

  $('#view').innerHTML = `
  <section class="card">
    <div class="card-head">
      <button class="icon-btn nav-arrow" id="cal-prev" title="Previous month">‹</button>
      <div class="cal-title">${monthTitle(y, m)}<span class="sub">${sub}</span></div>
      <button class="icon-btn nav-arrow" id="cal-next" title="Next month">›</button>
      <span style="flex:1"></span>
      <span class="muted small" style="font-weight:800">Month total: <b style="color:var(--pink)">${hrs(monthTotal)}</b></span>
      <button class="btn sm" id="cal-today">Today</button>
      <div class="seg" id="cal-mode"><button data-v="jalali" class="${isJ() ? 'active' : ''}">شمسی</button><button data-v="gregorian" class="${isJ() ? '' : 'active'}">Gregorian</button></div>
    </div>
    <div class="cal-grid" ${gridDir()}>${weekdayHeads()}${cells}</div>
  </section>
  <section class="card" id="day-detail"></section>`;

  const move = (k) => { Object.assign(S.cal, shiftMonth(S.cal.y, S.cal.m, k)); VIEWS.calendar(); };
  $('#cal-prev').onclick = () => move(-1);
  $('#cal-next').onclick = () => move(1);
  $('#cal-today').onclick = () => { S.cal = null; VIEWS.calendar(); };
  $('#cal-mode').onclick = safe(async (e) => {
    const b2 = e.target.closest('[data-v]');
    if (!b2 || b2.dataset.v === S.prefs.calendar) return;
    const keep = S.cal.sel;
    await savePrefs({ calendar: b2.dataset.v });
    S.cal = { ...monthOf(keep || new Date()), sel: keep, mode: S.prefs.calendar };
    VIEWS.calendar();
  });
  $('.cal-grid').onclick = (e) => {
    const c = e.target.closest('[data-t]');
    if (!c) return;
    S.cal.sel = new Date(Number(c.dataset.t));
    const mo = monthOf(S.cal.sel);
    if (mo.y !== S.cal.y || mo.m !== S.cal.m) { Object.assign(S.cal, mo); VIEWS.calendar(); return; }
    $$('.cal-grid .cal-cell').forEach((x) => x.classList.toggle('sel', x === c));
    renderDayDetail();
  };
  $('#day-detail').addEventListener('click', onEntryAction);
  renderDayDetail();
};

function renderDayDetail() {
  const box = $('#day-detail');
  const d = S.cal.sel;
  if (!box || !d) return;
  const a = ts(d), b = ts(addDays(d, 1));
  const list = S.calEntries.filter((e) => overlap(e, a, b) > 0).sort((p, q) => p.start_ts - q.start_ts);
  box.innerHTML = `<div class="card-head"><h2><span class="deco">✿</span> ${primaryDate(d, true)} <span class="muted small" style="font-family:var(--font)">${secondaryDate(d)}</span></h2>
    <span class="tot" style="font:15px var(--font-title);color:var(--pink)">${clock(sumRange(list, a, b))}</span>
    <button class="btn sm" id="day-add">＋ Add entry</button></div>
    ${list.length ? list.map((e) => entryRow(e, a, b)).join('') : '<div class="empty-state">A quiet day~ nothing logged (˘ω˘)</div>'}`;
  $('#day-add').onclick = () => openEntryEditor(null, d);
}

// ------------------------------------------------------------------ reports view

const PRESETS = [
  ['today', 'Today'], ['week', 'This week'], ['lastweek', 'Last week'],
  ['month', 'This month'], ['lastmonth', 'Last month'], ['last30', '30 days'], ['year', 'This year'], ['custom', 'Custom…'],
];

function presetRange(key) {
  const t = sod(new Date());
  const mo = monthOf(t);
  switch (key) {
    case 'today': return [t, addDays(t, 1)];
    case 'week': return [startOfWeek(t), addDays(startOfWeek(t), 7)];
    case 'lastweek': return [addDays(startOfWeek(t), -7), startOfWeek(t)];
    case 'month': return monthRange(mo.y, mo.m);
    case 'lastmonth': { const p = shiftMonth(mo.y, mo.m, -1); return monthRange(p.y, p.m); }
    case 'last30': return [addDays(t, -29), addDays(t, 1)];
    case 'year': return yearRange(t);
  }
  return null;
}

function buildBuckets(from, to) {
  const days = Math.round((to - from) / 86400000);
  const out = [];
  if (days <= 45) {
    for (let d = from; d < to; d = addDays(d, 1)) {
      const wd = isJ() && S.prefs.persian ? WD_FA_SHORT[d.getDay()] : WD_EN[d.getDay()];
      out.push({ a: d, b: addDays(d, 1), label: days <= 7 ? `${wd} ${dayNum(d)}` : dayNum(d), title: primaryDate(d, true) });
    }
  } else {
    let { y, m } = monthOf(from);
    for (let s = monthStart(y, m); s < to;) {
      const n = shiftMonth(y, m, 1);
      const e = monthStart(n.y, n.m);
      const name = isJ() ? (S.prefs.persian ? JM_FA[m - 1] : JM_EN[m - 1].slice(0, 3)) : GM_EN[m - 1].slice(0, 3);
      out.push({ a: s < from ? from : s, b: e > to ? to : e, label: name, title: monthTitle(y, m, true) });
      ({ y, m } = n);
      s = e;
    }
  }
  return out;
}

VIEWS.reports = async function () {
  const R = S.rep;
  if (R.preset !== 'custom' || !R.from) [R.from, R.to] = presetRange(R.preset === 'custom' ? 'week' : R.preset);
  const from = R.from, to = R.to;
  S.repEntries = await fetchRange(from, to);
  const A = ts(from), B = ts(to);
  const entries = S.repEntries;

  // aggregate
  const projAgg = new Map();
  let total = 0;
  for (const e of entries) {
    const o = overlap(e, A, B);
    if (!o) continue;
    total += o;
    if (!projAgg.has(e.project_id)) projAgg.set(e.project_id, { sec: 0, tasks: new Map() });
    const pa = projAgg.get(e.project_id);
    pa.sec += o;
    pa.tasks.set(e.task_id, (pa.tasks.get(e.task_id) || 0) + o);
  }
  const order = [...projAgg.entries()].sort((p, q) => q[1].sec - p[1].sec).map(([pid]) => pid);
  let daysWorked = 0;
  for (let d = from; d < to; d = addDays(d, 1)) if (sumRange(entries, ts(d), ts(addDays(d, 1))) > 0) daysWorked++;
  const buckets = buildBuckets(from, to).map((bk) => {
    const by = new Map();
    let t = 0;
    for (const e of entries) {
      const o = overlap(e, ts(bk.a), ts(bk.b));
      if (o) { by.set(e.project_id, (by.get(e.project_id) || 0) + o); t += o; }
    }
    return { ...bk, by, total: t };
  });

  const rangeLabel = sameDay(from, addDays(to, -1))
    ? primaryDate(from, true)
    : `${primaryDate(from)} → ${primaryDate(addDays(to, -1))}`;

  $('#view').innerHTML = `
  <section class="card">
    <div class="card-head"><h2><span class="deco">✦</span> Reports</h2>
      <button class="btn sm" id="csv">⇩ Export CSV</button></div>
    <div class="seg" id="presets">${PRESETS.map(([k, l]) => `<button data-k="${k}" class="${R.preset === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <p class="muted small" style="margin:10px 0 0;font-weight:700">${rangeLabel} <span style="opacity:.7">· ${secondaryDate(from)} → ${secondaryDate(addDays(to, -1))}</span></p>
  </section>
  <div class="kpis">
    <div class="kpi"><span>TOTAL</span><b>${hrs(total)}</b></div>
    <div class="kpi"><span>DAYS WORKED</span><b>${daysWorked}</b></div>
    <div class="kpi"><span>AVG / WORKED DAY</span><b>${daysWorked ? hrs(total / daysWorked) : '–'}</b></div>
    <div class="kpi"><span>ENTRIES</span><b>${entries.length}</b></div>
  </div>
  ${total ? `
  <section class="card">
    <h2><span class="deco">✧</span> ${buckets.length && buckets[0].b - buckets[0].a > 86400000 * 2 ? 'Hours per month' : 'Hours per day'}</h2>
    ${order.length > 1 ? `<div class="legend">${order.map((pid) => `<span><i class="dot" style="background:${projColor(pid)}"></i>${esc(projName(pid))}</span>`).join('')}</div>` : ''}
    <div class="chart-wrap">${barChart(buckets, order)}</div>
  </section>
  <section class="card">
    <h2><span class="deco">❀</span> By project</h2>
    <table class="brk"><tbody>${order.map((pid) => {
      const pa = projAgg.get(pid);
      const open = S.repOpen.has(String(pid));
      const tasks = [...pa.tasks.entries()].sort((p, q) => q[1] - p[1]);
      return `<tr class="p" data-pid="${pid}"><td style="width:40%"><span style="display:inline-flex;gap:8px;align-items:center;font-weight:800"><span class="muted small">${open ? '▾' : '▸'}</span><span class="dot" style="background:${projColor(pid)}"></span>${esc(projName(pid))}</span></td>
        <td class="pct"><div class="hbar"><i style="width:${(pa.sec / total * 100).toFixed(1)}%;background:${projColor(pid)}"></i></div></td>
        <td class="num">${hrs(pa.sec)}</td><td class="num muted">${Math.round(pa.sec / total * 100)}%</td></tr>
        ${open ? tasks.map(([tid, sec]) => `<tr class="sub"><td>${tid == null ? '<i>no task</i>' : esc(S.T.get(tid)?.name || 'deleted task')}</td>
          <td class="pct"><div class="hbar"><i style="width:${(sec / pa.sec * 100).toFixed(1)}%;background:${projColor(pid)};opacity:.7"></i></div></td>
          <td class="num">${hrs(sec)}</td><td class="num">${Math.round(sec / pa.sec * 100)}%</td></tr>`).join('') : ''}`;
    }).join('')}</tbody></table>
  </section>` : `<section class="card empty-state"><span class="big">🍡</span>Nothing logged in this range yet~</section>`}`;

  $('#presets').onclick = (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    if (b.dataset.k === 'custom') return customRange();
    R.preset = b.dataset.k;
    VIEWS.reports();
  };
  $('#csv').onclick = () => exportCSV(entries, A, B, from, to);
  $('.brk')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.p');
    if (!tr) return;
    const k = tr.dataset.pid;
    S.repOpen.has(k) ? S.repOpen.delete(k) : S.repOpen.add(k);
    VIEWS.reports();
  });
  wireChartTips(buckets, order);
};

function niceStep(max) {
  for (const s of [0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (max / s <= 5) return s;
  return Math.ceil(max / 5);
}

function barChart(buckets, order) {
  const W = 800, H = 260, ml = 40, mr = 8, mt = 10, mb = 28;
  const iw = W - ml - mr, ih = H - mt - mb;
  const maxH = Math.max(...buckets.map((b) => b.total)) / 3600;
  const step = niceStep(maxH || 1);
  const top = Math.max(step, Math.ceil(maxH / step) * step);
  const y = (h) => mt + ih - (h / top) * ih;
  let svg = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="gl" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${ml - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}h</text>`;
  }
  const band = iw / buckets.length;
  const bw = Math.max(3, Math.min(38, band * 0.64));
  const every = Math.ceil(buckets.length / 16);
  buckets.forEach((b, i) => {
    const x = ml + i * band + (band - bw) / 2;
    svg += `<rect class="hit" data-i="${i}" x="${ml + i * band}" y="${mt}" width="${band}" height="${ih}" rx="6"/>`;
    const segs = order.filter((pid) => b.by.get(pid) > 0);
    let base = mt + ih;
    segs.forEach((pid, k) => {
      const h = (b.by.get(pid) / 3600 / top) * ih;
      const isTop = k === segs.length - 1;
      const yTop = base - h;
      if (isTop) {
        const r = Math.min(4, h, bw / 2);
        svg += `<path pointer-events="none" fill="${projColor(pid)}" d="M${x},${base}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${base}Z"/>`;
      } else if (h > 2) {
        svg += `<rect pointer-events="none" fill="${projColor(pid)}" x="${x}" y="${yTop + 2}" width="${bw}" height="${h - 2}"/>`;
      }
      base = yTop;
    });
    if (i % every === 0) {
      svg += `<text class="axis" x="${ml + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`;
    }
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours chart">${svg}</svg>`;
}

function wireChartTips(buckets, order) {
  const svg = $('.chart');
  if (!svg) return;
  let tip = $('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.append(tip); }
  svg.addEventListener('mousemove', (e) => {
    const h = e.target.closest('.hit');
    if (!h) { tip.hidden = true; return; }
    const b = buckets[Number(h.dataset.i)];
    tip.innerHTML = `<b>${b.title}</b>${order.filter((pid) => b.by.get(pid)).map((pid) =>
      `<div class="r"><span><i class="dot" style="background:${projColor(pid)}"></i>${esc(projName(pid))}</span><span>${hrs(b.by.get(pid))}</span></div>`).join('')}
      <div class="r" style="margin-top:4px;font-weight:800"><span>Total</span><span>${b.total ? hrs(b.total) : '0m'}</span></div>`;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; });
}

function customRange() {
  let a = S.rep.from || sod(new Date()), b = addDays(S.rep.to || addDays(sod(new Date()), 1), -1);
  const m = modal(`<h2><span class="deco">✦</span> Custom range</h2>
    <div class="grid2" style="gap:12px">
      <div><div class="small muted" style="font-weight:800">FROM · <span id="lbl-a"></span></div><div class="picker-pop" id="pa"></div></div>
      <div><div class="small muted" style="font-weight:800">TO · <span id="lbl-b"></span></div><div class="picker-pop" id="pb"></div></div>
    </div>
    <div class="actions"><button class="btn ghost" data-a="cancel">Cancel</button><button class="btn primary" data-a="ok">Show ♡</button></div>`);
  const lbl = () => { $('#lbl-a', m.el).innerHTML = primaryDate(a); $('#lbl-b', m.el).innerHTML = primaryDate(b); };
  miniPicker($('#pa', m.el), a, (d) => { a = d; lbl(); });
  miniPicker($('#pb', m.el), b, (d) => { b = d; lbl(); });
  lbl();
  $('[data-a=cancel]', m.el).onclick = m.close;
  $('[data-a=ok]', m.el).onclick = () => {
    if (b < a) [a, b] = [b, a];
    Object.assign(S.rep, { preset: 'custom', from: a, to: addDays(b, 1) });
    m.close();
    VIEWS.reports();
  };
}

function exportCSV(entries, A, B, from, to) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Date (Shamsi)', 'Start', 'End', 'Hours', 'Duration', 'Project', 'Task', 'Description']];
  for (const e of [...entries].sort((x, y) => x.start_ts - y.start_ts)) {
    const secs = overlap(e, A, B);
    if (!secs) continue;
    const d = new Date(Math.max(e.start_ts, A) * 1000);
    const j = Jalali.fromDate(d);
    rows.push([
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`,
      hm(Math.max(e.start_ts, A)), e.end_ts == null ? 'running' : hm(Math.min(e.end_ts, B)),
      (secs / 3600).toFixed(2), clock(secs),
      projName(e.project_id), e.task_id ? S.T.get(e.task_id)?.name || '' : '', e.description,
    ]);
  }
  const d0 = `${from.getFullYear()}${pad(from.getMonth() + 1)}${pad(from.getDate())}`;
  const last = addDays(to, -1);
  const d1 = `${last.getFullYear()}${pad(last.getMonth() + 1)}${pad(last.getDate())}`;
  download(`sakura-log_${d0}-${d1}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

// ------------------------------------------------------------------ settings view

VIEWS.settings = async function () {
  const p = S.prefs;
  const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${String(p[key]) === String(v) ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  $('#view').innerHTML = `
  <div class="grid2">
    <section class="card">
      <h2><span class="deco">🗓</span> Calendar</h2>
      <label class="field">Main calendar<div class="row">${seg('calendar', [['jalali', 'Hijri Shamsi · شمسی'], ['gregorian', 'Gregorian']])}</div></label>
      <label class="field">Shamsi dates written in<div class="row">${seg('persian', [[true, '<span class="fa">فارسی ۱۴۰۵</span>'], [false, 'Latin 1405']])}</div></label>
      <label class="field">Week starts on<div class="row">${seg('weekStart', [['auto', 'Auto'], [6, 'Saturday'], [0, 'Sunday'], [1, 'Monday']])}</div></label>
      <label class="field">Daily goal (hours)<input class="input" type="number" min="0" max="24" step="0.5" id="goal" value="${p.goal}" style="max-width:140px"></label>
    </section>
    <section class="card">
      <h2><span class="deco">✿</span> Look &amp; feel</h2>
      <label class="field">Theme<div class="row">${seg('theme', [['auto', 'Auto'], ['day', 'Day ✿'], ['night', 'Night ☾']])}</div></label>
      <label class="field">Sakura petals / stars<div class="row">${seg('petals', [[true, 'On'], [false, 'Off']])}</div></label>
      <label class="field">Mascot (Sakura-chan)<div class="row">${seg('mascot', [[true, 'On'], [false, 'Off']])}</div></label>
      <label class="field">Wallpaper image URL
        <input class="input" id="wp-url" placeholder="https://… or wallpapers/my-waifu.jpg" value="${esc(p.wallpaper)}">
        <span class="small muted" style="font-weight:600">Tip: drop images into <code>static/wallpapers/</code> on the server and use <code>wallpapers/name.jpg</code>.</span></label>
    </section>
    <section class="card">
      <h2><span class="deco">🔑</span> Password</h2>
      <form id="pw-form">
        <label class="field">Current password<input class="input" type="password" name="old" autocomplete="current-password" required></label>
        <label class="field">New password<input class="input" type="password" name="new" autocomplete="new-password" minlength="6" required></label>
        <button class="btn primary">Change password</button>
      </form>
    </section>
    <section class="card">
      <h2><span class="deco">📦</span> Data</h2>
      <p class="muted small" style="margin-top:0">Everything lives in one SQLite file on your server (<code>data/logger.db</code>). Grab a JSON backup any time:</p>
      <div class="row" style="justify-content:flex-start">
        <button class="btn lav" id="backup" style="flex:0 0 auto">⇩ Download backup</button>
        <button class="btn danger" id="logout" style="flex:0 0 auto">Log out</button>
      </div>
    </section>
  </div>`;

  $('#view .grid2').addEventListener('click', safe(async (e) => {
    const b = e.target.closest('.seg[data-key] button');
    if (!b) return;
    const key = b.closest('.seg').dataset.key;
    let v = b.dataset.v;
    if (v === 'true' || v === 'false') v = v === 'true';
    else if (key === 'weekStart' && v !== 'auto') v = Number(v);
    await savePrefs({ [key]: v });
    if (key === 'calendar') S.cal = null;
    VIEWS.settings();
  }));
  $('#goal').onchange = safe(async (e) => { await savePrefs({ goal: Math.max(0, Math.min(24, Number(e.target.value) || 0)) }); toast('Saved ✿'); });
  $('#wp-url').onchange = safe(async (e) => { await savePrefs({ wallpaper: e.target.value.trim() }); toast('Wallpaper updated ✿'); });
  $('#pw-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const f = e.target;
    await api('POST', '/api/password', { old: f.elements.old.value, new: f.elements.new.value });
    f.reset();
    toast('Password changed ✿');
  }));
  $('#backup').onclick = safe(async () => {
    const data = await api('GET', '/api/backup');
    const d = new Date();
    download(`sakura-log-backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  $('#logout').onclick = safe(async () => { await api('POST', '/api/logout'); showLogin(); });
};

// ------------------------------------------------------------------ ticking

function todayTotal() {
  return sumRange(S.recent, ts(sod(new Date())), ts(addDays(sod(new Date()), 1)));
}

let lastDay = dayKey(new Date());
function tick() {
  const r = S.running;
  const n = nowS();
  if (r) {
    const c = $('#clock');
    if (c) c.textContent = clock(n - r.start_ts);
    document.title = `⏱ ${clock(n - r.start_ts)} · ${projName(r.project_id)}`;
  } else {
    document.title = 'Sakura Log ✿';
  }
  $$('[data-live]').forEach((el) => { el.textContent = clock(n - Number(el.dataset.live)); });
  $$('[data-run]').forEach((el) => { el.textContent = clock(Number(el.dataset.base) + n - Number(el.dataset.run)); });
  if ($('#st-today')) {
    const t = todayTotal();
    $('#st-today').textContent = hrs(t);
    $('#st-week').textContent = hrs(sumRange(S.recent, ts(startOfWeek(new Date())), n + 1));
    const goal = S.prefs.goal * 3600;
    $('#st-goal').textContent = goal ? `${Math.min(999, Math.round(t / goal * 100))}%${t >= goal ? ' ☆' : ''}` : '–';
  }
  if (dayKey(new Date()) !== lastDay) { lastDay = dayKey(new Date()); applyPrefs(); if (S.view === 'timer') refreshEntries(); }
}
setInterval(tick, 1000);
setInterval(() => { if (S.view === 'timer' && !$('#main').hidden) sayMood(); }, 60000);

// Pick up a timer started/stopped from another device.
document.addEventListener('visibilitychange', safe(async () => {
  if (document.hidden || $('#main').hidden) return;
  const before = S.running?.id ?? null;
  await loadTimer();
  if ((S.running?.id ?? null) !== before && !$('.backdrop')) rerender();
}));

// ------------------------------------------------------------------ boot

(async function boot() {
  applyPrefs();
  try {
    await api('GET', '/api/me');
    await showMain();
  } catch (e) {
    if ($('#login').hidden) toast(e.message, true);
  }
})();
