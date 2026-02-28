// ========================================
// Member Enrollment - Secure API + Idle + Session
// ========================================

const SERVER_URL = 'http://localhost:8080';
const API_URL = SERVER_URL;
const $ = (id) => document.getElementById(id);

const MEMBER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MEMBER_IDLE_WARNING_MS = 15 * 60 * 1000;        // 15 minutes

// Idle tracking (member only)
let memberLastActivity = Date.now();
let memberIdleWarningShown = false;

// Member-scoped storage keys
const MEMBER_KEYS = {
  token: 'member_token',
  authUser: 'member_authUser',
  role: 'member_role',
  logoutEvent: 'memberLogoutEvent',
};

// --------------------------------------
// Member storage helpers
// --------------------------------------
const MemberStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'member',
        token,
      };

      localStorage.setItem(MEMBER_KEYS.token, token);
      localStorage.setItem(MEMBER_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(MEMBER_KEYS.role, 'member');

      sessionStorage.setItem(MEMBER_KEYS.token, token);
      sessionStorage.setItem(MEMBER_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(MEMBER_KEYS.role, 'member');
    } catch (e) {
      console.error('[MemberStore.set] failed:', e);
    }
  },

  getToken() {
    return sessionStorage.getItem(MEMBER_KEYS.token) || localStorage.getItem(MEMBER_KEYS.token) || null;
  },

  getAuthUser() {
    const raw = sessionStorage.getItem(MEMBER_KEYS.authUser) || localStorage.getItem(MEMBER_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[MemberStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  getRole() {
    return sessionStorage.getItem(MEMBER_KEYS.role) || localStorage.getItem(MEMBER_KEYS.role) || null;
  },

  hasSession() {
    const token = localStorage.getItem(MEMBER_KEYS.token) || sessionStorage.getItem(MEMBER_KEYS.token);
    const role = localStorage.getItem(MEMBER_KEYS.role) || sessionStorage.getItem(MEMBER_KEYS.role);
    return !!token && role === 'member';
  },

  clear() {
    localStorage.removeItem(MEMBER_KEYS.token);
    localStorage.removeItem(MEMBER_KEYS.authUser);
    localStorage.removeItem(MEMBER_KEYS.role);

    sessionStorage.removeItem(MEMBER_KEYS.token);
    sessionStorage.removeItem(MEMBER_KEYS.authUser);
    sessionStorage.removeItem(MEMBER_KEYS.role);
  },
};

// --------------------------------------
// Bootstrap & Auth Check
// --------------------------------------
function bootstrapMemberFromGenericIfNeeded() {
  try {
    if (MemberStore.hasSession()) return;

    const genToken = localStorage.getItem('token') || sessionStorage.getItem('token');
    const genRole = localStorage.getItem('role') || sessionStorage.getItem('role');
    const genAuthRaw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'member' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    MemberStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapMemberFromGenericIfNeeded] failed:', e);
  }
}

function markMemberActivity() {
  memberLastActivity = Date.now();
  memberIdleWarningShown = false;
}

function quickLogout() {
  MemberStore.clear();
  localStorage.setItem(MEMBER_KEYS.logoutEvent, Date.now().toString());
  window.location.href = '../login.html';
}

function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch { return null; }
}

function memberIdFromAuth() {
  const a = getAuth();
  if (!a) return null;
  const u = a.user || a;
  return u.memberId || u.member_id || u._id || u.id || null;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toLocalDateString(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function getTodayDateString() {
  return toLocalDateString(new Date());
}

async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  bootstrapMemberFromGenericIfNeeded();
  const token = MemberStore.getToken();

  if (!token) {
    quickLogout();
    return;
  }

  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `${SERVER_URL}${endpoint}`
        : endpoint;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    quickLogout();
    return;
  }

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return await response.json();
}

// ========== MAIN GLOBALS ==========
let availableClasses = [];
let memberEnrollments = [];
let memberInfo = null;
let realRemainingSessions = 0;
let enrollCart = [];
let currentCalendarDate = new Date();
let tempRemainingSessions = 0;

function showToast(message, type = 'info') {
  alert(`${type.toUpperCase()}: ${message}`);
}

