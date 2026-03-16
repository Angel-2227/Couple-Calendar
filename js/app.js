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
let currentUser  = null;
let currentSection = 'together';

// Dates: each section has its own "selected week" and "selected day"
const state = {
  together: { weekStart: getWeekStart(new Date()), selectedDay: new Date() },
  my:       { weekStart: getWeekStart(new Date()), selectedDay: new Date() },
};

let schedules     = [];   // all recurring blocks from Firestore
let events        = [];   // one-time events from Firestore
let notifications = [];

let unsubs = [];  // Firestore listeners

// Modal state
let editingBlockId = null;
let editingEventId = null;
let selectedBlockDays  = [];
let selectedBlockType  = 'university';
let selectedEventType  = 'date';

// ────────────────────────────────────────────────
// DOM HELPERS
// ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
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

  // Avatars
  const avatarHtml = currentUser.photoURL
    ? `<img src="${currentUser.photoURL}" alt="avatar">`
    : `<div class="initials-avatar" style="width:32px;height:32px">${cfg?.shortName || '?'}</div>`;

  $('user-avatar-top').innerHTML = avatarHtml;
  $('menu-avatar').innerHTML = currentUser.photoURL
    ? `<img src="${currentUser.photoURL}" alt="avatar">`
    : `<div class="initials-avatar">${cfg?.shortName || '?'}</div>`;

  $('menu-name').textContent  = cfg?.name || currentUser.displayName || 'Usuario';
  $('menu-email').textContent = currentUser.email;

  startListeners();
  setSection('together');
}

// ────────────────────────────────────────────────
// FIRESTORE LISTENERS
// ────────────────────────────────────────────────
function startListeners() {
  // All schedules (both users)
  const schQ = query(collection(db, 'schedules'), orderBy('createdAt', 'asc'));
  unsubs.push(onSnapshot(schQ, snap => {
    schedules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentGrids();
  }));

  // All events
  const evQ = query(collection(db, 'events'), orderBy('startDate', 'asc'));
  unsubs.push(onSnapshot(evQ, snap => {
    events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentGrids();
    renderEventsList();
  }));

  // Notifications
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
  const isOpen = menu.classList.contains('open');
  if (isOpen) closeMenu();
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

  // Menu highlight
  $$('.menu-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));

  // Show/hide sections
  $$('.section').forEach(s => s.classList.add('hidden'));
  $(`section-${name}`)?.classList.remove('hidden');

  // FAB visibility
  const showFab = (name === 'together' || name === 'my-schedule');
  $('fab-add').classList.toggle('hidden', !showFab);

  // Topbar period label
  updateTopbarLabel();

  // Render
  if (name === 'together') renderTogetherView();
  else if (name === 'my-schedule') renderMyView();
  else if (name === 'events') renderEventsList();
  else if (name === 'notifications') { renderNotifsList(); markNotifsRead(); }
}

// ────────────────────────────────────────────────
// SECTION: TOGETHER
// ────────────────────────────────────────────────
function renderTogetherView() {
  buildDayStrip('together', state.together);
  renderTogetherGrid();
  updateWeekLabel('together-week-label', state.together.weekStart);
}

function renderTogetherGrid() {
  renderTimeGrid($('together-grid'), state.together.selectedDay, 'together');
}

$('together-prev').addEventListener('click', () => {
  state.together.weekStart = addDays(state.together.weekStart, -7);
  state.together.selectedDay = state.together.weekStart;
  renderTogetherView();
  updateTopbarLabel();
});
$('together-next').addEventListener('click', () => {
  state.together.weekStart = addDays(state.together.weekStart, 7);
  state.together.selectedDay = addDays(state.together.weekStart, 0);
  renderTogetherView();
  updateTopbarLabel();
});
$('together-today').addEventListener('click', () => {
  state.together.weekStart = getWeekStart(new Date());
  state.together.selectedDay = new Date();
  renderTogetherView();
  updateTopbarLabel();
});

// ────────────────────────────────────────────────
// SECTION: MY SCHEDULE
// ────────────────────────────────────────────────
function renderMyView() {
  buildDayStrip('my', state.my);
  renderMyGrid();
  updateWeekLabel('my-week-label', state.my.weekStart);
}

function renderMyGrid() {
  renderTimeGrid($('my-grid'), state.my.selectedDay, 'my');
}

$('my-prev').addEventListener('click', () => {
  state.my.weekStart = addDays(state.my.weekStart, -7);
  state.my.selectedDay = state.my.weekStart;
  renderMyView();
  updateTopbarLabel();
});
$('my-next').addEventListener('click', () => {
  state.my.weekStart = addDays(state.my.weekStart, 7);
  state.my.selectedDay = addDays(state.my.weekStart, 0);
  renderMyView();
  updateTopbarLabel();
});
$('my-today').addEventListener('click', () => {
  state.my.weekStart = getWeekStart(new Date());
  state.my.selectedDay = new Date();
  renderMyView();
  updateTopbarLabel();
});

// ────────────────────────────────────────────────
// DAY STRIP
// ────────────────────────────────────────────────
function buildDayStrip(key, s) {
  const stripId = key === 'together' ? 'together-day-strip' : 'my-day-strip';
  const strip   = $(stripId);
  const dayNames = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];
  const today = new Date();

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(s.weekStart, i);
    const isToday   = isSameDay(d, today);
    const isSelected = isSameDay(d, s.selectedDay);
    const hasEv = getDayBlocks(d).length > 0;
    const classes = [
      'day-pill',
      isToday ? 'today-day' : '',
      isSelected ? 'active' : '',
      hasEv ? 'has-ev' : ''
    ].filter(Boolean).join(' ');

    html += `<div class="${classes}" data-date="${formatDate(d)}" data-key="${key}">
      <span class="dn">${dayNames[d.getDay()]}</span>
      <span class="dd">${d.getDate()}</span>
    </div>`;
  }
  strip.innerHTML = html;

  strip.querySelectorAll('.day-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const k = pill.dataset.key;
      s.selectedDay = parseDate(pill.dataset.date);
      buildDayStrip(k, s);
      if (k === 'together') renderTogetherGrid();
      else renderMyGrid();
    });
  });
}

