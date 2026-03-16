import {
  auth, db, provider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp,
  ALLOWED_EMAILS, USER_CONFIG
} from './firebase-config.js';

// ────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────
let currentUser    = null;
let currentSection = 'together';
let calendarView   = 'week'; // 'week' | 'month' | 'year'

const state = {
  together: { weekStart: getWeekStart(new Date()), selectedDay: new Date(), month: new Date(), year: new Date().getFullYear() },
  my:       { weekStart: getWeekStart(new Date()), selectedDay: new Date(), month: new Date(), year: new Date().getFullYear() },
};

let schedules     = [];
let events        = [];
let notifications = [];
let unsubs        = [];

let editingBlockId    = null;
let editingEventId    = null;
let selectedBlockDays = [];
let selectedBlockType = 'university';
let selectedEventType = 'date';

// ────────────────────────────────────────────────
// DOM HELPERS
// ────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────
$('google-signin-btn').addEventListener('click', async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    if (!ALLOWED_EMAILS.includes(result.user.email)) {
      await auth.signOut();
      showToast('❌ Este correo no tiene acceso', 'error');
    }
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user')
      showToast('Error al iniciar sesión: ' + e.message, 'error');
  }
});

onAuthStateChanged(auth, async user => {
  $('loading').classList.add('hidden');
  if (user && ALLOWED_EMAILS.includes(user.email)) {
    currentUser = user;
    await saveProfile(user);
    initApp();
  } else {
    currentUser = null;
    stopListeners();
    $('app').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
  }
});

async function saveProfile(user) {
  const cfg = USER_CONFIG[user.email];
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid, email: user.email,
    name: cfg?.name || user.displayName,
    photoURL: user.photoURL || '',
    lastSeen: serverTimestamp()
  }, { merge: true });
}

$('signout-btn').addEventListener('click', async () => {
  await signOut(auth);
  showToast('👋 Hasta luego');
});

// ────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────
function initApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  const cfg = USER_CONFIG[currentUser.email];

  const avatarHtml = currentUser.photoURL
    ? `<img src="${currentUser.photoURL}" alt="avatar">`
    : `<div class="initials-avatar" style="width:32px;height:32px">${cfg?.shortName || '?'}</div>`;

  $('user-avatar-top').innerHTML = avatarHtml;
  $('menu-avatar').innerHTML = currentUser.photoURL
    ? `<img src="${currentUser.photoURL}" alt="avatar">`
    : `<div class="initials-avatar">${cfg?.shortName || '?'}</div>`;

  $('menu-name').textContent  = cfg?.name || currentUser.displayName || 'Usuario';
  $('menu-email').textContent = currentUser.email;

  initViewSwitcher();
  setupNav('together');
  setupNav('my');
  startListeners();
  setSection('together');
}

// ────────────────────────────────────────────────
// FIRESTORE LISTENERS
// ────────────────────────────────────────────────
function startListeners() {
  const schQ = query(collection(db, 'schedules'), orderBy('createdAt', 'asc'));
  unsubs.push(onSnapshot(schQ, snap => {
    schedules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentView();
  }));

  const evQ = query(collection(db, 'events'), orderBy('startDate', 'asc'));
  unsubs.push(onSnapshot(evQ, snap => {
    events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentView();
    renderEventsList();
  }));

  const nQ = query(
    collection(db, 'notifications'),
    where('recipientId', '==', currentUser.uid),
    orderBy('createdAt', 'desc')
  );
  unsubs.push(onSnapshot(nQ, snap => {
    notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateNotifBadge();
    if (currentSection === 'notifications') renderNotifsList();
  }));
}

function stopListeners() {
  unsubs.forEach(u => u());
  unsubs = [];
}

// ────────────────────────────────────────────────
// SLIDE MENU
// ────────────────────────────────────────────────
$('menu-btn').addEventListener('click', () => {
  const menu = $('slide-menu');
  const overlay = $('menu-overlay');
  if (menu.classList.contains('open')) closeMenu();
  else {
    menu.classList.remove('closed');
    menu.classList.add('open');
    overlay.classList.remove('hidden');
  }
});

$('menu-overlay').addEventListener('click', closeMenu);

function closeMenu() {
  $('slide-menu').classList.remove('open');
  $('slide-menu').classList.add('closed');
  $('menu-overlay').classList.add('hidden');
}

$$('.menu-item').forEach(btn => {
  btn.addEventListener('click', () => {
    setSection(btn.dataset.section);
    closeMenu();
  });
});

