import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, Timestamp,
  ALLOWED_EMAILS, USER_CONFIG } from './firebase-config.js';

// ── STATE ──
let currentUser = null;
let currentView = 'week';
let currentDate = new Date();
let events = [];
let schedules = [];
let notifications = [];
let unsubEvents = null;
let unsubSchedules = null;
let unsubNotifs = null;
let miniCalDate = new Date();
let notifPanelOpen = false;

// ── DOM REFS ──
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── AUTH ──
$('google-signin-btn').addEventListener('click', async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email;
    if (!ALLOWED_EMAILS.includes(email)) {
      await auth.signOut();
      showToast('❌ Este correo no tiene acceso a la app', 'error');
      return;
    }
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Error al iniciar sesión: ' + e.message, 'error');
    }
  }
});

onAuthStateChanged(auth, async user => {
  $('loading').classList.add('hidden');
  if (user && ALLOWED_EMAILS.includes(user.email)) {
    currentUser = user;
    await saveUserProfile(user);
    showApp();
    startListeners();
  } else {
    currentUser = null;
    stopListeners();
    showAuth();
  }
});

async function saveUserProfile(user) {
  const cfg = USER_CONFIG[user.email];
  // setDoc con merge:true crea el documento si no existe, o lo actualiza si ya existe
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email: user.email,
    name: cfg?.name || user.displayName,
    photoURL: user.photoURL || '',
    lastSeen: serverTimestamp()
  }, { merge: true });
}

// ── SHOW/HIDE SCREENS ──
function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  const cfg = USER_CONFIG[currentUser.email];
  $('user-name-display').textContent = cfg?.name || currentUser.displayName;

  const avatarEl = $('user-avatar');
  if (currentUser.photoURL) {
    avatarEl.innerHTML = `<img src="${currentUser.photoURL}" class="user-avatar" alt="avatar">`;
  } else {
    avatarEl.innerHTML = `<div class="user-initials">${cfg?.shortName || '?'}</div>`;
  }

  renderPartnerStatus();
  setView('week');
  renderMiniCal();
}

function showAuth() {
  $('auth-screen').classList.remove('hidden');
  $('app').classList.add('hidden');
}

function renderPartnerStatus() {
  const container = $('partner-status-container');
  const html = ALLOWED_EMAILS.map(email => {
    const cfg = USER_CONFIG[email];
    const isMe = email === currentUser.email;
    return `
      <div class="partner-status">
        <div class="partner-avatar ${cfg.colorClass}">${cfg.shortName}</div>
        <div class="partner-info">
          <div class="partner-name">${cfg.name}${isMe ? ' (tú)' : ''}</div>
          <div class="partner-role">${email}</div>
        </div>
      </div>
    `;
  }).join('');
  container.innerHTML = html;
}

// ── REALTIME LISTENERS ──
function startListeners() {
  // Events listener
  const eventsQ = query(collection(db, 'events'), orderBy('startDate', 'asc'));
  unsubEvents = onSnapshot(eventsQ, snap => {
    events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentView();
    renderMiniCal();
  });

  // Schedules listener
  const schedulesQ = query(collection(db, 'schedules'));
  unsubSchedules = onSnapshot(schedulesQ, snap => {
    schedules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentView();
  });

  // Notifications listener
  const notifsQ = query(
    collection(db, 'notifications'),
    where('recipientId', '==', currentUser.uid),
    orderBy('createdAt', 'desc')
  );
  unsubNotifs = onSnapshot(notifsQ, snap => {
    notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateNotifBadge();
    if (notifPanelOpen) renderNotifPanel();
  });
}

function stopListeners() {
  unsubEvents?.(); unsubSchedules?.(); unsubNotifs?.();
}

// ── VIEWS ──
function setView(view) {
  currentView = view;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderCurrentView();
  updatePeriodLabel();
}

function renderCurrentView() {
  const main = $('calendar-main');
  if (currentView === 'week') {
    main.innerHTML = buildWeekView();
    bindWeekEvents();
  } else if (currentView === 'month') {
    main.innerHTML = buildMonthView();
    bindMonthEvents();
  } else if (currentView === 'year') {
    main.innerHTML = buildYearView();
    bindYearEvents();
  }
}

// ── PERIOD NAVIGATION ──
function navigate(dir) {
  if (currentView === 'week') currentDate = addDays(currentDate, 7 * dir);
  else if (currentView === 'month') currentDate = addMonths(currentDate, dir);
  else if (currentView === 'year') currentDate = addYears(currentDate, dir);
  renderCurrentView();
  updatePeriodLabel();
}