function showLoadingState(show = true) {
  const btn = $('confirmCartBtn');
  if (btn) btn.disabled = show;
}

// ========== DOM READY ==========
document.addEventListener('DOMContentLoaded', async () => {
  markMemberActivity();
  setSidebarMemberName();

  const token = MemberStore.getToken();
  if (!token) {
    quickLogout();
    return;
  }

  showLoadingState(true);
  await loadInitialData();
  setupEventListeners();
  initializeCalendarView();
  renderListView();
  switchView('calendar');
  
  const cartContainer = $('enrollmentCart');
  if (cartContainer) cartContainer.style.display = 'block';
  
  showLoadingState(false);
});

function setSidebarMemberName() {
  try {
    const authUser = MemberStore.getAuthUser() || getAuth();
    const user = authUser?.user || authUser;
    const displayName = user?.name || user?.username || "Member";
    const el = document.getElementById("sidebarMemberName");
    if (el) el.textContent = displayName;
  } catch (e) { console.error(e); }
}

async function loadInitialData() {
  try {
    const memberId = memberIdFromAuth();
    if (!memberId) throw new Error('No member ID in auth');

    const [memberData, classesData, enrollmentsData] = await Promise.all([
      apiFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`).catch(() => ({ success: false, data: null })),
      apiFetch(`${API_URL}/api/classes`).catch(() => ({ success: false, data: [] })),
      apiFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`).catch(() => ({ success: false, data: [] })),
    ]);

    memberInfo = memberData && memberData.success && memberData.data ? memberData.data : memberData || null;
    availableClasses = Array.isArray(classesData?.data) ? classesData.data : Array.isArray(classesData) ? classesData : [];
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : Array.isArray(enrollmentsData) ? enrollmentsData : [];

    updateSessionCounter(false, 0);
    renderCalendarGrid();
    renderListView();
    updateCartDisplay();
  } catch (err) {
    console.error('loadInitialData Error:', err);
    const c = $('calendarContainer');
    if (c) c.innerHTML = `<div class="error-state" style="padding: 2rem; text-align: center; color: #dc3545;">Failed to load data.</div>`;
  }
}

function getActiveCombative() {
    if (!memberInfo || !memberInfo.memberships) return null;
    return memberInfo.memberships
        .filter(m => m.type && m.type.toLowerCase() === 'combative' && (m.status || '').toLowerCase() === 'active')
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];
}

function updateSessionCounter(forceCart = false, tempOffset = 0) {
  const remainingSessionSpan = $('remainingSessions');
  const memInfoSpan = $('membershipInfo');

  const combative = getActiveCombative();

  if (!combative) {
    if (remainingSessionSpan) remainingSessionSpan.textContent = '0';
    if (memInfoSpan) memInfoSpan.textContent = 'No active combative membership';
    realRemainingSessions = 0;
    tempRemainingSessions = 0;
    return;
  }

  realRemainingSessions = Math.max(0, combative.remainingSessions || 0);

  if (forceCart && enrollCart.length > 0) {
    tempRemainingSessions = Math.max(0, realRemainingSessions - enrollCart.length + tempOffset);
    if (remainingSessionSpan) remainingSessionSpan.innerHTML = `${tempRemainingSessions} <small style="color:#999;">(projected)</small>`;
  } else {
    tempRemainingSessions = realRemainingSessions;
    if (remainingSessionSpan) remainingSessionSpan.textContent = realRemainingSessions;
  }

  let infoText = `Status: ${combative.status.toUpperCase()}`;
  if (combative.endDate) {
      infoText += ` | Valid until: ${new Date(combative.endDate).toLocaleDateString()}`;
  }
  if (memInfoSpan) memInfoSpan.textContent = infoText;

  const confirmBtn = $('confirmCartBtn');
  if (confirmBtn) {
    const canConfirm = enrollCart.length > 0 && realRemainingSessions >= enrollCart.length;
    confirmBtn.disabled = !canConfirm;
    confirmBtn.textContent = enrollCart.length > 0 ? `Confirm All (${enrollCart.length})` : 'Confirm All Enrollments';
  }
}