// ────────────────────────────────────────────────
// TIME GRID RENDERER
// Hours 7:00 – 22:00  →  15h × 60px = 900px total
// ────────────────────────────────────────────────
const GRID_START = 7;   // 7:00
const GRID_END   = 22;  // 22:00
const PX_PER_MIN = 1;   // 60px per hour

function timeToY(timeStr) {
  const [h, m] = (timeStr || '07:00').split(':').map(Number);
  return ((h - GRID_START) * 60 + m) * PX_PER_MIN;
}

function renderTimeGrid(container, day, mode) {
  if (!container) return;

  let html = '';

  // Hour lines
  for (let h = GRID_START; h <= GRID_END; h++) {
    const y = (h - GRID_START) * 60;
    const label = h <= 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    html += `<div class="tg-row" style="top:${y}px">
      <div class="tg-time">${h < GRID_END ? label : ''}</div>
      <div class="tg-line"></div>
    </div>`;
    // Half-hour
    if (h < GRID_END) {
      html += `<div class="tg-row" style="top:${y+30}px">
        <div class="tg-time"></div>
        <div class="tg-line half"></div>
      </div>`;
    }
  }

  // Now indicator
  const now = new Date();
  if (isSameDay(day, now) && now.getHours() >= GRID_START && now.getHours() < GRID_END) {
    const y = ((now.getHours() - GRID_START) * 60 + now.getMinutes()) * PX_PER_MIN;
    html += `<div class="now-indicator" style="top:${y}px"></div>`;
  }

  // Blocks
  if (mode === 'together') {
    html += buildTogetherBlocks(day);
  } else {
    html += buildMyBlocks(day);
  }

  container.innerHTML = html;

  // Attach click handlers for my-schedule blocks
  if (mode === 'my') {
    container.querySelectorAll('.tg-block[data-block-id]').forEach(el => {
      el.addEventListener('click', () => openEditBlock(el.dataset.blockId));
    });
    container.querySelectorAll('.tg-block[data-event-id]').forEach(el => {
      el.addEventListener('click', () => openEditEvent(el.dataset.eventId));
    });
  }

  // Scroll to 7am (or current time)
  const wrapper = container.closest('.time-grid-wrapper');
  if (wrapper) {
    const scrollTo = isSameDay(day, new Date())
      ? Math.max(0, ((now.getHours() - GRID_START) * 60 - 60) * PX_PER_MIN)
      : 0;
    wrapper.scrollTop = scrollTo;
  }
}

