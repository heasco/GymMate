const API_URL = 'http://localhost:8080';
const $ = (id) => document.getElementById(id);

// ========== AUTH & MEMBER ID UTILS ==========
function getAuth() {
  try { return JSON.parse(localStorage.getItem('authUser') || 'null'); } catch { return null; }
}
function memberIdFromAuth() {
  const a = getAuth();
  if (!a || !a.user) return null;
  const u = a.user;
  return u.memberId || u.member_id || u._id || u.id || null;
}
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ========== MAIN GLOBALS ==========
let availableClasses = [];
let memberEnrollments = [];
let memberInfo = null;
let realRemainingSessions = 0; // always current from DB
let enrollCart = [];
let currentCalendarDate = new Date();
// Used for "projected" value when items are in cart
let tempRemainingSessions = 0;

// ---------- Date helpers ----------
function parseYMDToLocal(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}
function dateToYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function isPastDate(dateStr) {
  const d = parseYMDToLocal(dateStr);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

// ========== API FETCH ==========
async function timedFetch(url, name) {
  console.time(name);
  const res = await fetch(url);
  console.timeEnd(name);
  return res;
}

// ========== TOAST HELPER ==========
function showToast(message, type = 'info') {
  try {
    const containerId = 'toastContainer';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.position = 'fixed';
      container.style.right = '20px';
      container.style.bottom = '20px';
      container.style.zIndex = 99999;
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    el.style.marginTop = '8px';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
    el.style.background = (type === 'success' ? '#198754' : (type === 'error' ? '#dc3545' : (type === 'warning' ? '#f6c23e' : '#0d6efd')));
    el.style.color = (type === 'warning' ? '#333' : '#fff');
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 3000);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3350);
  } catch (err) {
    alert(`${type.toUpperCase()}: ${message}`);
  }
  console.log(`${type.toUpperCase()}: ${message}`);
}

function showLoadingState(show = true) {
  const btn = $('confirmCartBtn');
  if (btn) btn.disabled = show;
}

// ========== DOM READY ==========
document.addEventListener('DOMContentLoaded', async () => {
  const auth = getAuth();
  if (!auth || auth.role !== 'member' || !auth.user) {
    window.location.href = "../member-login.html";
    return;
  }
  showLoadingState(true);
  await loadInitialData();
  setupEventListeners();
  initializeCalendarView();
  renderListView();
  switchView('calendar');
  showLoadingState(false);
});

// ========== DATA LOAD & SESSION CALC ==========
async function loadInitialData() {
  try {
    const memberId = memberIdFromAuth();
    if (!memberId) throw new Error('No member ID in auth');

    const memberPromise = timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Member API').then(r => r.json());
    const classesPromise = timedFetch(`${API_URL}/api/classes`, 'Classes API').then(r => r.json());
    const enrollmentsPromise = timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Enrollments API').then(r => r.json());

    const [memberData, classesData, enrollmentsData] = await Promise.all([
      memberPromise.catch(err => { console.error('Member load failed:', err); return { success: false, data: null }; }),
      classesPromise.catch(err => { console.error('Classes load failed:', err); return { success: false, data: [] }; }),
      enrollmentsPromise.catch(err => { console.error('Enrollments load failed:', err); return { success: false, data: [] }; })
    ]);

    memberInfo = (memberData && memberData.success && memberData.data) ? memberData.data : memberData || null;
    availableClasses = Array.isArray(classesData?.data) ? classesData.data : (Array.isArray(classesData) ? classesData : []);
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : (Array.isArray(enrollmentsData) ? enrollmentsData : []);

    updateSessionCounter(false, 0);
    renderCalendarGrid();
    renderListView();
    updateCartDisplay();
  } catch (err) {
    console.error('loadInitialData Error:', err);
    showErrorState('Failed to load data. Check console and backend.');
  }
}

// ========== VIEW STATES & UTILS ==========
function showLoadingStateGlobal() {
  const c = $('calendarContainer'); if (c) c.innerHTML = '<div class="loading-state">Loading classes...</div>';
  const l = $('classesGrid'); if (l) l.innerHTML = '<div class="loading-state">Loading classes...</div>';
}
function hideLoadingStateGlobal() {
  document.querySelectorAll('.loading-state').forEach(el => el.remove());
}
function showErrorState(msg = 'Failed to load classes.') {
  const c = $('calendarContainer');
  if (c) c.innerHTML = `<div class="error-state">${msg}</div>`;
}