function goToToday() {
  currentDate = new Date();
  renderCurrentView();
  updatePeriodLabel();
}

function updatePeriodLabel() {
  const el = $('period-label');
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  if (currentView === 'week') {
    const start = getWeekStart(currentDate);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      el.textContent = `${start.getDate()} — ${end.getDate()} ${months[start.getMonth()]} ${start.getFullYear()}`;
    } else {
      el.textContent = `${start.getDate()} ${months[start.getMonth()]} — ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
    }
  } else if (currentView === 'month') {
    el.textContent = `${months[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  } else {
    el.textContent = `${currentDate.getFullYear()}`;
  }
}

// ── WEEK VIEW BUILDER ──
function buildWeekView() {
  const weekStart = getWeekStart(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();
  const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  let headerCols = `<div class="week-header-time"></div>`;
  days.forEach((d, i) => {
    const isToday = isSameDay(d, today);
    headerCols += `
      <div class="week-day-header${isToday ? ' today' : ''}">
        <div class="week-day-name">${dayNames[d.getDay()]}</div>
        <div class="week-day-num">${d.getDate()}</div>
      </div>`;
  });

  let timeGutter = '';
  hours.forEach(h => {
    const top = h * 60;
    const label = h === 0 ? '' : `${h}:00`;
    timeGutter += `<div class="time-label" style="top:${top}px">${label}</div>`;
  });

  let dayCols = '';
  days.forEach((d, di) => {
    let lines = '';
    hours.forEach(h => {
      lines += `<div class="hour-line" style="top:${h*60}px"></div>`;
      lines += `<div class="half-line" style="top:${h*60+30}px"></div>`;
    });

    // Now line
    if (isSameDay(d, today)) {
      const mins = today.getHours() * 60 + today.getMinutes();
      lines += `<div class="now-line" style="top:${mins}px"></div>`;
    }

    // Get events for this day (actual events + recurring schedules)
    const dayEvents = getDayEvents(d);
    dayEvents.forEach(ev => {
      lines += renderWeekEvent(ev, d);
    });

    // Free time blocks
    const freeBlocks = getFreeTimeBlocks(d);
    freeBlocks.forEach(b => {
      const top = b.start;
      const height = b.end - b.start;
      if (height >= 30) {
        lines += `<div class="cal-event free-block" style="top:${top}px;height:${height}px">
          <div class="event-title">💚 Libres</div>
        </div>`;
      }
    });

    dayCols += `
      <div class="week-day-col" data-date="${formatDate(d)}" id="wday-${di}">
        ${lines}
      </div>`;
  });

  return `
    <div class="week-view">
      <div class="week-header">${headerCols}</div>
      <div class="week-body">
        <div class="time-gutter" style="position:relative;min-height:1440px">${timeGutter}</div>
        ${dayCols}
      </div>
    </div>`;
}

function renderWeekEvent(ev, day) {
  const start = timeToMins(ev.startTime || '00:00');
  const end = timeToMins(ev.endTime || '01:00');
  const height = Math.max(end - start, 20);
  const cfg = USER_CONFIG[ev.ownerEmail];
  const colorClass = ev.type === 'shared' ? 'shared' : (cfg?.colorClass || 'shared');

  return `<div class="cal-event ${colorClass}"
    style="top:${start}px;height:${height}px"
    data-event-id="${ev.id}"
    onclick="window.showEventPopup(event, '${ev.id}')">
    <div class="event-title">${ev.title}</div>
    ${height > 30 ? `<div class="event-time">${ev.startTime} — ${ev.endTime}</div>` : ''}
  </div>`;
}

function bindWeekEvents() {
  // Click on empty space to add event
  $$('.week-day-col').forEach(col => {
    col.addEventListener('click', e => {
      if (e.target !== col && !e.target.classList.contains('hour-line') && !e.target.classList.contains('half-line')) return;
      const date = col.dataset.date;
      const rect = col.getBoundingClientRect();
      const clickY = e.clientY - rect.top + col.closest('.week-body').scrollTop;
      const hour = Math.floor(clickY / 60);
      const min = clickY % 60 < 30 ? '00' : '30';
      openEventModal({ date, startTime: `${String(hour).padStart(2,'0')}:${min}` });
    });
  });

  // Scroll to 7am
  const body = document.querySelector('.week-body');
  if (body) body.scrollTop = 7 * 60;
}

// ── MONTH VIEW ──
function buildMonthView() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const today = new Date();
  const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let header = dayNames.map(d => `<div class="month-day-name">${d}</div>`).join('');
  let cells = '';

  // Prev month days
  const prevLast = new Date(year, month, 0).getDate();
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevLast - i);
    cells += buildMonthCell(d, true);
  }

  // Current month
  for (let d = 1; d <= totalDays; d++) {
    const date = new Date(year, month, d);
    cells += buildMonthCell(date, false);
  }

  // Next month days
  const total = startDay + totalDays;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= remaining; d++) {
    const date = new Date(year, month + 1, d);
    cells += buildMonthCell(date, true);
  }

  return `
    <div class="month-view">
      <div class="month-grid-header">${header}</div>
      <div class="month-grid">${cells}</div>
    </div>`;
}