// ────────────────────────────────────────────────
// SECTIONS
// ────────────────────────────────────────────────
function setSection(name) {
  currentSection = name;
  $$('.menu-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  $$('.section').forEach(s => s.classList.add('hidden'));
  $(`section-${name}`)?.classList.remove('hidden');

  const showFab = (name === 'together' || name === 'my-schedule');
  $('fab-add').classList.toggle('hidden', !showFab);

  const sw = $('view-switcher-wrap');
  if (sw) sw.classList.toggle('hidden', !(name === 'together' || name === 'my-schedule'));

  updateTopbarLabel();

  if (name === 'together') renderTogetherView();
  else if (name === 'my-schedule') renderMyView();
  else if (name === 'events') renderEventsList();
  else if (name === 'notifications') { renderNotifsList(); markNotifsRead(); }
}

// ────────────────────────────────────────────────
// VIEW SWITCHER
// ────────────────────────────────────────────────
function initViewSwitcher() {
  $$('.vsw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarView = btn.dataset.view;
      $$('.vsw-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderCurrentView();
      updateTopbarLabel();
    });
  });
}

function renderCurrentView() {
  if (currentSection === 'together') renderTogetherView();
  else if (currentSection === 'my-schedule') renderMyView();
}

// ────────────────────────────────────────────────
// NAV SETUP
// ────────────────────────────────────────────────
function setupNav(key) {
  $(`${key}-prev`).addEventListener('click', () => {
    const s = state[key];
    if (calendarView === 'week') {
      s.weekStart = addDays(s.weekStart, -7);
      s.selectedDay = new Date(s.weekStart);
    } else if (calendarView === 'month') {
      s.month = new Date(s.month.getFullYear(), s.month.getMonth() - 1, 1);
    } else {
      s.year = s.year - 1;
    }
    renderCurrentView(); updateTopbarLabel();
  });

  $(`${key}-next`).addEventListener('click', () => {
    const s = state[key];
    if (calendarView === 'week') {
      s.weekStart = addDays(s.weekStart, 7);
      s.selectedDay = new Date(s.weekStart);
    } else if (calendarView === 'month') {
      s.month = new Date(s.month.getFullYear(), s.month.getMonth() + 1, 1);
    } else {
      s.year = s.year + 1;
    }
    renderCurrentView(); updateTopbarLabel();
  });

  $(`${key}-today`).addEventListener('click', () => {
    const s = state[key];
    s.weekStart   = getWeekStart(new Date());
    s.selectedDay = new Date();
    s.month       = new Date();
    s.year        = new Date().getFullYear();
    renderCurrentView(); updateTopbarLabel();
  });
}

// ────────────────────────────────────────────────
// VIEW DISPATCHERS
// ────────────────────────────────────────────────
function renderTogetherView() {
  updateNavLabel('together');
  if (calendarView === 'week')       renderWeekGrid('together-grid', state.together, 'together');
  else if (calendarView === 'month') renderMonthGrid('together-grid', state.together, 'together');
  else                               renderYearGrid('together-grid', state.together, 'together');
}

function renderMyView() {
  updateNavLabel('my');
  if (calendarView === 'week')       renderWeekGrid('my-grid', state.my, 'my');
  else if (calendarView === 'month') renderMonthGrid('my-grid', state.my, 'my');
  else                               renderYearGrid('my-grid', state.my, 'my');
}