// ========== SESSION LOGIC ==========
function getCurrentSessionPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

function updateSessionCounter(forceCart = false, tempOffset = 0) {
  const remainingSessionSpan = $('remainingSessions');
  const memInfoSpan = $('membershipInfo');

  if (!memberInfo) {
    if (remainingSessionSpan) remainingSessionSpan.textContent = '0';
    if (memInfoSpan) memInfoSpan.textContent = 'No member data loaded';
    realRemainingSessions = 0;
    tempRemainingSessions = 0;
    return;
  }

  let memberships = memberInfo.memberships || [];
  if (!Array.isArray(memberships)) memberships = [];

  const combative = memberships
    .filter(m => m.type && m.type.toLowerCase() === 'combative' && (m.status || '').toLowerCase() === 'active')
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];

  if (!combative) {
    if (remainingSessionSpan) remainingSessionSpan.textContent = '0';
    if (memInfoSpan) memInfoSpan.textContent = 'No active combative membership';
    realRemainingSessions = 0;
    tempRemainingSessions = 0;
    return;
  }

  realRemainingSessions = Math.max(0, combative.remainingSessions || 0);
  const totalSessionsPerMonth = combative.sessionsPerMonth || null;

  if (forceCart && enrollCart.length > 0) {
    tempRemainingSessions = Math.max(0, realRemainingSessions - enrollCart.length + tempOffset);
    if (remainingSessionSpan) {
      remainingSessionSpan.innerHTML = `${tempRemainingSessions} <small style="color:#999;">(projected)</small>`;
    }
    let infoText = `Combative (${combative.status}) | Real: ${realRemainingSessions}`;
    if (totalSessionsPerMonth) {
      infoText += ` (total: ${totalSessionsPerMonth}/month)`;
    }
    if (memInfoSpan) memInfoSpan.innerHTML = infoText;
  } else {
    tempRemainingSessions = realRemainingSessions;
    if (remainingSessionSpan) remainingSessionSpan.textContent = realRemainingSessions;
    let infoText = `Combative (${combative.status}) | Remaining: ${realRemainingSessions}`;
    if (totalSessionsPerMonth) {
      infoText += ` (allocated: ${totalSessionsPerMonth}/month)`;
    }
    if (memInfoSpan) memInfoSpan.textContent = infoText;
  }

  const confirmBtn = $('confirmCartBtn');
  if (confirmBtn) {
    const canConfirm = enrollCart.length > 0 && realRemainingSessions >= enrollCart.length;
    confirmBtn.disabled = !canConfirm;
    confirmBtn.textContent = enrollCart.length > 0 ? `Confirm All (${enrollCart.length})` : 'Confirm All Enrollments';
  }

  // Also update calendar confirm button when present
  const confirmBtnCalendar = $('confirmCartBtnCalendar');
  if (confirmBtnCalendar) {
    const canConfirm = enrollCart.length > 0 && realRemainingSessions >= enrollCart.length;
    confirmBtnCalendar.disabled = !canConfirm;
    confirmBtnCalendar.textContent = enrollCart.length > 0 ? `Confirm All (${enrollCart.length})` : 'Confirm All Enrollments';
  }
}