function buildMonthCell(date, otherMonth) {
  const today = new Date();
  const isToday = isSameDay(date, today);
  const dayEvents = getDayEvents(date).slice(0, 3);
  const allDayEventsCount = getDayEvents(date).length;

  let eventsHtml = dayEvents.map(ev => {
    const cfg = USER_CONFIG[ev.ownerEmail];
    const cls = ev.type === 'shared' ? 'shared' : (cfg?.colorClass || 'shared');
    return `<div class="month-event ${cls}" data-event-id="${ev.id}"
      onclick="event.stopPropagation();window.showEventPopup(event, '${ev.id}')">${ev.title}</div>`;
  }).join('');

  if (allDayEventsCount > 3) {
    eventsHtml += `<div class="month-more">+${allDayEventsCount - 3} más</div>`;
  }

  return `
    <div class="month-cell${otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}"
      data-date="${formatDate(date)}"
      onclick="window.monthCellClick('${formatDate(date)}')">
      <div class="month-cell-num">${date.getDate()}</div>
      ${eventsHtml}
    </div>`;
}

function bindMonthEvents() {}

// ── YEAR VIEW ──
function buildYearView() {
  const year = currentDate.getFullYear();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dayNms = ['D','L','M','X','J','V','S'];

  let html = '';
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startDay = firstDay.getDay();
    const today = new Date();

    let miniGrid = dayNms.map(d => `<div class="year-mini-day-name">${d}</div>`).join('');

    for (let i = 0; i < startDay; i++) miniGrid += `<div></div>`;
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, m, d);
      const isToday = isSameDay(date, today);
      const hasEv = getDayEvents(date).length > 0;
      miniGrid += `<div class="year-mini-day${isToday ? ' today' : ''}${hasEv ? ' has-event' : ''}"
        onclick="event.stopPropagation();window.yearDayClick('${formatDate(date)}')">${d}</div>`;
    }

    html += `
      <div class="year-month" onclick="window.yearMonthClick(${year},${m})">
        <div class="year-month-title">${months[m]}</div>
        <div class="year-mini-grid">${miniGrid}</div>
      </div>`;
  }

  return `<div class="year-view">${html}</div>`;
}

function bindYearEvents() {}