// ========== CALENDAR VIEW ==========
function initializeCalendarView() {
  renderCalendarGrid();
  updateCalendarTitle();
}

function renderCalendarGrid() {
  const container = $('calendarContainer');
  if (!container) return;
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  // Establish maximum allowed date based on membership expiry
  const combative = getActiveCombative();
  const expiryDateStr = combative && combative.endDate ? toLocalDateString(new Date(combative.endDate)) : null;

  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" id="prevMonth" aria-label="Previous month" title="Previous month">‹</button>
    <span id="currentMonthDisplay"></span>
    <button class="calendar-nav-btn" id="nextMonth" aria-label="Next month" title="Next month">›</button></div>
    <div class="calendar-grid">`;

  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  weekdays.forEach((day) => { html += `<div class="calendar-header-day">${day}</div>`; });

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDay = firstDay.getDay();
  let cellIndex = 0;

  for (let i = 0; i < startingDay; i++) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }

  const todayStr = getTodayDateString();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayClasses = getClassesForDate(dateStr);

    // Core Logic: Disable past dates AND dates beyond membership expiry
    const isPast = dateStr < todayStr;
    const isBeyondExpiry = !combative || (expiryDateStr && dateStr > expiryDateStr);
    const isDisabled = isPast || isBeyondExpiry;

    let classChips = '';
    if (dayClasses.length > 0 && !isDisabled) {
      classChips = dayClasses.slice(0, 2).map((cls) => `<div class="class-chip">${escapeHtml(cls.class_name || 'Class')}</div>`).join('');
      if (dayClasses.length > 2) classChips += `<div class="class-chip">+${dayClasses.length - 2} more</div>`;
    }

    html += `<div class="calendar-cell${isToday ? ' calendar-cell-today' : ''}${isDisabled ? ' past-date' : ''}${dayClasses.length > 0 && !isDisabled ? ' has-classes' : ''}" data-date="${dateStr}"${isDisabled ? ' style="pointer-events: none; opacity: 0.5; cursor: not-allowed;"' : ''}>
      <div class="calendar-day-number">${day}</div>
      <div class="calendar-day-content"><div class="calendar-day-classes">${classChips}</div></div></div>`;
    cellIndex++;
  }

  while (cellIndex % 7 !== 0) {
    html += `<div class="calendar-cell calendar-cell-empty"><div class="calendar-day-number"></div><div class="calendar-day-content"></div></div>`;
    cellIndex++;
  }
  html += '</div>';
  container.innerHTML = html;
  updateCalendarTitle();
  
  const prev = $('prevMonth'); const next = $('nextMonth');
  if (prev) prev.addEventListener('click', previousMonth);
  if (next) next.addEventListener('click', nextMonth);
  
  document.removeEventListener('click', handleCalendarClick, true);
  document.addEventListener('click', handleCalendarClick, true);
}

function handleCalendarClick(event) {
  const cell = event.target.closest('.calendar-cell');
  if (!cell || cell.classList.contains('calendar-cell-empty') || cell.classList.contains('past-date')) return;
  
  const dateStr = cell.getAttribute('data-date');
  if (!dateStr) return;
  markMemberActivity();

  if (cell.classList.contains('has-classes')) {
    const classes = getClassesForDate(dateStr);
    showDayModal(dateStr, classes); // Uses original logic: shows classes exactly on this day
  }
}

function getClassesForDate(dateStr) {
  const date = new Date(dateStr);
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  return availableClasses.filter((cls) => {
    const schedule = (cls.schedule || '').toLowerCase();
    if (schedule.includes(dayName)) return true;
    const dayAbbr = dayName.substring(0, 3);
    if (schedule.includes(dayAbbr)) return true;
    return false;
  });
}

// **RESTORED: Simple Day Modal for Calendar View**
function showDayModal(dateStr, classes) {
  markMemberActivity();
  const date = new Date(dateStr);
  const formattedDate = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let modalContent = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3 style="margin:0; font-size:1.4rem;">Classes for ${formattedDate}</h3>
      </div>
      <div class="day-modal-content">
  `;

  if (classes.length === 0) {
    modalContent += '<div class="no-classes" style="text-align:center; color:#ccc; padding: 2rem;">No classes scheduled for this date</div>';
  } else {
    classes.forEach((cls) => {
      const classId = cls.class_id || cls._id;
      const className = cls.class_name || 'Unnamed Class';
      const trainer = cls.trainer_name || cls.trainer_id || 'TBD';
      const schedule = cls.schedule || 'Schedule TBD';
      
      modalContent += `
        <div class="class-selection">
         <div class="class-info">
           <div style="font-size:1.2rem; font-weight:600; color:#fff; margin-bottom:0.4rem;">${escapeHtml(className)}</div>
           <div style="color:#aaa; font-size:0.9rem; margin-bottom:0.2rem;"><strong>Trainer:</strong> ${escapeHtml(trainer)}</div>
           <div style="color:#aaa; font-size:0.9rem;"><strong>Schedule:</strong> ${escapeHtml(schedule)}</div>
         </div>
         <div class="class-times">
           <button class="btn btn-primary select-time-btn" data-class="${classId}">
             Select Time
           </button>
         </div>
        </div>
      `;
    });
  }

  modalContent += `
        </div>
        <div class="day-modal-footer">
         <button class="btn btn-secondary" onclick="closeModal('dayModal')">Close</button>
        </div>
      </div>
  `;

  let modal = document.getElementById('dayModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dayModal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `<div class="modal-overlay"><div class="modal-container">${modalContent}</div></div>`;
  modal.style.display = 'flex';

  const timeBtns = modal.querySelectorAll('.select-time-btn');
  timeBtns.forEach((btn) => {
    btn.addEventListener('click', function () {
      closeModal('dayModal');
      showTimeSelectionModal(this.dataset.class, dateStr);
    });
  });
}

// **RESTORED: Simple Time Selection Modal for Calendar View**
function showTimeSelectionModal(classId, dateStr) {
  markMemberActivity();
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
  if (!cls) return;
  const timeSlots = generateTimeSlots(cls.schedule);
  const className = cls.class_name || 'Unnamed Class';

  let modalContent = `
    <div class="time-modal">
      <div class="time-modal-header">
        <h3 style="margin:0;">Select Time for ${escapeHtml(className)}</h3>
        <div style="font-size:0.9rem; margin-top:0.5rem; opacity:0.9;">Date: ${new Date(dateStr).toLocaleDateString()}</div>
      </div>
      <div class="time-modal-content">
  `;

  timeSlots.forEach((timeSlot) => {
    const isEnrolled = memberEnrollments.some(e => {
        const enDate = new Date(e.session_date);
        return e.class_id === classId && toLocalDateString(enDate) === dateStr && e.session_time === timeSlot && e.status !== 'cancelled';
    });
    const inCart = enrollCart.some(item => item.classId === classId && item.date === dateStr && item.time === timeSlot);

    modalContent += `
      <div class="time-slot-item ${isEnrolled || inCart ? 'disabled' : ''}" 
           data-class="${classId}" data-date="${dateStr}" data-time="${timeSlot}">
        <div class="time-slot-label" style="font-size:1.1rem; color:#fff;">${timeSlot}</div>
        <button class="btn ${isEnrolled ? 'btn-secondary' : 'btn-primary'} select-enrollment-btn" ${isEnrolled || inCart ? 'disabled' : ''}>
          ${isEnrolled ? 'Already Enrolled' : (inCart ? 'In Cart' : 'Add to Cart')}
        </button>
      </div>
    `;
  });

  modalContent += `
      </div>
      <div class="time-modal-footer">
       <button class="btn btn-secondary" onclick="closeModal('timeModal')">Cancel</button>
      </div>
    </div>
  `;

  let modal = document.getElementById('timeModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'timeModal'; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="modal-overlay"><div class="modal-container">${modalContent}</div></div>`;
  modal.style.display = 'flex';

  const enrollBtns = modal.querySelectorAll('.select-enrollment-btn');
  enrollBtns.forEach((btn) => {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      const slotItem = this.closest('.time-slot-item');
      addToEnrollmentCart(slotItem.dataset.class, slotItem.dataset.date, slotItem.dataset.time, className);
      closeModal('timeModal');
    });
  });
}