// ========== CALENDAR VIEW ==========
function initializeCalendarView() {
  renderCalendarGrid();
  renderCalendarNavigation();
  updateCalendarTitle();
  ensureCalendarCartContainer(); // create calendar cart area if missing
}
function renderCalendarGrid() {
  const container = $('calendarContainer');
  if (!container) return;
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" id="prevMonth">‹</button>
    <span id="currentMonthDisplay"></span>
    <button class="calendar-nav-btn" id="nextMonth">›</button></div>
    <div class="calendar-grid">`;
  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  weekdays.forEach(day => { html += `<div class="calendar-header-day">${day}</div>`; });
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDay = firstDay.getDay();
  let cellIndex = 0;
  for (let i = 0; i < startingDay; i++) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    const past = isPastDate(dateStr);
    const dayClasses = getClassesForDate(dateStr);
    let classChips = '';
    if (dayClasses.length > 0) {
      classChips = dayClasses.slice(0, 2).map(cls => {
        const title = escapeHtml(cls.class_name || cls.class_title || 'Class');
        return `<div class="class-chip ${past ? 'past' : ''}" title="${title}">${title}</div>`;
      }).join('');
      if (dayClasses.length > 2) classChips += `<div class="class-chip ${past ? 'past' : ''}">+${dayClasses.length - 2} more</div>`;
    }
    html += `<div class="calendar-cell${isToday ? ' calendar-cell-today' : ''}${past ? ' calendar-cell-past' : ''}" data-date="${dateStr}" data-past="${past ? '1' : '0'}">
      <div class="calendar-day-number">${day}</div>
      <div class="calendar-day-content"><div class="calendar-day-classes">${classChips}</div></div></div>`;
    cellIndex++;
    if (cellIndex % 7 === 0 && day < daysInMonth) cellIndex = 0;
  }
  while (cellIndex % 7 !== 0) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }
  html += '</div>';
  container.innerHTML = html;
  // Use capture to avoid conflicts
  document.removeEventListener('click', handleCalendarClick, true);
  document.addEventListener('click', handleCalendarClick, true);

  // Ensure calendar cart exists and update it
  ensureCalendarCartContainer();
  updateCartDisplay();
}
function renderCalendarNavigation() {
  $('prevMonth')?.addEventListener('click', previousMonth);
  $('nextMonth')?.addEventListener('click', nextMonth);
}
function handleCalendarClick(event) {
  const cell = event.target.closest('.calendar-cell');
  if (!cell || cell.classList.contains('calendar-cell-empty')) return;
  const dateStr = cell.getAttribute('data-date');
  if (!dateStr) return;
  if (isPastDate(dateStr)) {
    showToast('This date has already passed — enrollment is disabled for past dates.', 'warning');
    return;
  }
  const dayClasses = getClassesForDate(dateStr);
  showDayModal(dateStr, dayClasses);
}
function getClassesForDate(dateStr) {
  let dayNameFull = '';
  let dayNameShort = '';
  try {
    const tmp = new Date(dateStr);
    dayNameFull = tmp.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    dayNameShort = dayNameFull.slice(0, 3);
  } catch (e) {
    dayNameFull = '';
    dayNameShort = '';
  }

  return availableClasses.filter(cls => {
    if (Array.isArray(cls.sessions) && cls.sessions.length) {
      for (const s of cls.sessions) {
        const sDate = s?.date || s?.sessiondate || s?.session_date || s?.sessionDate;
        if (!sDate) continue;
        if (String(sDate).startsWith(dateStr) || String(sDate) === dateStr) return true;
      }
      return false;
    }

    if (Array.isArray(cls.dates) && cls.dates.length) {
      if (cls.dates.some(dt => String(dt).startsWith(dateStr) || String(dt) === dateStr)) return true;
      return false;
    }
    if (Array.isArray(cls.session_dates) && cls.session_dates.length) {
      if (cls.session_dates.some(dt => String(dt).startsWith(dateStr) || String(dt) === dateStr)) return true;
      return false;
    }

    if (cls.sessiondate && (String(cls.sessiondate).startsWith(dateStr) || String(cls.sessiondate) === dateStr)) return true;
    if (cls.date && (String(cls.date).startsWith(dateStr) || String(cls.date) === dateStr)) return true;

    if (typeof cls.schedule === 'string' && cls.schedule.trim().length > 0) {
      const schedule = cls.schedule.toLowerCase();
      const weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      const mentionsWeekday = weekdays.some(w => schedule.includes(w) || schedule.includes(w.slice(0,3)));
      if (mentionsWeekday) {
        if (dayNameFull && (schedule.includes(dayNameFull) || schedule.includes(dayNameShort))) {
          return true;
        }
        return false;
      }
      if (schedule.includes(dateStr) || schedule.includes(dateStr.replace(/-/g, '/'))) return true;
      if (schedule.match(/\d{1,2}:\d{2}/)) return true;
    }

    const hasSchedulingProps = cls.sessions || cls.dates || cls.session_dates || cls.sessiondate || cls.date || cls.schedule;
    if (!hasSchedulingProps) return true;

    return false;
  });
}
function showDayModal(dateStr, classes) {
  const date = new Date(dateStr);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const past = isPastDate(dateStr);
  let modalContent = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3>Classes for ${formattedDate}</h3>
        <div class="day-modal-date">${dateStr}</div>
        <div class="day-modal-sessions">
           <span class="day-modal-sessions-remaining">
             Sessions remaining: <span id="modalSessionsRemaining">${tempRemainingSessions}</span>
           </span>
        </div>
      </div>
      <div class="day-modal-content">
  `;
  if (past) {
    modalContent += `<div class="past-note">This date has passed — enrollment disabled for this day.</div>`;
  }
  if (classes.length === 0) {
    modalContent += '<div class="no-classes">No classes scheduled for this date</div>';
  } else {
    classes.forEach(cls => {
      const classId = cls.class_id || cls._id || cls.id || '';
      const className = cls.class_name || cls.class_title || 'Unnamed Class';
      const trainer = cls.trainer_name || cls.trainer_id || 'TBD';
      const schedule = cls.schedule || 'Schedule TBD';
      const disabledAttr = past ? 'disabled' : '';
      const btnText = past ? 'Date passed' : 'Select Time';
      modalContent += `
        <div class="class-selection">
         <div class="class-info">
           <div class="class-name">${escapeHtml(className)}</div>
           <div class="class-trainer">Trainer: ${escapeHtml(trainer)}</div>
           <div class="class-schedule">${escapeHtml(schedule)}</div>
         </div>
         <div class="class-times">
           <button class="select-time-btn" data-class="${escapeHtml(classId)}" data-class-name="${escapeHtml(className)}" data-date="${escapeHtml(dateStr)}" ${disabledAttr}>
             ${escapeHtml(btnText)}
           </button>
         </div>
        </div>
      `;
    });
  }
  modalContent += `
        </div>
        <div class="day-modal-footer">
         <button class="btn btn-ghost" onclick="closeModal('dayModal')">Close</button>
        </div>
      </div>
  `;
  let modal = document.getElementById('dayModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dayModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const timeBtns = modal.querySelectorAll('.select-time-btn');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      const classId = this.dataset.class;
      const className = this.dataset.className;
      const dateFor = this.dataset.date;
      showTimeSelectionModal(classId, className, dateFor);
    });
  });
}
function showTimeSelectionModal(classId, className, dateStr) {
  if (isPastDate(dateStr)) {
    showToast('Cannot select time: this date has already passed.', 'error');
    return;
  }
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId || c.id === classId);
  if (!cls) {
    alert('Class not found');
    return;
  }
  const timeSlots = generateTimeSlots(cls.schedule || cls);
  let modalContent = `
    <div class="time-modal">
      <div class="time-modal-header">
        <h3>Select Time for ${escapeHtml(className)}</h3>
        <div class="time-modal-date">${new Date(dateStr).toLocaleDateString()}</div>
      </div>
      <div class="time-modal-content">
  `;
  timeSlots.forEach(timeSlot => {
    const isEnrolled = memberEnrollments.some(enrollment => {
      const enDate = enrollment.sessiondate || enrollment.session_date || enrollment.date || '';
      const enTime = enrollment.sessiontime || enrollment.session_time || enrollment.time || '';
      return (String(enDate).startsWith(dateStr) || enDate === dateStr) &&
        (enrollment.classid === classId || enrollment.class_id === classId || enrollment.classid === classId) &&
        String(enTime) === String(timeSlot);
    });
    modalContent += `
      <div class="time-slot-item ${isEnrolled ? 'disabled' : ''}" 
           data-class="${classId}" data-date="${dateStr}" data-time="${timeSlot}">
        <div class="time-slot-label">${escapeHtml(timeSlot)}</div>
        <button class="select-enrollment-btn" ${isEnrolled ? 'disabled' : ''}>
          ${isEnrolled ? 'Already Enrolled' : 'Add to Cart'}
        </button>
      </div>
    `;
  });
  modalContent += `
      </div>
      <div class="time-modal-footer">
       <button class="btn btn-ghost" onclick="closeModal('timeModal')">Cancel</button>
      </div>
    </div>
  `;
  let modal = document.getElementById('timeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'timeModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const enrollBtns = modal.querySelectorAll('.select-enrollment-btn');
  enrollBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      const classIdVal = this.closest('.time-slot-item').dataset.class;
      const dateStrVal = this.closest('.time-slot-item').dataset.date;
      const timeSlotVal = this.closest('.time-slot-item').dataset.time;
      addToEnrollmentCart(classIdVal, dateStrVal, timeSlotVal, className);
    });
  });
}