// ── TOGETHER: show both users' blocks + free slots ──
function buildTogetherBlocks(day) {
  const dateStr = formatDate(day);
  const dayOfWeek = day.getDay();

  const juanEmail   = ALLOWED_EMAILS[0];
  const greisiEmail = ALLOWED_EMAILS[1];

  // Collect blocks for each person
  const juanBlocks   = getPersonBlocks(day, juanEmail);
  const greisiBlocks = getPersonBlocks(day, greisiEmail);

  // Build minute-level busy arrays (07:00 – 22:00 = 900 mins)
  const juanBusy   = buildBusyArray(juanBlocks);
  const greisiBusy = buildBusyArray(greisiBlocks);

  let html = '';

  // Draw Juan's blocks
  juanBlocks.forEach(b => {
    const y = timeToY(b.startTime);
    const h = Math.max(timeToY(b.endTime) - y, 20);
    html += `<div class="tg-block juan" style="top:${y}px;height:${h}px">
      <div class="block-name">${b.title}</div>
      ${h > 30 ? `<div class="block-sub">${b.startTime} – ${b.endTime}</div>` : ''}
      ${h > 44 ? `<div class="block-owner">Juan</div>` : ''}
    </div>`;
  });

  // Draw Greisi's blocks (offset if overlap with Juan)
  greisiBlocks.forEach(b => {
    const y = timeToY(b.startTime);
    const h = Math.max(timeToY(b.endTime) - y, 20);
    const overlaps = juanBlocks.some(jb =>
      timeToMins(b.startTime) < timeToMins(jb.endTime) &&
      timeToMins(b.endTime) > timeToMins(jb.startTime)
    );
    const cls = overlaps ? 'tg-block greisi offset' : 'tg-block greisi';
    html += `<div class="${cls}" style="top:${y}px;height:${h}px">
      <div class="block-name">${b.title}</div>
      ${h > 30 ? `<div class="block-sub">${b.startTime} – ${b.endTime}</div>` : ''}
      ${h > 44 ? `<div class="block-owner">Greisi</div>` : ''}
    </div>`;
  });

  // Draw "ambos" overlap highlights
  const overlapRanges = findOverlapRanges(juanBlocks, greisiBlocks);
  overlapRanges.forEach(r => {
    const y = r.start * PX_PER_MIN;
    const h = Math.max((r.end - r.start) * PX_PER_MIN, 4);
    html += `<div class="tg-block both" style="top:${y}px;height:${h}px;opacity:0.5;pointer-events:none;z-index:2;left:44px;right:0">
      <div class="block-name" style="font-size:0.6rem">Ambos ocupados</div>
    </div>`;
  });

  // Draw free slots (both free simultaneously, 7am-10pm)
  const freeSlots = findFreeSlots(juanBusy, greisiBusy);
  freeSlots.forEach(slot => {
    if (slot.end - slot.start < 30) return; // skip < 30 min
    const y = slot.start * PX_PER_MIN;
    const h = (slot.end - slot.start) * PX_PER_MIN;
    html += `<div class="tg-block free-slot" style="top:${y}px;height:${h}px">
      <div class="block-name">💚 Libres juntos</div>
      ${h > 36 ? `<div class="block-sub">${minsToTime(slot.start + GRID_START * 60)} – ${minsToTime(slot.end + GRID_START * 60)}</div>` : ''}
    </div>`;
  });

  // Events for this day
  const dayEvents = events.filter(ev => ev.startDate === dateStr || (ev.startDate <= dateStr && ev.endDate >= dateStr));
  dayEvents.forEach(ev => {
    const y = timeToY(ev.startTime || '07:00');
    const h = Math.max(timeToY(ev.endTime || '08:00') - y, 20);
    html += `<div class="tg-block event-date" style="top:${y}px;height:${h}px;z-index:15" data-event-id="${ev.id}">
      <div class="block-name">💜 ${ev.title}</div>
      ${h > 30 ? `<div class="block-sub">${ev.startTime || ''} – ${ev.endTime || ''}</div>` : ''}
    </div>`;
  });

  return html;
}