// ========== LIST VIEW ==========
function renderListView() {
  const container = $('classesGrid');
  const searchInput = $('class_search');
  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!container || availableClasses.length === 0) {
    if (container) container.innerHTML = `<div class="no-classes" style="padding:2rem;text-align:center;color:#888;">No classes available</div>`;
    return;
  }

  let classesToRender = availableClasses;

  // Filter based on Search Bar logic
  if (searchTerm) {
      classesToRender = availableClasses.filter(cls => {
          const nameMatch = (cls.class_name || '').toLowerCase().includes(searchTerm);
          const trainerMatch = (cls.trainer_name || cls.trainer_id || '').toLowerCase().includes(searchTerm);
          const scheduleMatch = (cls.schedule || '').toLowerCase().includes(searchTerm);
          return nameMatch || trainerMatch || scheduleMatch;
      });
  }

  if (classesToRender.length === 0) {
      container.innerHTML = `<div class="no-classes" style="padding:2rem;text-align:center;color:#888;">No classes found matching your search.</div>`;
      return;
  }

  let html = '<div class="classes-grid-container">';
  classesToRender.forEach((cls) => {
    const classId = cls.class_id || cls._id;
    html += `<div class="class-card"><div class="class-card-content"><h3 class="class-title">${escapeHtml(cls.class_name)}</h3><div class="class-schedule">${escapeHtml(cls.schedule)}</div><div class="class-trainer">Trainer: ${escapeHtml(cls.trainer_name || cls.trainer_id)}</div><div class="class-description"><p>${escapeHtml(cls.description)}</p></div><button class="btn btn-primary class-enroll-btn" onclick="showListViewEnrollmentModal('${classId}')">Enroll Now</button></div></div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// **COMBINED MODAL: Retained exclusively for the List View**
function showListViewEnrollmentModal(classId) {
  markMemberActivity();
  const cls = availableClasses.find(c => c.class_id === classId || c._id === classId);
  if (!cls) return;
  const validDates = getValidDatesForClass(cls);
  const timeSlots = generateTimeSlots(cls.schedule);
  const className = cls.class_name || 'Unnamed Class';

  let modalContent = `
    <div class="single-class-modal">
      <div class="day-modal-header">
        <h2 style="margin:0;">Enroll: ${escapeHtml(className)}</h2>
        <div style="font-size:0.9rem; margin-top:0.5rem; opacity:0.9;">${escapeHtml(cls.schedule)}</div>
      </div>
      <div class="modal-body unified-modal-body" style="padding: 2.5rem 2rem;">
        <div class="unified-modal-flex" style="display:flex; flex-direction:column; gap:2rem;">
  `;

  if (validDates.length === 0) {
      modalContent += `<div class="error-state" style="padding:1.5rem; background:rgba(220,53,69,0.1); border:1px solid #dc3545; border-radius:8px; color:#ff6b6b; text-align:center;">No available future dates for this class schedule within your membership window.</div>`;
  } else {
      modalContent += `
          <div class="date-selection-unified">
            <label for="enrollDateSelect" style="display:block; margin-bottom:1rem; font-weight:bold; color:#ccc; font-size:1.1rem;">1. Select Available Date:</label>
            <select id="enrollDateSelect" class="unified-date-select" style="width:100%; padding:0.8rem 1rem; border-radius:6px; border:1px solid #444; background:#121212; color:#fff; font-size:1rem; cursor:pointer;">
              ${validDates.map(d => {
                  const dObj = new Date(d);
                  const display = dObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
                  return `<option value="${d}">${display}</option>`;
              }).join('')}
            </select>
          </div>
          
          <div class="time-slots-container">
            <label style="display:block; margin-bottom:1rem; font-weight:bold; color:#ccc; font-size:1.1rem;">2. Select Time Slot:</label>
            <div class="time-slots" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1.2rem;">
      `;
      timeSlots.forEach((timeSlot) => {
        modalContent += `<button class="time-slot-btn" data-class="${classId}" data-class-name="${escapeHtml(className)}" data-date="${validDates[0]}" data-time="${timeSlot}" style="padding: 1rem; border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(0,0,0,0.4); color: #fff; cursor: pointer; border-radius: 6px; font-weight: 600; text-align: center; transition: all 0.2s; font-size: 1rem; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">${timeSlot}</button>`;
      });
      modalContent += `</div></div>`;
  }

  modalContent += `
        </div>
      </div>
      <div class="day-modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('listViewEnrollmentModal')">Cancel</button>
      </div>
    </div>
  `;

  let modal = document.getElementById('listViewEnrollmentModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'listViewEnrollmentModal'; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="modal-overlay"><div class="modal-container">${modalContent}</div></div>`;
  modal.style.display = 'flex';

  const dateSelect = document.getElementById('enrollDateSelect');
  const timeSlotBtns = modal.querySelectorAll('.time-slot-btn');

  const updateButtonStates = (selectedDate) => {
      timeSlotBtns.forEach(btn => {
          btn.dataset.date = selectedDate;
          const isEnrolled = memberEnrollments.some(e => {
            const enDate = new Date(e.session_date);
            return e.class_id === classId && toLocalDateString(enDate) === selectedDate && e.session_time === btn.dataset.time && e.status !== 'cancelled';
          });
          const inCart = enrollCart.some(item => item.classId === classId && item.date === selectedDate && item.time === btn.dataset.time);
          if (isEnrolled || inCart) {
              btn.disabled = true; 
              btn.style.opacity = '0.5';
              btn.style.cursor = 'not-allowed';
              btn.style.background = '#111';
              btn.style.borderColor = '#333';
              btn.style.color = '#888';
              btn.textContent = isEnrolled ? 'Enrolled' : 'In Cart';
          } else {
              btn.disabled = false; 
              btn.style.opacity = '1';
              btn.style.cursor = 'pointer';
              btn.style.background = 'rgba(0,0,0,0.4)';
              btn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              btn.style.color = '#fff';
              btn.textContent = btn.dataset.time; 
          }
      });
  };

  if (dateSelect) {
    dateSelect.addEventListener('change', function() { updateButtonStates(this.value); });
    updateButtonStates(validDates[0]); 
  }

  timeSlotBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
      if (this.disabled) return; e.preventDefault(); markMemberActivity();
      addToEnrollmentCart(this.dataset.class, this.dataset.date, this.dataset.time, this.dataset.className);
      closeModal('listViewEnrollmentModal');
    });
  });
}