// ========== CART MANAGEMENT ==========
function addToEnrollmentCart(classId, dateStr, timeSlot, className) {
  if (isPastDate(dateStr)) {
    showToast('Cannot add to cart: selected date has already passed.', 'error');
    return;
  }

  const existing = enrollCart.find(item =>
    item.classId === classId &&
    item.date === dateStr &&
    item.time === timeSlot
  );

  if (existing) {
    showToast('Already added to cart for this date and time', 'warning');
    return;
  }

  if (realRemainingSessions < 1) {
    showToast(`No sessions left. Real remaining: ${realRemainingSessions}. Contact admin.`, 'error');
    return;
  }

  enrollCart.push({
    classId: classId,
    className: className,
    date: dateStr,
    time: timeSlot
  });

  closeModal('timeModal');
  updateCartDisplay();

  updateSessionCounter(true, 0);

  const message = tempRemainingSessions < enrollCart.length 
    ? `Added! Projected: ${tempRemainingSessions} (over limit—can't confirm until renewed).` 
    : 'Added to cart! Sessions temporarily updated on screen.';
  showToast(message, 'success');
}

function updateCartDisplay() {
  // Render to both list cart and calendar cart (if present)
  const cartContainerList = $('enrollmentCart');
  const cartContentList = $('cartContent');
  const confirmBtnList = $('confirmCartBtn');

  const cartContainerCalendar = $('enrollmentCartCalendar');
  const cartContentCalendar = $('cartContentCalendar');
  const confirmBtnCalendar = $('confirmCartBtnCalendar');

  // Always show cart container(s) if present
  if (cartContainerList) cartContainerList.style.display = "block";
  if (cartContainerCalendar) cartContainerCalendar.style.display = "block";

  if (enrollCart.length === 0) {
    if (cartContentList) cartContentList.innerHTML = '<p>No temporary selections. Add from calendar or list.</p>';
    if (cartContentCalendar) cartContentCalendar.innerHTML = '<p>No temporary selections. Add from calendar or list.</p>';
    if (confirmBtnList) {
      confirmBtnList.disabled = true;
      confirmBtnList.textContent = 'Confirm All Enrollments';
    }
    if (confirmBtnCalendar) {
      confirmBtnCalendar.disabled = true;
      confirmBtnCalendar.textContent = 'Confirm All Enrollments';
    }
    updateSessionCounter(false, 0);
    return;
  }

  // Build cart HTML
  let html = '';
  enrollCart.forEach((item, index) => {
    const dateObj = new Date(item.date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    html += `
      <div class="cart-item" data-index="${index}">
        <div class="cart-item-info">
          <strong>${escapeHtml(item.className)}</strong><br>
          <small>${dayOfWeek}, ${formattedDate} at ${escapeHtml(item.time)} (Temporary)</small>
        </div>
        <button type="button" class="cart-item-remove" data-index="${index}" title="Remove (+1 session)">✕</button>
      </div>
    `;
  });

  if (cartContentList) cartContentList.innerHTML = html;
  if (cartContentCalendar) cartContentCalendar.innerHTML = html;

  // Wire remove buttons (for both containers)
  document.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.removeEventListener('click', handleCartRemoveClick);
    btn.addEventListener('click', handleCartRemoveClick);
  });

  // Update confirm buttons state and text
  updateSessionCounter(true, 0);

  if (confirmBtnList) {
    confirmBtnList.disabled = tempRemainingSessions < enrollCart.length || realRemainingSessions < enrollCart.length;
    confirmBtnList.textContent = `Confirm All (${enrollCart.length})`;
  }
  if (confirmBtnCalendar) {
    confirmBtnCalendar.disabled = tempRemainingSessions < enrollCart.length || realRemainingSessions < enrollCart.length;
    confirmBtnCalendar.textContent = `Confirm All (${enrollCart.length})`;
  }
}