// ── MY SCHEDULE: only current user's blocks ──
function buildMyBlocks(day) {
  const dateStr = formatDate(day);
  const blocks  = getPersonBlocks(day, currentUser.email);

  let html = '';
  blocks.forEach(b => {
    const y = timeToY(b.startTime);
    const h = Math.max(timeToY(b.endTime) - y, 20);
    const cls = USER_CONFIG[currentUser.email]?.colorClass || 'juan';
    const id  = b.isEvent ? '' : `data-block-id="${b.id}"`;
    const eid = b.isEvent ? `data-event-id="${b.id}"` : '';
    html += `<div class="tg-block ${cls}" style="top:${y}px;height:${h}px" ${id}${eid}>
      <div class="block-name">${b.title}</div>
      ${h > 30 ? `<div class="block-sub">${b.startTime} – ${b.endTime}</div>` : ''}
      ${h > 44 ? `<div class="block-owner">${b.typeLabel || ''}</div>` : ''}
    </div>`;
  });

  // Events
  const dayEvents = events.filter(ev =>
    (ev.startDate === dateStr || (ev.startDate <= dateStr && ev.endDate >= dateStr)) &&
    (ev.ownerEmail === currentUser.email || ev.type === 'shared' || ev.type === 'date')
  );
  dayEvents.forEach(ev => {
    const y = timeToY(ev.startTime || '07:00');
    const h = Math.max(timeToY(ev.endTime || '08:00') - y, 20);
    html += `<div class="tg-block event-date" style="top:${y}px;height:${h}px;z-index:10" data-event-id="${ev.id}">
      <div class="block-name">💜 ${ev.title}</div>
      ${h > 30 ? `<div class="block-sub">${ev.startTime || ''}</div>` : ''}
    </div>`;
  });

  return html;
}