function updateNavLabel(key) {
  const el = $(`${key}-week-label`);
  if (!el) return;
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const s = state[key];

  if (calendarView === 'week') {
    const end = addDays(s.weekStart, 6);
    el.textContent = s.weekStart.getMonth() === end.getMonth()
      ? `${s.weekStart.getDate()} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
      : `${s.weekStart.getDate()} ${MONTHS[s.weekStart.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  } else if (calendarView === 'month') {
    el.textContent = `${MONTHS[s.month.getMonth()]} ${s.month.getFullYear()}`;
  } else {
    el.textContent = `${s.year}`;
  }
}

// ────────────────────────────────────────────────
// WEEK VIEW — 7-column time grid
// ────────────────────────────────────────────────
const GRID_START = 7;
const GRID_END   = 22;
const PX_PER_MIN = 1;

function timeToY(timeStr) {
  const [h, m] = (timeStr || '07:00').split(':').map(Number);
  return ((h - GRID_START) * 60 + m) * PX_PER_MIN;
}

function renderWeekGrid(containerId, s, mode) {
  const container = $(containerId);
  if (!container) return;

  const days = Array.from({ length: 7 }, (_, i) => addDays(s.weekStart, i));
  const today = new Date();
  const DAY_LABELS = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];
  const totalH = (GRID_END - GRID_START) * 60;

  let html = `<div class="wg-wrap">`;

  // Header
  html += `<div class="wg-head-row"><div class="wg-gutter-head"></div>`;
  days.forEach(d => {
    const isToday = isSameDay(d, today);
    html += `<div class="wg-day-head${isToday ? ' wg-today-head' : ''}">
      <span class="wg-dn">${DAY_LABELS[d.getDay()]}</span>
      <span class="wg-dd${isToday ? ' wg-today-circle' : ''}">${d.getDate()}</span>
    </div>`;
  });
  html += `</div>`;

  // Scrollable body
  html += `<div class="wg-body-scroll"><div class="wg-body" style="height:${totalH}px">`;

  // Time gutter
  html += `<div class="wg-gutter-col">`;
  for (let h = GRID_START; h < GRID_END; h++) {
    const y = (h - GRID_START) * 60;
    const label = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    html += `<div class="wg-time-label" style="top:${y}px">${label}</div>`;
  }
  html += `</div>`;

  // Day columns
  days.forEach(d => {
    const isToday = isSameDay(d, today);
    html += `<div class="wg-col${isToday ? ' wg-col-today' : ''}">`;

    for (let h = GRID_START; h <= GRID_END; h++) {
      const y = (h - GRID_START) * 60;
      html += `<div class="wg-line" style="top:${y}px"></div>`;
      if (h < GRID_END) html += `<div class="wg-line half" style="top:${y + 30}px"></div>`;
    }

    if (isToday && today.getHours() >= GRID_START && today.getHours() < GRID_END) {
      const y = ((today.getHours() - GRID_START) * 60 + today.getMinutes()) * PX_PER_MIN;
      html += `<div class="wg-now" style="top:${y}px"><div class="wg-now-dot"></div></div>`;
    }

    html += mode === 'together' ? buildTogetherBlocksWeek(d) : buildMyBlocksWeek(d);
    html += `</div>`;
  });

  html += `</div></div></div>`; // wg-body / wg-body-scroll / wg-wrap

  container.innerHTML = html;
  container.className = 'wg-container';

  if (mode === 'my') {
    container.querySelectorAll('[data-block-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); openEditBlock(el.dataset.blockId); });
    });
    container.querySelectorAll('[data-event-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); openEditEvent(el.dataset.eventId); });
    });
  }

  const scrollEl = container.querySelector('.wg-body-scroll');
  if (scrollEl) {
    const scrollTo = isSameDay(s.selectedDay, today)
      ? Math.max(0, ((today.getHours() - GRID_START) * 60 - 60))
      : 0;
    setTimeout(() => { scrollEl.scrollTop = scrollTo; }, 0);
  }
}

function buildTogetherBlocksWeek(day) {
  const juanEmail   = ALLOWED_EMAILS[0];
  const greisiEmail = ALLOWED_EMAILS[1];
  const juanBlocks   = getPersonBlocks(day, juanEmail);
  const greisiBlocks = getPersonBlocks(day, greisiEmail);
  const dateStr = formatDate(day);
  let html = '';

  // Juan (left half)
  juanBlocks.forEach(b => {
    const y = timeToY(b.startTime);
    const h = Math.max(timeToY(b.endTime) - y, 18);
    html += `<div class="wg-block juan" style="top:${y}px;height:${h}px;left:1px;right:50%">
      <div class="wb-name">${b.title}</div>
      ${h > 34 ? `<div class="wb-time">${b.startTime}–${b.endTime}</div>` : ''}
    </div>`;
  });

  // Greisi (right half or full if no overlap)
  greisiBlocks.forEach(b => {
    const y = timeToY(b.startTime);
    const h = Math.max(timeToY(b.endTime) - y, 18);
    const overlaps = juanBlocks.some(jb =>
      timeToMins(b.startTime) < timeToMins(jb.endTime) &&
      timeToMins(b.endTime)   > timeToMins(jb.startTime)
    );
    const [left, right] = overlaps ? ['50%', '1px'] : ['1px', '50%'];
    html += `<div class="wg-block greisi" style="top:${y}px;height:${h}px;left:${left};right:${right}">
      <div class="wb-name">${b.title}</div>
      ${h > 34 ? `<div class="wb-time">${b.startTime}–${b.endTime}</div>` : ''}
    </div>`;
  });

  // Free slots
  const freeSlots = findFreeSlots(buildBusyArray(juanBlocks), buildBusyArray(greisiBlocks));
  freeSlots.forEach(slot => {
    if (slot.end - slot.start < 30) return;
    const y = slot.start * PX_PER_MIN;
    const h = (slot.end - slot.start) * PX_PER_MIN;
    html += `<div class="wg-block free-slot" style="top:${y}px;height:${h}px;left:1px;right:1px">
      ${h > 28 ? `<div class="wb-name">💚</div>` : ''}
    </div>`;
  });

  // Events
  events.filter(ev => ev.startDate === dateStr || (ev.startDate <= dateStr && ev.endDate >= dateStr))
    .forEach(ev => {
      const y = timeToY(ev.startTime || '07:00');
      const h = Math.max(timeToY(ev.endTime || '08:00') - y, 18);
      html += `<div class="wg-block event-date" style="top:${y}px;height:${h}px;left:1px;right:1px;z-index:15" data-event-id="${ev.id}">
        <div class="wb-name">💜 ${ev.title}</div>
      </div>`;
    });

  return html;
}