// ── EVENTS DATA ──
function getDayEvents(date) {
  const dateStr = formatDate(date);
  const dayOfWeek = date.getDay();
  const result = [];

  // One-time events
  events.forEach(ev => {
    if (ev.startDate === dateStr || (ev.allDay && ev.startDate <= dateStr && ev.endDate >= dateStr)) {
      result.push(ev);
    }
    // Multi-day
    if (ev.startDate && ev.endDate && ev.startDate <= dateStr && ev.endDate >= dateStr && ev.startDate !== ev.endDate) {
      if (!result.find(r => r.id === ev.id)) result.push(ev);
    }
  });

  // Recurring schedules
  schedules.forEach(sch => {
    if (sch.days && sch.days.includes(dayOfWeek)) {
      // Check date range
      const from = sch.startDate || '2020-01-01';
      const to = sch.endDate || '2050-12-31';
      if (dateStr >= from && dateStr <= to) {
        result.push({
          id: 'sch_' + sch.id,
          title: sch.title,
          startTime: sch.startTime,
          endTime: sch.endTime,
          ownerEmail: sch.ownerEmail,
          type: 'schedule',
          isSchedule: true
        });
      }
    }
  });

  return result.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

function getFreeTimeBlocks(date) {
  const dayEvents = getDayEvents(date);
  if (dayEvents.length < 2) return [];

  // Get busy time for both users
  const busyRanges = [];
  ALLOWED_EMAILS.forEach(email => {
    dayEvents.filter(ev => ev.ownerEmail === email || ev.type === 'shared').forEach(ev => {
      if (ev.startTime && ev.endTime) {
        busyRanges.push({ start: timeToMins(ev.startTime), end: timeToMins(ev.endTime) });
      }
    });
  });

  // Find overlapping busy (both busy)
  const juanBusy = dayEvents.filter(ev => ev.ownerEmail === ALLOWED_EMAILS[0]).map(ev => ({
    start: timeToMins(ev.startTime || '00:00'), end: timeToMins(ev.endTime || '01:00')
  }));
  const greisiBusy = dayEvents.filter(ev => ev.ownerEmail === ALLOWED_EMAILS[1]).map(ev => ({
    start: timeToMins(ev.startTime || '00:00'), end: timeToMins(ev.endTime || '01:00')
  }));

  if (!juanBusy.length || !greisiBusy.length) return [];

  // Find free slots (8am–10pm, both free)
  const freeSlots = [];
  const workStart = 8 * 60, workEnd = 22 * 60;
  let t = workStart;

  while (t < workEnd) {
    const jBusy = juanBusy.some(r => t >= r.start && t < r.end);
    const gBusy = greisiBusy.some(r => t >= r.start && t < r.end);
    if (!jBusy && !gBusy) {
      if (!freeSlots.length || freeSlots[freeSlots.length-1].end !== t) {
        freeSlots.push({ start: t, end: t + 30 });
      } else {
        freeSlots[freeSlots.length-1].end = t + 30;
      }
    }
    t += 30;
  }

  return freeSlots.filter(s => (s.end - s.start) >= 60);
}

// ── MINI CALENDAR ──
function renderMiniCal() {
  const year = miniCalDate.getFullYear();
  const month = miniCalDate.getMonth();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dayNms = ['D','L','M','X','J','V','S'];
  const today = new Date();

  $('mini-cal-title').textContent = `${months[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const prevLast = new Date(year, month, 0).getDate();

  let html = dayNms.map(d => `<div class="mini-day-name">${d}</div>`).join('');

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="mini-day other-month">${prevLast - i}</div>`;
  }

  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(year, month, d);
    const isToday = isSameDay(date, today);
    const isSelected = isSameDay(date, currentDate);
    const hasEv = getDayEvents(date).length > 0;
    html += `<div class="mini-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${hasEv ? ' has-event' : ''}"
      onclick="window.miniDayClick('${formatDate(date)}')">${d}</div>`;
  }

  $('mini-cal-grid').innerHTML = html;
}

// ── EVENT MODAL ──
let editingEventId = null;

function openEventModal(prefill = {}) {
  editingEventId = null;
  const modal = $('event-modal');
  $('modal-event-title').value = '';
  $('modal-event-date').value = prefill.date || formatDate(currentDate);
  $('modal-event-start').value = prefill.startTime || '09:00';
  $('modal-event-end').value = prefill.endTime || '10:00';
  $('modal-event-type').value = 'personal';
  $('modal-event-desc').value = '';
  $('modal-allday').checked = false;
  $('modal-notify-partner').checked = true;
  modal.classList.remove('hidden');
  $('modal-delete-btn').classList.add('hidden');
}

function openEditModal(ev) {
  editingEventId = ev.id;
  const modal = $('event-modal');
  $('modal-event-title').value = ev.title || '';
  $('modal-event-date').value = ev.startDate || '';
  $('modal-event-start').value = ev.startTime || '';
  $('modal-event-end').value = ev.endTime || '';
  $('modal-event-type').value = ev.type || 'personal';
  $('modal-event-desc').value = ev.description || '';
  $('modal-allday').checked = ev.allDay || false;
  modal.classList.remove('hidden');
  $('modal-delete-btn').classList.remove('hidden');
}

$('close-event-modal').addEventListener('click', () => $('event-modal').classList.add('hidden'));
$('cancel-event-btn').addEventListener('click', () => $('event-modal').classList.add('hidden'));