// ── Get all blocks (schedules) for a person on a date ──
function getPersonBlocks(day, email) {
  const dateStr   = formatDate(day);
  const dayOfWeek = day.getDay();
  const result    = [];

  schedules.forEach(sch => {
    if (sch.ownerEmail !== email) return;
    if (!sch.days || !sch.days.includes(dayOfWeek)) return;
    const from = sch.startDate || '2020-01-01';
    const to   = sch.endDate   || '2050-12-31';
    if (dateStr < from || dateStr > to) return;

    const typeLabels = { university: 'Universidad', work: 'Trabajo', activity: 'Actividad', other: 'Otro' };
    result.push({
      id: sch.id, title: sch.title,
      startTime: sch.startTime, endTime: sch.endTime,
      ownerEmail: sch.ownerEmail,
      typeLabel: typeLabels[sch.type] || ''
    });
  });

  return result.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

function getDayBlocks(day) {
  const dateStr = formatDate(day);
  const dow = day.getDay();
  return schedules.filter(s => s.days?.includes(dow) &&
    (s.startDate || '2020-01-01') <= dateStr &&
    (s.endDate || '2050-12-31') >= dateStr
  );
}

// ── Build busy minutes array (relative to GRID_START) ──
function buildBusyArray(blocks) {
  const arr = new Uint8Array(900); // 15h × 60min
  blocks.forEach(b => {
    const s = Math.max(0, timeToMins(b.startTime) - GRID_START * 60);
    const e = Math.min(900, timeToMins(b.endTime) - GRID_START * 60);
    for (let i = s; i < e; i++) arr[i] = 1;
  });
  return arr;
}

// ── Find overlap ranges (both busy, in grid-relative minutes) ──
function findOverlapRanges(juanBlocks, greisiBlocks) {
  const ranges = [];
  juanBlocks.forEach(jb => {
    greisiBlocks.forEach(gb => {
      const s = Math.max(timeToMins(jb.startTime), timeToMins(gb.startTime)) - GRID_START * 60;
      const e = Math.min(timeToMins(jb.endTime),   timeToMins(gb.endTime))   - GRID_START * 60;
      if (e > s) ranges.push({ start: s, end: e });
    });
  });
  return ranges;
}

// ── Find free slots (both free in grid-relative minutes) ──
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
    container.innerHTML = `
      <div class="event-empty">
        <div class="event-empty-icon">💜</div>
        <p>No hay planes todavía.<br>¡Agrega su primera cita!</p>
      </div>`;
    return;
  }

  container.innerHTML = sorted.map(ev => {
    const cfg    = USER_CONFIG[ev.ownerEmail];
    const dotCls = ev.type === 'date' ? 'date' : ev.type === 'shared' ? 'shared' : 'personal';
    const canEdit = ev.createdBy === currentUser.uid;
    return `
      <div class="event-card" data-event-id="${ev.id}">
        <div class="event-card-dot ${dotCls}"></div>
        <div class="event-card-info">
          <div class="event-card-title">${ev.title}</div>
          <div class="event-card-meta">
            ${ev.startDate || ''}${ev.startTime ? ' · ' + ev.startTime : ''}${ev.endTime ? ' – ' + ev.endTime : ''}
            ${cfg ? ' · ' + cfg.name : ''}
          </div>
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
  const unread = notifications.filter(n => !n.read);
  for (const n of unread) {
    await updateDoc(doc(db, 'notifications', n.id), { read: true });
  }
}

function updateNotifBadge() {
  const count = notifications.filter(n => !n.read).length;
  $('notif-dot').classList.toggle('hidden', count === 0);
  const badge = $('menu-notif-badge');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
}

$('clear-notifs-btn')?.addEventListener('click', async () => {
  for (const n of notifications) await deleteDoc(doc(db, 'notifications', n.id));
  showToast('Notificaciones eliminadas');
});

// ────────────────────────────────────────────────
// MODAL: BLOCK (recurring schedule)
// ────────────────────────────────────────────────
function openAddBlock() {
  editingBlockId = null;
  selectedBlockDays = [];
  selectedBlockType = 'university';
  $('block-modal-title').textContent = 'Agregar bloque';
  $('block-title').value  = '';
  $('block-start').value  = '07:00';
  $('block-end').value    = '09:00';
  $('block-from').value   = formatDate(new Date());
  $('block-to').value     = '2026-12-31';
  $('block-notes').value  = '';
  $('block-delete-btn').classList.add('hidden');

  // Reset chips
  $$('#block-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === 'university'));
  $$('#block-days .day-chip').forEach(c => c.classList.remove('selected'));

  $('block-modal').classList.remove('hidden');
}

function openEditBlock(id) {
  const sch = schedules.find(s => s.id === id);
  if (!sch || sch.ownerEmail !== currentUser.email) return;

  editingBlockId = id;
  selectedBlockDays = [...(sch.days || [])];
  selectedBlockType = sch.type || 'university';

  $('block-modal-title').textContent = 'Editar bloque';
  $('block-title').value  = sch.title || '';
  $('block-start').value  = sch.startTime || '07:00';
  $('block-end').value    = sch.endTime   || '09:00';
  $('block-from').value   = sch.startDate || '';
  $('block-to').value     = sch.endDate   || '';
  $('block-notes').value  = sch.notes     || '';

  $$('#block-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === selectedBlockType));
  $$('#block-days .day-chip').forEach(c => c.classList.toggle('selected', selectedBlockDays.includes(Number(c.dataset.day))));

  $('block-delete-btn').classList.remove('hidden');
  $('block-modal').classList.remove('hidden');
}

// Type chips
$$('#block-type-chips .type-chip').forEach(c => {
  c.addEventListener('click', () => {
    selectedBlockType = c.dataset.val;
    $$('#block-type-chips .type-chip').forEach(x => x.classList.toggle('selected', x === c));
  });
});

// Day chips
$$('#block-days .day-chip').forEach(c => {
  c.addEventListener('click', () => {
    const day = Number(c.dataset.day);
    if (selectedBlockDays.includes(day)) {
      selectedBlockDays = selectedBlockDays.filter(d => d !== day);
      c.classList.remove('selected');
    } else {
      selectedBlockDays.push(day);
      c.classList.add('selected');
    }
  });
});

$('close-block-modal').addEventListener('click', () => $('block-modal').classList.add('hidden'));
$('block-modal').addEventListener('click', e => { if (e.target === $('block-modal')) $('block-modal').classList.add('hidden'); });

$('block-save-btn').addEventListener('click', async () => {
  const title = $('block-title').value.trim();
  if (!title) return showToast('Ingresa un nombre', 'error');
  if (selectedBlockDays.length === 0) return showToast('Selecciona al menos un día', 'error');

  const data = {
    title,
    type: selectedBlockType,
    startTime: $('block-start').value,
    endTime:   $('block-end').value,
    days:      selectedBlockDays,
    startDate: $('block-from').value,
    endDate:   $('block-to').value,
    notes:     $('block-notes').value,
    ownerEmail: currentUser.email,
    ownerId:    currentUser.uid,
  };

  try {
    if (editingBlockId) {
      await updateDoc(doc(db, 'schedules', editingBlockId), data);
      showToast('✅ Bloque actualizado');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'schedules'), data);
      showToast('✅ Bloque guardado');
    }
    $('block-modal').classList.add('hidden');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
});

$('block-delete-btn').addEventListener('click', async () => {
  if (!editingBlockId || !confirm('¿Eliminar este bloque?')) return;
  try {
    await deleteDoc(doc(db, 'schedules', editingBlockId));
    $('block-modal').classList.add('hidden');
    showToast('🗑️ Bloque eliminado');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
});

// ────────────────────────────────────────────────
// MODAL: EVENT (one-time plan / date)
// ────────────────────────────────────────────────
function openAddEvent(prefill = {}) {
  editingEventId = null;
  selectedEventType = 'date';
  $('event-modal-title').textContent = 'Nuevo plan';
  $('ev-title').value   = '';
  $('ev-date').value    = prefill.date || formatDate(new Date());
  $('ev-start').value   = prefill.start || '18:00';
  $('ev-end').value     = prefill.end   || '20:00';
  $('ev-desc').value    = '';
  $('ev-allday').checked  = false;
  $('ev-notify').checked  = true;
  $('ev-delete-btn').classList.add('hidden');
  $$('#ev-type-chips .type-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === 'date'));
  $('event-modal').classList.remove('hidden');
}

function openEditEvent(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  editingEventId = id;
  selectedEventType = ev.type || 'date';
  $('event-modal-title').textContent = 'Editar plan';
  $('ev-title').value   = ev.title || '';
  $('ev-date').value    = ev.startDate || '';
  $('ev-start').value   = ev.startTime || '';
  $('ev-end').value     = ev.endTime   || '';
  $('ev-desc').value    = ev.description || '';
  $('ev-allday').checked = ev.allDay || false;
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
    title, type: selectedEventType,
    startDate: $('ev-date').value,
    endDate:   $('ev-date').value,
    startTime: $('ev-start').value,
    endTime:   $('ev-end').value,
    allDay:    $('ev-allday').checked,
    description: $('ev-desc').value,
    ownerEmail: currentUser.email,
    createdBy:  currentUser.uid,
    sharedWith: ALLOWED_EMAILS,
    updatedAt:  serverTimestamp()
  };

  try {
    if (editingEventId) {
      await updateDoc(doc(db, 'events', editingEventId), data);
      showToast('✅ Plan actualizado');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'events'), data);
      if ($('ev-notify').checked) await notifyPartner(title, data.startDate, data.startTime);
      showToast('✅ Plan creado 💜');
    }
    $('event-modal').classList.add('hidden');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
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
  if (currentSection === 'together' || currentSection === 'my-schedule') {
    openAddBlock();
  }
});

$('add-block-btn')?.addEventListener('click', openAddBlock);
$('notif-btn').addEventListener('click', () => {
  setSection('notifications');
  closeMenu();
});

// ────────────────────────────────────────────────
// NOTIFICATIONS HELPER
// ────────────────────────────────────────────────
async function notifyPartner(title, date, time) {
  const partnerEmail = ALLOWED_EMAILS.find(e => e !== currentUser.email);
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', partnerEmail)));
  if (snap.empty) return;
  const partner = snap.docs[0].data();
  const myName  = USER_CONFIG[currentUser.email]?.name || 'Tu pareja';
  await addDoc(collection(db, 'notifications'), {
    recipientId: partner.uid,
    title: `${myName} agregó un plan`,
    body: `"${title}" el ${date}${time ? ' a las ' + time : ''}`,
    type: 'new_event', read: false,
    createdAt: serverTimestamp()
  });
}

// ────────────────────────────────────────────────
// TOPBAR / LABELS
// ────────────────────────────────────────────────
function updateTopbarLabel() {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const el = $('topbar-period');
  if (currentSection === 'together') {
    const s = state.together.selectedDay;
    el.textContent = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  } else if (currentSection === 'my-schedule') {
    const s = state.my.selectedDay;
    el.textContent = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  } else if (currentSection === 'events') {
    el.textContent = 'Planes y citas';
  } else if (currentSection === 'notifications') {
    el.textContent = 'Notificaciones';
  }
}

function updateWeekLabel(elId, weekStart) {
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const end = addDays(weekStart, 6);
  const el  = $(elId);
  if (!el) return;
  if (weekStart.getMonth() === end.getMonth()) {
    el.textContent = `${weekStart.getDate()} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  } else {
    el.textContent = `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  }
}

function renderCurrentGrids() {
  if (currentSection === 'together') renderTogetherGrid();
  else if (currentSection === 'my-schedule') renderMyGrid();
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
  // Week starts Monday
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
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
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

function minsToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
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