function getValidDatesForClass(cls) {
    const validDates = []; const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const combative = getActiveCombative();
    if (!combative) return [];

    let maxDate = new Date(todayDateOnly);
    maxDate.setMonth(maxDate.getMonth() + 1); 
    if (combative.endDate) {
        maxDate = new Date(combative.endDate);
    }

    const scheduleStr = (cls.schedule || '').toLowerCase();
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const classDays = daysOfWeek.filter(day => scheduleStr.includes(day) || scheduleStr.includes(day.substring(0,3)));

    if (classDays.length > 0) {
        let currDate = new Date(todayDateOnly);
        while (currDate <= maxDate) {
            const dayName = daysOfWeek[currDate.getDay()];
            if (classDays.includes(dayName)) { validDates.push(toLocalDateString(currDate)); }
            currDate.setDate(currDate.getDate() + 1);
        }
    }
    return validDates;
}

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
  return ['03:00 PM - 04:00 PM'];
}

// ========== CART PROCESSING ==========
function addToEnrollmentCart(classId, dateStr, timeSlot, className) {
  markMemberActivity();
  const existing = enrollCart.find(item => item.classId === classId && item.date === dateStr && item.time === timeSlot);
  if (existing) { showToast('Already added to cart for this date and time', 'warning'); return; }

  enrollCart.push({ classId, className, date: dateStr, time: timeSlot });
  updateCartDisplay();
  showToast('Added to cart!', 'success');
}