function buildMyBlocksWeek(day) {
  const dateStr = formatDate(day);
  const blocks  = getPersonBlocks(day, currentUser.email);
  const cls     = USER_CONFIG[currentUser.email]?.colorClass || 'juan';
  let html = '';

  blocks.forEach(b => {
    const y = timeToY(b.startTime);
    const h = Math.max(timeToY(b.endTime) - y, 18);
    html += `<div class="wg-block ${cls}" style="top:${y}px;height:${h}px;left:1px;right:1px" data-block-id="${b.id}">
      <div class="wb-name">${b.title}</div>
      ${h > 34 ? `<div class="wb-time">${b.startTime}–${b.endTime}</div>` : ''}
    </div>`;
  });

  events.filter(ev =>
    (ev.startDate === dateStr || (ev.startDate <= dateStr && ev.endDate >= dateStr)) &&
    (ev.ownerEmail === currentUser.email || ev.type === 'shared' || ev.type === 'date')
  ).forEach(ev => {
    const y = timeToY(ev.startTime || '07:00');
    const h = Math.max(timeToY(ev.endTime || '08:00') - y, 18);
    html += `<div class="wg-block event-date" style="top:${y}px;height:${h}px;left:1px;right:1px;z-index:10" data-event-id="${ev.id}">
      <div class="wb-name">💜 ${ev.title}</div>
    </div>`;
  });

  return html;
}

// ────────────────────────────────────────────────
// MONTH VIEW
// ────────────────────────────────────────────────
function renderMonthGrid(containerId, s, mode) {
  const container = $(containerId);
  if (!container) return;

  const today    = new Date();
  const year     = s.month.getFullYear();
  const month    = s.month.getMonth();
  const firstDay = new Date(year, month, 1);
  let   startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const gridStart = addDays(firstDay, -startPad);

  const DAY_NAMES = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

  let html = `<div class="mg-wrap">`;
  html += `<div class="mg-head">`;
  DAY_NAMES.forEach(d => html += `<div class="mg-head-cell">${d}</div>`);
  html += `</div><div class="mg-grid">`;

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const inMonth  = d.getMonth() === month;
    const isToday  = isSameDay(d, today);
    const dateStr  = formatDate(d);

    const dayBs  = inMonth ? getDayBlocksForDate(d) : [];
    const dayEvs = inMonth ? events.filter(ev => ev.startDate === dateStr) : [];

    let chips = '';
    const showItems = mode === 'together'
      ? dayBs.slice(0, 2)
      : dayBs.filter(b => b.ownerEmail === currentUser?.email).slice(0, 2);

    showItems.forEach(b => {
      const cls = USER_CONFIG[b.ownerEmail]?.colorClass || 'juan';
      chips += `<div class="mg-chip ${cls}">${b.title}</div>`;
    });
    dayEvs.slice(0, 1).forEach(ev => {
      chips += `<div class="mg-chip event">💜 ${ev.title}</div>`;
    });

    const hasMore = (showItems.length + dayEvs.length) > 3;

    html += `<div class="mg-cell${inMonth ? '' : ' mg-out'}${isToday ? ' mg-today' : ''}" data-date="${dateStr}">
      <div class="mg-num${isToday ? ' mg-today-num' : ''}">${d.getDate()}</div>
      <div class="mg-chips">${chips}${hasMore ? '<div class="mg-more">+más</div>' : ''}</div>
    </div>`;
  }

  html += `</div></div>`;
  container.innerHTML = html;
  container.className = 'mg-container';

  container.querySelectorAll('.mg-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = parseDate(cell.dataset.date);
      s.selectedDay = d;
      s.weekStart   = getWeekStart(d);
      calendarView  = 'week';
      $$('.vsw-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'week'));
      renderCurrentView();
      updateTopbarLabel();
    });
  });
}