function handleCartRemoveClick(e) {
  const idx = Number(e.currentTarget.dataset.index);
  if (!isNaN(idx)) removeFromCart(idx);
}

function removeFromCart(index) {
  if (index < 0 || index >= enrollCart.length) return;

  enrollCart.splice(index, 1);
  updateCartDisplay();

  updateSessionCounter(true, 1);

  if (enrollCart.length === 0) {
    updateSessionCounter(false, 0);
  }
}

// Helper: Send single enrollment POST (reusable for loop)
async function enrollSingleItem(item) {
  const memberId = memberIdFromAuth();
  if (!memberId) throw new Error('Not authenticated');

  const body = {
    classid: item.classId,
    memberid: memberId,
    sessiondate: item.date,
    sessiontime: item.time,
    membername: memberInfo?.name || 'Unknown'
  };

  const response = await fetch(`${API_URL}/api/enrollments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAuth()?.token || ''}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: Enrollment failed`);
  }

  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Enrollment failed');

  return data;
}

// Main: Confirm all enrollments in cart (bulk via looping)
async function confirmAllEnrollments() {
  if (!enrollCart || enrollCart.length === 0) {
    showToast('No items in cart', 'warning');
    return;
  }

  showLoadingState(true);

  try {
    const totalItems = enrollCart.length;
    const projectedRemaining = realRemainingSessions - totalItems;
    if (projectedRemaining < 0) {
      showToast(`Not enough sessions: Need ${totalItems}, have ${realRemainingSessions}`, 'error');
      return;
    }

    let successful = 0;
    let failures = [];
    let lastRemaining = realRemainingSessions;

    for (let index = 0; index < enrollCart.length; index++) {
      const item = enrollCart[index];
      try {
        const result = await enrollSingleItem(item);
        successful++;
        lastRemaining = result.remainingsessions || lastRemaining - 1;
      } catch (error) {
        failures.push({ index, item, error: error.message });
      }
    }

    tempRemainingSessions = lastRemaining - (totalItems - successful);

    if (successful === totalItems) {
      enrollCart = [];
      updateCartDisplay();
      showToast(`All ${totalItems} enrollments successful! Sessions left: ${tempRemainingSessions}`, 'success');
      await loadMemberEnrollments();
      updateSessionCounter(false, 0);
    } else if (successful > 0) {
      const successIndices = [];
      for (let i = 0; i < totalItems; i++) {
        if (!failures.find(f => f.index === i)) successIndices.push(i);
      }
      successIndices.reverse().forEach(idx => enrollCart.splice(idx, 1));
      updateCartDisplay();
      const errorMsg = failures.map(f => `Item ${f.index + 1} (${f.item.className || f.item.classId}): ${f.error}`).join('\n');
      showToast(`${successful}/${totalItems} successful (cart updated). Errors:\n${errorMsg}`, 'warning');
    } else {
      const errorMsg = failures.map(f => `Item ${f.index + 1} (${f.item.className || f.item.classId}): ${f.error}`).join('\n');
      showToast(`No enrollments successful. Errors:\n${errorMsg}`, 'error');
      updateCartDisplay();
    }

    console.log(`Bulk enrollment: ${successful}/${totalItems} success`, { successful, failures });

  } catch (error) {
    console.error('Bulk enrollment error:', error);
    showToast(`Bulk enrollment failed: ${error.message}`, 'error');
  } finally {
    showLoadingState(false);
  }
}