function updateCartDisplay() {
  const cartContainer = $('enrollmentCart');
  const cartContent = $('cartContent');
  const confirmBtn = $('confirmCartBtn');
  if (cartContainer) cartContainer.style.display = 'block';

  if (enrollCart.length === 0) {
    if (cartContent) cartContent.innerHTML = '<p style="color:#aaa;">No temporary selections. Add from calendar or list.</p>';
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Confirm All Enrollments'; }
    updateSessionCounter(false, 0); return;
  }

  let html = '';
  enrollCart.forEach((item, index) => {
    const dateObj = new Date(item.date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    html += `<div class="cart-item"><div class="cart-item-info"><strong>${escapeHtml(item.className)}</strong><br><small>${dayOfWeek}, ${formattedDate} at ${escapeHtml(item.time)}</small></div><button type="button" class="cart-item-remove" onclick="removeFromCart(${index})" title="Remove">✕</button></div>`;
  });
  if (cartContent) cartContent.innerHTML = html;
  updateSessionCounter(true, 0);
  if (confirmBtn) { confirmBtn.disabled = tempRemainingSessions < enrollCart.length; confirmBtn.textContent = `Confirm All (${enrollCart.length})`; }
}

async function confirmAllEnrollments() {
  markMemberActivity();
  if (!enrollCart || enrollCart.length === 0) return;
  showLoadingState(true);
  try {
    const memberId = memberIdFromAuth();
    if (!memberId) throw new Error('Not authenticated');
    const totalItems = enrollCart.length;
    if (realRemainingSessions < totalItems) { showToast('Not enough sessions remaining', 'error'); return; }

    let successful = 0;
    for (const item of enrollCart) {
      const body = { class_id: item.classId, member_id: memberId, session_date: item.date, session_time: item.time, member_name: memberInfo?.name || 'Unknown' };
      const res = await apiFetch(`${API_URL}/api/enrollments`, { method: 'POST', body: JSON.stringify(body) });
      if (res.success) successful++;
    }

    if (successful > 0) {
      showToast(`${successful}/${totalItems} enrollments successful!`, 'success');
      enrollCart = []; updateCartDisplay(); await loadInitialData();
    } else { showToast('Enrollment failed', 'error'); }
  } catch (error) { console.error(error); showToast('Bulk enrollment failed', 'error');
  } finally { showLoadingState(false); }
}

function removeFromCart(index) {
  if (index < 0 || index >= enrollCart.length) return;
  enrollCart.splice(index, 1);
  updateCartDisplay();
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

function setupEventListeners() {
  const calendarTab = $('tabCalendar'); const listTab = $('tabList'); const confirmBtn = $('confirmCartBtn');
  const classSearch = $('class_search'); // ADDED Search Listener

  if (calendarTab) { calendarTab.addEventListener('click', () => { markMemberActivity(); switchView('calendar'); }); }
  if (listTab) { listTab.addEventListener('click', () => { markMemberActivity(); switchView('list'); }); }
  if (confirmBtn) { confirmBtn.addEventListener('click', confirmAllEnrollments); }
  
  if (classSearch) {
      classSearch.addEventListener('input', () => {
          markMemberActivity();
          renderListView();
      });
  }

  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) { closeModal('dayModal'); closeModal('timeModal'); closeModal('listViewEnrollmentModal'); }
  });
}

function switchView(view) {
  const calendarView = $('calendarView'); const listView = $('listView'); const tabCalendar = $('tabCalendar'); const tabList = $('tabList');
  if (view === 'calendar') {
    if (calendarView) calendarView.style.display = 'block'; if (listView) listView.style.display = 'none';
    if (tabCalendar) tabCalendar.classList.add('active'); if (tabList) tabList.classList.remove('active');
    renderCalendarGrid();
  } else {
    if (calendarView) calendarView.style.display = 'none'; if (listView) listView.style.display = 'block';
    if (tabList) tabList.classList.add('active'); if (tabCalendar) tabCalendar.classList.remove('active');
    renderListView();
  }
  markMemberActivity();
}

function previousMonth() { currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1); renderCalendarGrid(); markMemberActivity(); }
function nextMonth() { currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1); renderCalendarGrid(); markMemberActivity(); }

function updateCalendarTitle() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = monthNames[currentCalendarDate.getMonth()]; const year = currentCalendarDate.getFullYear();
  const titleElement = $('currentMonthDisplay'); if (titleElement) titleElement.textContent = `${monthName} ${year}`;
}