// ────────────────────────────────────────────────
// YEAR VIEW
// ────────────────────────────────────────────────
function renderYearGrid(containerId, s, mode) {
  const container = $(containerId);
  if (!container) return;

  const today = new Date();
  const year  = s.year;
  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DAY_NAMES = ['L','M','X','J','V','S','D'];

  let html = `<div class="yg-wrap">`;

  for (let m = 0; m < 12; m++) {
    const firstDay  = new Date(year, m, 1);
    let   startPad  = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const gridStart = addDays(firstDay, -startPad);

    html += `<div class="yg-month">`;
    html += `<div class="yg-month-name">${MONTH_NAMES[m]}</div>`;
    html += `<div class="yg-day-heads">`;
    DAY_NAMES.forEach(d => html += `<div class="yg-dh">${d}</div>`);
    html += `</div><div class="yg-cells">`;

    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const inMonth = d.getMonth() === m;
      const isToday = isSameDay(d, today);
      const dateStr = formatDate(d);

      let dotClass = '';
      if (inMonth) {
        const dayBs  = getDayBlocksForDate(d);
        const dayEvs = events.filter(ev => ev.startDate === dateStr);
        const hasJuan   = dayBs.some(b => b.ownerEmail === ALLOWED_EMAILS[0]);
        const hasGreisi = dayBs.some(b => b.ownerEmail === ALLOWED_EMAILS[1]);
        const hasMy     = dayBs.some(b => b.ownerEmail === currentUser?.email);
        const hasEv     = dayEvs.length > 0;

        if (mode === 'together') {
          if (hasJuan && hasGreisi) dotClass = 'has-both';
          else if (hasJuan)         dotClass = 'has-juan';
          else if (hasGreisi)       dotClass = 'has-greisi';
        } else {
          if (hasMy) dotClass = 'has-my';
        }
        if (hasEv) dotClass += ' has-ev-dot';
      }

      html += `<div class="yg-cell${inMonth ? '' : ' yg-out'}${isToday ? ' yg-today' : ''} ${dotClass}"
        data-date="${dateStr}">
        <span>${inMonth ? d.getDate() : ''}</span>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
  container.className = 'yg-container';

  container.querySelectorAll('.yg-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = parseDate(cell.dataset.date);
      s.selectedDay = d;
      s.weekStart   = getWeekStart(d);
      s.month       = new Date(d.getFullYear(), d.getMonth(), 1);
      calendarView  = 'month';
      $$('.vsw-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'month'));
      renderCurrentView();
      updateTopbarLabel();
    });
  });
}

// ────────────────────────────────────────────────
// BLOCK / BUSY HELPERS
// ────────────────────────────────────────────────
function getPersonBlocks(day, email) {
  const dateStr   = formatDate(day);
  const dayOfWeek = day.getDay();
  const result    = [];
  schedules.forEach(sch => {
    if (sch.ownerEmail !== email) return;
    if (!sch.days || !sch.days.includes(dayOfWeek)) return;
    if (dateStr < (sch.startDate || '2020-01-01') || dateStr > (sch.endDate || '2050-12-31')) return;
    const typeLabels = { university: 'Universidad', work: 'Trabajo', activity: 'Actividad', other: 'Otro' };
    result.push({ id: sch.id, title: sch.title, startTime: sch.startTime, endTime: sch.endTime, ownerEmail: sch.ownerEmail, typeLabel: typeLabels[sch.type] || '' });
  });
  return result.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

function getDayBlocksForDate(day) {
  const dateStr = formatDate(day);
  const dow = day.getDay();
  return schedules.filter(s => s.days?.includes(dow) &&
    (s.startDate || '2020-01-01') <= dateStr &&
    (s.endDate || '2050-12-31') >= dateStr
  );
}

function buildBusyArray(blocks) {
  const arr = new Uint8Array(900);
  blocks.forEach(b => {
    const s = Math.max(0, timeToMins(b.startTime) - GRID_START * 60);
    const e = Math.min(900, timeToMins(b.endTime) - GRID_START * 60);
    for (let i = s; i < e; i++) arr[i] = 1;
  });
  return arr;
}

function findFreeSlots(juanBusy, greisiBusy) {
  const slots = [];
  let inFree = false, freeStart = 0;
  for (let i = 0; i < 900; i++) {
    const bothFree = juanBusy[i] === 0 && greisiBusy[i] === 0;
    if (bothFree && !inFree) { inFree = true; freeStart = i; }
    if (!bothFree && inFree) { inFree = false; slots.push({ start: freeStart, end: i }); }
  }
  if (inFree) slots.push({ start: freeStart, end: 900 });
  return slots.filter(s => s.end - s.start >= 30);
}

// ────────────────────────────────────────────────
// EVENTS LIST
// ────────────────────────────────────────────────
function renderEventsList() {
  if (currentSection !== 'events') return;
  const container = $('events-list');
  const sorted = [...events].sort((a, b) => a.startDate?.localeCompare(b.startDate));

  if (sorted.length === 0) {
    container.innerHTML = `<div class="event-empty"><div class="event-empty-icon">💜</div><p>No hay planes todavía.<br>¡Agrega su primera cita!</p></div>`;
    return;
  }

  container.innerHTML = sorted.map(ev => {
    const cfg    = USER_CONFIG[ev.ownerEmail];
    const dotCls = ev.type === 'date' ? 'date' : ev.type === 'shared' ? 'shared' : 'personal';
    const canEdit = ev.createdBy === currentUser.uid;
    return `<div class="event-card" data-event-id="${ev.id}">
      <div class="event-card-dot ${dotCls}"></div>
      <div class="event-card-info">
        <div class="event-card-title">${ev.title}</div>
        <div class="event-card-meta">${ev.startDate || ''}${ev.startTime ? ' · ' + ev.startTime : ''}${ev.endTime ? ' – ' + ev.endTime : ''}${cfg ? ' · ' + cfg.name : ''}</div>
        ${ev.description ? `<div class="event-card-desc">${ev.description}</div>` : ''}
      </div>
      ${canEdit ? `<button class="text-btn" style="align-self:center" onclick="event.stopPropagation();window._editEv('${ev.id}')">Editar</button>` : ''}
    </div>`;
  }).join('');
}

window._editEv = function(id) { openEditEvent(id); };

// ────────────────────────────────────────────────
// NOTIFICATIONS LIST
// ────────────────────────────────────────────────
function renderNotifsList() {
  const container = $('notifs-list');
  if (!container) return;
  if (notifications.length === 0) {
    container.innerHTML = `<div class="notif-empty"><div class="notif-empty-icon">💌</div><p>Sin notificaciones</p></div>`;
    return;
  }
  container.innerHTML = notifications.slice(0, 30).map(n => `
    <div class="notif-card${n.read ? '' : ' unread'}">
      <div class="notif-icon-wrap">🔔</div>
      <div>
        <div class="notif-card-title">${n.title}</div>
        <div class="notif-card-body">${n.body}</div>
        <div class="notif-card-time">${formatRelTime(n.createdAt)}</div>
      </div>
    </div>`).join('');
}

async function markNotifsRead() {
  for (const n of notifications.filter(n => !n.read))
    await updateDoc(doc(db, 'notifications', n.id), { read: true });
}

function updateNotifBadge() {
  const count = notifications.filter(n => !n.read).length;
  $('notif-dot').classList.toggle('hidden', count === 0);
  const badge = $('menu-notif-badge');
  if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }
}

$('clear-notifs-btn')?.addEventListener('click', async () => {
  for (const n of notifications) await deleteDoc(doc(db, 'notifications', n.id));
  showToast('Notificaciones eliminadas');
});

// ────────────────────────────────────────────────
// MODAL: BLOCK
// ────────────────────────────────────────────────
function openAddBlock() {
  editingBlockId = null; selectedBlockDays = []; selectedBlockType = 'university';
  $('block-modal-title').textContent = 'Agregar bloque';
  $('block-title').value = ''; $('block-start').value = '07:00'; $('block-end').value = '09:00';
  $('block-from').value = formatDate(new Date()); $('block-to').value = '2026-12-31'; $('block-notes').value = '';
  $('block-delete-btn').classList.add('hidden');
  $$('#block-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === 'university'));
  $$('#block-days .day-chip').forEach(c => c.classList.remove('selected'));
  $('block-modal').classList.remove('hidden');
}

function openEditBlock(id) {
  const sch = schedules.find(s => s.id === id);
  if (!sch || sch.ownerEmail !== currentUser.email) return;
  editingBlockId = id; selectedBlockDays = [...(sch.days || [])]; selectedBlockType = sch.type || 'university';
  $('block-modal-title').textContent = 'Editar bloque';
  $('block-title').value = sch.title || ''; $('block-start').value = sch.startTime || '07:00'; $('block-end').value = sch.endTime || '09:00';
  $('block-from').value = sch.startDate || ''; $('block-to').value = sch.endDate || ''; $('block-notes').value = sch.notes || '';
  $$('#block-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === selectedBlockType));
  $$('#block-days .day-chip').forEach(c => c.classList.toggle('selected', selectedBlockDays.includes(Number(c.dataset.day))));
  $('block-delete-btn').classList.remove('hidden');
  $('block-modal').classList.remove('hidden');
}

$$('#block-type-chips .type-chip').forEach(c => {
  c.addEventListener('click', () => {
    selectedBlockType = c.dataset.val;
    $$('#block-type-chips .type-chip').forEach(x => x.classList.toggle('selected', x === c));
  });
});

$$('#block-days .day-chip').forEach(c => {
  c.addEventListener('click', () => {
    const day = Number(c.dataset.day);
    if (selectedBlockDays.includes(day)) { selectedBlockDays = selectedBlockDays.filter(d => d !== day); c.classList.remove('selected'); }
    else { selectedBlockDays.push(day); c.classList.add('selected'); }
  });
});

$('close-block-modal').addEventListener('click', () => $('block-modal').classList.add('hidden'));
$('block-modal').addEventListener('click', e => { if (e.target === $('block-modal')) $('block-modal').classList.add('hidden'); });

$('block-save-btn').addEventListener('click', async () => {
  const title = $('block-title').value.trim();
  if (!title) return showToast('Ingresa un nombre', 'error');
  if (selectedBlockDays.length === 0) return showToast('Selecciona al menos un día', 'error');
  const data = {
    title, type: selectedBlockType, startTime: $('block-start').value, endTime: $('block-end').value,
    days: selectedBlockDays, startDate: $('block-from').value, endDate: $('block-to').value,
    notes: $('block-notes').value, ownerEmail: currentUser.email, ownerId: currentUser.uid,
  };
  try {
    if (editingBlockId) { await updateDoc(doc(db, 'schedules', editingBlockId), data); showToast('✅ Bloque actualizado'); }
    else { data.createdAt = serverTimestamp(); await addDoc(collection(db, 'schedules'), data); showToast('✅ Bloque guardado'); }
    $('block-modal').classList.add('hidden');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
});

$('block-delete-btn').addEventListener('click', async () => {
  if (!editingBlockId || !confirm('¿Eliminar este bloque?')) return;
  try { await deleteDoc(doc(db, 'schedules', editingBlockId)); $('block-modal').classList.add('hidden'); showToast('🗑️ Bloque eliminado'); }
  catch (e) { showToast('Error: ' + e.message, 'error'); }
});

// ────────────────────────────────────────────────
// MODAL: EVENT
// ────────────────────────────────────────────────
function openAddEvent(prefill = {}) {
  editingEventId = null; selectedEventType = 'date';
  $('event-modal-title').textContent = 'Nuevo plan';
  $('ev-title').value = ''; $('ev-date').value = prefill.date || formatDate(new Date());
  $('ev-start').value = prefill.start || '18:00'; $('ev-end').value = prefill.end || '20:00';
  $('ev-desc').value = ''; $('ev-allday').checked = false; $('ev-notify').checked = true;
  $('ev-delete-btn').classList.add('hidden');
  $$('#ev-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === 'date'));
  $('event-modal').classList.remove('hidden');
}

function openEditEvent(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  editingEventId = id; selectedEventType = ev.type || 'date';
  $('event-modal-title').textContent = 'Editar plan';
  $('ev-title').value = ev.title || ''; $('ev-date').value = ev.startDate || '';
  $('ev-start').value = ev.startTime || ''; $('ev-end').value = ev.endTime || '';
  $('ev-desc').value = ev.description || ''; $('ev-allday').checked = ev.allDay || false;
  $$('#ev-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === selectedEventType));
  $('ev-delete-btn').classList.remove('hidden');
  $('event-modal').classList.remove('hidden');
}

$$('#ev-type-chips .type-chip').forEach(c => {
  c.addEventListener('click', () => {
    selectedEventType = c.dataset.val;
    $$('#ev-type-chips .type-chip').forEach(x => x.classList.toggle('selected', x === c));
  });
});

$('close-event-modal').addEventListener('click', () => $('event-modal').classList.add('hidden'));
$('event-modal').addEventListener('click', e => { if (e.target === $('event-modal')) $('event-modal').classList.add('hidden'); });
$('add-event-btn').addEventListener('click', openAddEvent);

$('ev-save-btn').addEventListener('click', async () => {
  const title = $('ev-title').value.trim();
  if (!title) return showToast('Ingresa un título', 'error');
  const data = {
    title, type: selectedEventType, startDate: $('ev-date').value, endDate: $('ev-date').value,
    startTime: $('ev-start').value, endTime: $('ev-end').value, allDay: $('ev-allday').checked,
    description: $('ev-desc').value, ownerEmail: currentUser.email, createdBy: currentUser.uid,
    sharedWith: ALLOWED_EMAILS, updatedAt: serverTimestamp()
  };
  try {
    if (editingEventId) { await updateDoc(doc(db, 'events', editingEventId), data); showToast('✅ Plan actualizado'); }
    else { data.createdAt = serverTimestamp(); await addDoc(collection(db, 'events'), data); if ($('ev-notify').checked) await notifyPartner(title, data.startDate, data.startTime); showToast('✅ Plan creado 💜'); }
    $('event-modal').classList.add('hidden');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
});

$('ev-delete-btn').addEventListener('click', async () => {
  if (!editingEventId || !confirm('¿Eliminar este plan?')) return;
  await deleteDoc(doc(db, 'events', editingEventId));
  $('event-modal').classList.add('hidden');
  showToast('🗑️ Plan eliminado');
});

// ────────────────────────────────────────────────
// FAB
// ────────────────────────────────────────────────
$('fab-add').addEventListener('click', () => {
  if (currentSection === 'together' || currentSection === 'my-schedule') openAddBlock();
});

$('add-block-btn')?.addEventListener('click', openAddBlock);
$('notif-btn').addEventListener('click', () => { setSection('notifications'); closeMenu(); });

// ────────────────────────────────────────────────
// NOTIFY PARTNER
// ────────────────────────────────────────────────
async function notifyPartner(title, date, time) {
  const partnerEmail = ALLOWED_EMAILS.find(e => e !== currentUser.email);
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', partnerEmail)));
  if (snap.empty) return;
  const partner = snap.docs[0].data();
  const myName  = USER_CONFIG[currentUser.email]?.name || 'Tu pareja';
  await addDoc(collection(db, 'notifications'), {
    recipientId: partner.uid, title: `${myName} agregó un plan`,
    body: `"${title}" el ${date}${time ? ' a las ' + time : ''}`,
    type: 'new_event', read: false, createdAt: serverTimestamp()
  });
}

// ────────────────────────────────────────────────
// TOPBAR LABEL
// ────────────────────────────────────────────────
function updateTopbarLabel() {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const el = $('topbar-period');
  if (!el) return;

  if (currentSection === 'together' || currentSection === 'my-schedule') {
    const s = currentSection === 'together' ? state.together : state.my;
    if (calendarView === 'week') {
      const end = addDays(s.weekStart, 6);
      el.textContent = s.weekStart.getMonth() === end.getMonth()
        ? `${MONTHS[s.weekStart.getMonth()]} ${s.weekStart.getFullYear()}`
        : `${MONTHS[s.weekStart.getMonth()]} – ${MONTHS[end.getMonth()]}`;
    } else if (calendarView === 'month') {
      el.textContent = `${MONTHS[s.month.getMonth()]} ${s.month.getFullYear()}`;
    } else {
      el.textContent = `${s.year}`;
    }
  } else if (currentSection === 'events') {
    el.textContent = 'Planes y citas';
  } else if (currentSection === 'notifications') {
    el.textContent = 'Notificaciones';
  }
}

// ────────────────────────────────────────────────
// TOAST
// ────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const wrap  = $('toast-wrap');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  wrap.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

window.showToast = showToast;

// ────────────────────────────────────────────────
// DATE UTILS
// ────────────────────────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function timeToMins(time) {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatRelTime(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date) / 1000;
  if (diff < 60)    return 'Hace un momento';
  if (diff < 3600)  return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  return date.toLocaleDateString('es');
}