async function loadMemberEnrollments() {
  const memberId = memberIdFromAuth();
  if (!memberId) return;
  try {
    const [enrollmentsData, memberData] = await Promise.all([
      timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Reload Enrollments').then(r => r.json()),
      timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Reload Member').then(r => r.json())
    ]);
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : (Array.isArray(enrollmentsData) ? enrollmentsData : []);
    memberInfo = (memberData && memberData.success && memberData.data) ? memberData.data : memberData || null;
    updateSessionCounter(false, 0);
  } catch (err) {
    console.error('Reload failed:', err);
    showToast('Failed to reload data', 'error');
  }
}

// ========== LIST VIEW ==========
function renderListView() {
  const container = document.getElementById('classesGrid');
  if (!container || availableClasses.length === 0) {
    container.innerHTML = `
      <div class="column is-full">
        <div class="has-text-centered py-6">
          <p class="is-size-5 has-text-grey">No classes available</p>
        </div>
      </div>
    `;
    return;
  }
  let html = `<div class="columns is-multiline">`;
  availableClasses.forEach(cls => {
    const classId = cls.class_id || cls._id;
    const className = cls.class_name || 'Unnamed Class';
    const trainerName = cls.trainer_name || cls.trainer_id || 'TBD';
    const capacity = cls.capacity || 10;
    const currentEnrollment = cls.current_enrollment || 0;
    const isFull = currentEnrollment >= capacity;
    html += `
      <div class="column is-6-desktop is-12-mobile">
        <div class="class-card">
          <div class="card-content">
            <div class="class-header">
              <h3 class="class-title">${escapeHtml(className)}</h3>
              <div class="class-schedule">${escapeHtml(cls.schedule || 'Schedule TBD')}</div>
              <div class="class-trainer">Trainer: ${escapeHtml(trainerName)}</div>
              <div class="class-capacity">
                ${isFull ? '<span class="status-full">FULL</span>' :
                `<span class="status-open">${currentEnrollment}/${capacity} spots</span>`}
              </div>
            </div>
            <div class="class-description">
              <p>${escapeHtml(cls.description || 'No description available')}</p>
            </div>
            <div class="class-action">
              <button class="btn btn-primary" onclick="showClassForEnrollment('${classId}')"
                      ${isFull ? 'disabled' : ''}>
                ${isFull ? 'Class Full' : 'Enroll Now'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}
function showClassForEnrollment(classId) {
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
  if (!cls) {
    alert('Class not found');
    return;
  }
  const timeSlots = generateTimeSlots(cls.schedule);
  let modalContent = `
    <div class="single-class-modal">
      <div class="modal-header">
        <h2>${escapeHtml(cls.class_name)}</h2>
        <div class="modal-date">${new Date().toLocaleDateString()}</div>
      </div>
      <div class="modal-body">
        <p><strong>Trainer:</strong> ${escapeHtml(cls.trainer_name || cls.trainer_id || 'TBD')}</p>
        <p><strong>Schedule:</strong> ${escapeHtml(cls.schedule || 'Schedule TBD')}</p>
        <p><strong>Description:</strong> ${escapeHtml(cls.description || 'No description')}</p>
        <div class="time-selection">
          <h4>Select Date and Time</h4>
          <input type="date" id="enrollDatePicker" value="${new Date().toISOString().split('T')[0]}"
                 class="date-picker">
          <div class="time-slots">
  `;
  timeSlots.forEach(timeSlot => {
    modalContent += `
      <button class="time-slot-btn" data-class="${classId}" data-date="${new Date().toISOString().split('T')[0]}"
              data-time="${timeSlot}">
        ${timeSlot}
      </button>
    `;
  });
  modalContent += `
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" onclick="addSingleEnrollment('${classId}', '${escapeHtml(cls.class_name)}')">
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  let modal = document.getElementById('singleClassModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'singleClassModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const datePicker = document.getElementById('enrollDatePicker');
  if (datePicker) {
    datePicker.addEventListener('change', function () {
      const timeBtns = modal.querySelectorAll('.time-slot-btn');
      timeBtns.forEach(btn => {
        btn.dataset.date = this.value;
      });
    });
  }
  const timeSlotBtns = modal.querySelectorAll('.time-slot-btn');
  timeSlotBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      timeSlotBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const classIdVal = this.dataset.class;
      const dateVal = this.dataset.date;
      const timeVal = this.dataset.time;
      addToEnrollmentCart(classIdVal, dateVal, timeVal, cls.class_name);
      modal.style.display = 'none';
    });
  });
}