$('save-event-btn').addEventListener('click', async () => {
  const title = $('modal-event-title').value.trim();
  if (!title) { showToast('Por favor ingresa un título', 'error'); return; }

  const type = $('modal-event-type').value;
  const data = {
    title,
    startDate: $('modal-event-date').value,
    endDate: $('modal-event-date').value,
    startTime: $('modal-event-start').value,
    endTime: $('modal-event-end').value,
    allDay: $('modal-allday').checked,
    type,
    description: $('modal-event-desc').value,
    ownerEmail: currentUser.email,
    createdBy: currentUser.uid,
    sharedWith: ALLOWED_EMAILS.map(e => e),
    updatedAt: serverTimestamp()
  };

  try {
    if (editingEventId) {
      await updateDoc(doc(db, 'events', editingEventId), data);
      showToast('✅ Evento actualizado');
    } else {
      data.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'events'), data);
      // Notify partner
      if ($('modal-notify-partner').checked) {
        await notifyPartner(title, data.startDate, data.startTime);
      }
      showToast('✅ Evento creado');
    }
    $('event-modal').classList.add('hidden');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
});

$('modal-delete-btn').addEventListener('click', async () => {
  if (!editingEventId) return;
  if (!confirm('¿Eliminar este evento?')) return;
  try {
    await deleteDoc(doc(db, 'events', editingEventId));
    $('event-modal').classList.add('hidden');
    showToast('🗑️ Evento eliminado');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
});

// ── SCHEDULE MODAL ──
let selectedScheduleDays = [];

function openScheduleModal() {
  selectedScheduleDays = [];
  $('modal-sch-title').value = '';
  $('modal-sch-start').value = '08:00';
  $('modal-sch-end').value = '10:00';
  $('modal-sch-from').value = formatDate(new Date());
  $('modal-sch-to').value = '2026-12-31';
  $$('.recur-day').forEach(b => b.classList.remove('selected'));
  $('schedule-modal').classList.remove('hidden');
}

$('close-schedule-modal').addEventListener('click', () => $('schedule-modal').classList.add('hidden'));
$('cancel-schedule-btn').addEventListener('click', () => $('schedule-modal').classList.add('hidden'));

document.addEventListener('click', e => {
  if (e.target.classList.contains('recur-day')) {
    const day = parseInt(e.target.dataset.day);
    e.target.classList.toggle('selected');
    if (selectedScheduleDays.includes(day)) {
      selectedScheduleDays = selectedScheduleDays.filter(d => d !== day);
    } else {
      selectedScheduleDays.push(day);
    }
  }
});

$('save-schedule-btn').addEventListener('click', async () => {
  const title = $('modal-sch-title').value.trim();
  if (!title) { showToast('Por favor ingresa un título', 'error'); return; }
  if (!selectedScheduleDays.length) { showToast('Selecciona al menos un día', 'error'); return; }

  try {
    await addDoc(collection(db, 'schedules'), {
      title,
      startTime: $('modal-sch-start').value,
      endTime: $('modal-sch-end').value,
      days: selectedScheduleDays,
      startDate: $('modal-sch-from').value,
      endDate: $('modal-sch-to').value,
      ownerEmail: currentUser.email,
      ownerId: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $('schedule-modal').classList.add('hidden');
    showToast('✅ Horario guardado');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
});

// ── NOTIFICATIONS ──
async function notifyPartner(title, date, time) {
  const partnerEmail = ALLOWED_EMAILS.find(e => e !== currentUser.email);
  const partnerDoc = await getDocs(query(collection(db, 'users'), where('email', '==', partnerEmail)));
  if (partnerDoc.empty) return;

  const partner = partnerDoc.docs[0].data();
  const myName = USER_CONFIG[currentUser.email]?.name || 'Tu pareja';

  await addDoc(collection(db, 'notifications'), {
    recipientId: partner.uid,
    title: `${myName} agregó un evento`,
    body: `"${title}" el ${date}${time ? ' a las ' + time : ''}`,
    type: 'new_event',
    read: false,
    createdAt: serverTimestamp()
  });
}

function updateNotifBadge() {
  const unread = notifications.filter(n => !n.read).length;
  const badge = $('notif-badge');
  if (unread > 0) {
    badge.textContent = unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotifPanel() {
  const panel = $('notif-panel');
  if (!panel) return;
  const list = panel.querySelector('.notif-list');

  if (notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty">💌 Sin notificaciones</div>`;
    return;
  }

  list.innerHTML = notifications.slice(0, 20).map(n => `
    <div class="notif-item${n.read ? '' : ' unread'}" data-notif-id="${n.id}">
      <div class="notif-icon">🔔</div>
      <div class="notif-body">
        <div class="notif-title">${n.title}: ${n.body}</div>
        <div class="notif-time">${formatRelativeTime(n.createdAt)}</div>
      </div>
    </div>
  `).join('');

  // Mark as read
  notifications.filter(n => !n.read).forEach(async n => {
    await updateDoc(doc(db, 'notifications', n.id), { read: true });
  });
}

// ── EVENT POPUP ──
window.showEventPopup = function(e, eventId) {
  e.stopPropagation();
  const existing = document.querySelector('.event-popup');
  if (existing) existing.remove();

  const ev = events.find(ev => ev.id === eventId) ||
             schedules.find(s => 'sch_' + s.id === eventId);
  if (!ev) return;

  const cfg = USER_CONFIG[ev.ownerEmail];
  const color = ev.type === 'shared' ? '#c084fc' : (cfg?.color || '#818cf8');

  const popup = document.createElement('div');
  popup.className = 'event-popup';
  popup.style.left = Math.min(e.clientX, window.innerWidth - 300) + 'px';
  popup.style.top = Math.min(e.clientY + 8, window.innerHeight - 250) + 'px';

  popup.innerHTML = `
    <div class="event-popup-color" style="background:${color}"></div>
    <div class="event-popup-title">${ev.title}</div>
    <div class="event-popup-detail">📅 ${ev.startDate || ''}</div>
    ${ev.startTime ? `<div class="event-popup-detail">🕐 ${ev.startTime} — ${ev.endTime}</div>` : ''}
    ${ev.description ? `<div class="event-popup-detail">📝 ${ev.description}</div>` : ''}
    <div class="event-popup-detail">👤 ${cfg?.name || 'Compartido'}</div>
    ${ev.createdBy === currentUser?.uid && !ev.isSchedule ? `
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-secondary" style="flex:1;padding:7px" onclick="window.editEvent('${ev.id}')">Editar</button>
      </div>` : ''}
  `;

  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 100);
};

window.editEvent = function(id) {
  document.querySelector('.event-popup')?.remove();
  const ev = events.find(e => e.id === id);
  if (ev) openEditModal(ev);
};

// ── GLOBAL CLICK HANDLERS ──
window.miniDayClick = function(dateStr) {
  currentDate = parseDate(dateStr);
  if (currentView === 'year' || currentView === 'month') setView('week');
  else renderCurrentView();
  renderMiniCal();
  updatePeriodLabel();
};

window.monthCellClick = function(dateStr) {
  currentDate = parseDate(dateStr);
  setView('week');
  updatePeriodLabel();
};

window.yearDayClick = function(dateStr) {
  currentDate = parseDate(dateStr);
  setView('week');
  updatePeriodLabel();
};

window.yearMonthClick = function(year, month) {
  currentDate = new Date(year, month, 1);
  setView('month');
  updatePeriodLabel();
};

// ── TOPBAR EVENTS ──
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

$('btn-prev').addEventListener('click', () => navigate(-1));
$('btn-next').addEventListener('click', () => navigate(1));
$('btn-today').addEventListener('click', goToToday);
$('btn-add-event').addEventListener('click', () => openEventModal());
$('btn-add-schedule').addEventListener('click', openScheduleModal);

$('mini-cal-prev').addEventListener('click', () => {
  miniCalDate = addMonths(miniCalDate, -1);
  renderMiniCal();
});
$('mini-cal-next').addEventListener('click', () => {
  miniCalDate = addMonths(miniCalDate, 1);
  renderMiniCal();
});

// Notifications panel
$('notif-btn').addEventListener('click', e => {
  e.stopPropagation();
  notifPanelOpen = !notifPanelOpen;
  const panel = $('notif-panel');
  if (notifPanelOpen) {
    panel.classList.remove('hidden');
    renderNotifPanel();
  } else {
    panel.classList.add('hidden');
  }
});

document.addEventListener('click', () => {
  notifPanelOpen = false;
  $('notif-panel')?.classList.add('hidden');
});

$('notif-panel')?.addEventListener('click', e => e.stopPropagation());

// Clear notifications
$('clear-notifs-btn')?.addEventListener('click', async () => {
  for (const n of notifications) {
    await deleteDoc(doc(db, 'notifications', n.id));
  }
  showToast('Notificaciones eliminadas');
});

// Sign out
$('signout-btn').addEventListener('click', async () => {
  await signOut(auth);
  showToast('👋 Hasta luego');
});

// ── TOAST ──
function showToast(msg, type = 'success') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── DATE UTILS ──
function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function addYears(date, n) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function parseDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}

function timeToMins(time) {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date) / 1000;
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff/60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff/3600)} h`;
  return date.toLocaleDateString('es');
}

window.showToast = showToast;
window.openEventModal = openEventModal;