// ========== MODAL CLOSE ==========
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}
function addSingleEnrollment(classId, className) {
  const date = $('enrollDatePicker')?.value || new Date().toISOString().split('T')[0];
  const timeSlot = document.querySelector('.time-slot-btn.active')?.dataset.time || 'N/A';
  addToEnrollmentCart(classId, date, timeSlot, className);
}

// ========== EVENTS ==========
function setupEventListeners() {
  const calendarTab = document.getElementById('tabCalendar');
  const listTab = document.getElementById('tabList');
  const confirmBtn = $('confirmCartBtn');
  if (calendarTab) {
    calendarTab.addEventListener('click', () => {
      switchView('calendar');
      ensureCalendarCartContainer();
      updateCartDisplay();
    });
  }
  if (listTab) {
    listTab.addEventListener('click', () => switchView('list'));
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', confirmAllEnrollments);
  }
  // calendar confirm button listener created in ensureCalendarCartContainer when it gets created
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal('dayModal');
      closeModal('timeModal');
      closeModal('singleClassModal');
    }
  });
}
function switchView(view) {
  const calendarView = document.getElementById('calendarView');
  const listView = document.getElementById('listView');
  if (view === 'calendar') {
    calendarView.style.display = 'block';
    listView.style.display = 'none';
    document.getElementById('tabCalendar').classList.add('active');
    document.getElementById('tabList').classList.remove('active');
    renderCalendarGrid();
    ensureCalendarCartContainer();
  } else {
    calendarView.style.display = 'none';
    listView.style.display = 'block';
    document.getElementById('tabList').classList.add('active');
    document.getElementById('tabCalendar').classList.remove('active');
    renderListView();
  }
}
function previousMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendarGrid();
}
function nextMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendarGrid();
}

// ========== HELPERS TO CREATE CALENDAR CART AREA ==========
function ensureCalendarCartContainer() {
  const calendarView = document.getElementById('calendarView');
  if (!calendarView) return;
  if (document.getElementById('enrollmentCartCalendar')) return;

  // create a container similar to your list view cart
  const container = document.createElement('div');
  container.id = 'enrollmentCartCalendar';
  container.className = 'enrollment-cart-calendar';
  container.innerHTML = `
    <div class="cart-header">
      <h4>Enrollment Cart</h4>
    </div>
    <div id="cartContentCalendar" class="cart-content">
      <p>No temporary selections. Add from calendar or list.</p>
    </div>
    <div class="cart-actions" style="text-align:right; margin-top:8px;">
      <button id="confirmCartBtnCalendar" class="btn btn-primary">Confirm All Enrollments</button>
    </div>
  `;
  calendarView.appendChild(container);

  // wire confirm button
  const confirmBtnCalendar = document.getElementById('confirmCartBtnCalendar');
  if (confirmBtnCalendar) {
    confirmBtnCalendar.addEventListener('click', confirmAllEnrollments);
  }
}

// ========== TIME SLOT FOR CLASS ==========
function generateTimeSlots(schedule) {
  const timeSlotRanges = [];
  if (typeof schedule === 'string') {
    const match = schedule.match(/(\d{1,2}:\d{2}\s?[AP]M)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M)/i);
    if (match) {
      timeSlotRanges.push(`${match[1]} - ${match[2]}`);
      return timeSlotRanges;
    }
    const matches = schedule.match(/\d{1,2}:\d{2}\s?[AP]M/g);
    if (matches) return matches;
  }
  if (schedule && typeof schedule === 'object') {
    if (Array.isArray(schedule.time_slots) && schedule.time_slots.length) {
      return schedule.time_slots.map(String);
    }
  }
  return ['03:00 PM - 04:00 PM'];
}
function updateCalendarTitle() {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[currentCalendarDate.getMonth()];
  const year = currentCalendarDate.getFullYear();
  const titleElement = document.getElementById('currentMonthDisplay');
  if (titleElement) {
    titleElement.textContent = `${monthName} ${year}`;
  }
}
