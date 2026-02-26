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

// Member-scoped storage keys (avoid admin/trainer interference)
const MEMBER_KEYS = {
  token: 'member_token',
  authUser: 'member_authUser',
  role: 'member_role',
  logoutEvent: 'memberLogoutEvent',
};

// --------------------------------------
// Member storage helpers (namespaced)
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
    return (
      sessionStorage.getItem(MEMBER_KEYS.token) ||
      localStorage.getItem(MEMBER_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(MEMBER_KEYS.authUser) ||
      localStorage.getItem(MEMBER_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[MemberStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  getRole() {
    return (
      sessionStorage.getItem(MEMBER_KEYS.role) ||
      localStorage.getItem(MEMBER_KEYS.role) ||
      null
    );
  },

  hasSession() {
    const token =
      localStorage.getItem(MEMBER_KEYS.token) ||
      sessionStorage.getItem(MEMBER_KEYS.token);
    const authUser =
      localStorage.getItem(MEMBER_KEYS.authUser) ||
      sessionStorage.getItem(MEMBER_KEYS.authUser);
    const role =
      localStorage.getItem(MEMBER_KEYS.role) ||
      sessionStorage.getItem(MEMBER_KEYS.role);
    return !!token && !!authUser && role === 'member';
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
// Backward‑compatible bootstrap
// --------------------------------------
function bootstrapMemberFromGenericIfNeeded() {
  try {
    if (MemberStore.hasSession()) return;

    const genToken =
      localStorage.getItem('token') || sessionStorage.getItem('token');
    const genRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');
    const genAuthRaw =
      localStorage.getItem('authUser') || sessionStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'member' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    MemberStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapMemberFromGenericIfNeeded] failed:', e);
  }
}

// --------------------------------------
// Idle helpers
// --------------------------------------
function markMemberActivity() {
  memberLastActivity = Date.now();
  memberIdleWarningShown = false;
}

function showMemberIdleBanner() {
  let banner = document.getElementById('memberIdleBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'memberIdleBanner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      background: linear-gradient(135deg, #111, #333);
      color: #f5f5f5;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      font-size: 0.95rem;
    `;

    const textSpan = document.createElement('span');
    textSpan.textContent =
      "You've been idle for 15 minutes. Stay logged in or logout?";

    const stayBtn = document.createElement('button');
    stayBtn.textContent = 'Stay Logged In';
    stayBtn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: #28a745;
      color: #fff;
      font-weight: 600;
    `;

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Logout';
    logoutBtn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: #dc3545;
      color: #fff;
      font-weight: 600;
    `;

    stayBtn.addEventListener('click', () => {
      const token = MemberStore.getToken();
      const authUser = MemberStore.getAuthUser();
      if (token && authUser) {
        authUser.timestamp = Date.now();
        MemberStore.set(token, authUser);
      }
      markMemberActivity();
      memberIdleWarningShown = true;
      hideMemberIdleBanner();
      showToast('You are still logged in.', 'info');
    });

    logoutBtn.addEventListener('click', () => {
      memberLogout('user chose logout after idle warning (enrollment)');
    });

    banner.appendChild(textSpan);
    banner.appendChild(stayBtn);
    banner.appendChild(logoutBtn);
    document.body.appendChild(banner);
  } else {
    banner.style.display = 'flex';
  }
}

function hideMemberIdleBanner() {
  const banner = document.getElementById('memberIdleBanner');
  if (banner) banner.style.display = 'none';
}

function setupMemberIdleWatcher() {
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markMemberActivity, { passive: true });
  });

  setInterval(() => {
    bootstrapMemberFromGenericIfNeeded();

    const token = MemberStore.getToken();
    const role = MemberStore.getRole();
    const authUser = MemberStore.getAuthUser();

    if (!token || !authUser || role !== 'member') return;

    try {
      const ts = authUser.timestamp || 0;
      if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
        console.log('Member session exceeded 2 hours (manage-member-enrollment).');
        memberLogout('session max age exceeded in enrollment idle watcher');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in idle watcher:', e);
      memberLogout('invalid authUser JSON in enrollment idle watcher');
      return;
    }

    const idleFor = Date.now() - memberLastActivity;
    if (!memberIdleWarningShown && idleFor >= MEMBER_IDLE_WARNING_MS) {
      memberIdleWarningShown = true;
      showMemberIdleBanner();
    }
  }, 30000);
}

// --------------------------------------
// Centralized logout
// --------------------------------------
function memberLogout(reason) {
  console.log('[Logout] Member logout (enrollment):', reason || 'no reason');
  MemberStore.clear();

  try {
    const genericRole = localStorage.getItem('role') || sessionStorage.getItem('role');
    if (genericRole === 'member') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[memberLogout] failed to clear generic member keys:', e);
  }

  localStorage.setItem(MEMBER_KEYS.logoutEvent, Date.now().toString());
  window.location.href = '../login.html';
}

function quickLogout() {
  memberLogout('quickLogout');
}

window.addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEYS.logoutEvent) {
    MemberStore.clear();
    window.location.href = '../login.html';
  }
});

// ========================================
// Utility for authenticated API calls
// ========================================
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const role = MemberStore.getRole();
  const authUser = MemberStore.getAuthUser();

  if (!token || !authUser || role !== 'member') {
    memberLogout('missing member session in enrollment apiFetch');
    return;
  }

  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      memberLogout('session max age exceeded in enrollment apiFetch');
      return;
    }
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    memberLogout('invalid authUser JSON in enrollment apiFetch');
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      memberLogout('401/403 from enrollment apiFetch');
      return;
    }

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error(`API timeout after ${timeoutMs}ms`);
    throw error;
  }
}

// ✅ INITIAL AUTH CHECK
(function checkAuth() {
  bootstrapMemberFromGenericIfNeeded();
  const authUser = MemberStore.getAuthUser();
  const token = MemberStore.getToken();
  const role = MemberStore.getRole();

  if (!authUser || !token || role !== 'member' || Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS) {
    memberLogout('failed auth in member-enrollment checkAuth');
    return;
  }
})();

// ========== UTILS ==========
function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
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

// ========== MAIN GLOBALS ==========
let availableClasses = [];
let memberEnrollments = [];
let memberInfo = null;
let realRemainingSessions = 0;
let enrollCart = [];
let currentCalendarDate = new Date();
let tempRemainingSessions = 0;

// ========== API FETCH ==========
async function timedFetch(url, name) {
  const res = await apiFetch(url);
  return res;
}

// ========== TOAST HELPER ==========
function showToast(message, type = 'info') {
  alert(`${type.toUpperCase()}: ${message}`);
}

function showLoadingState(show = true) {
  const btn = $('confirmCartBtn');
  if (btn) btn.disabled = show;
}

// ========== DOM READY ==========
document.addEventListener('DOMContentLoaded', async () => {
  setupMemberIdleWatcher();
  markMemberActivity();
  setSidebarMemberName();

  const auth = getAuth();
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!auth || Date.now() - (auth.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS || !token || role !== 'member') {
    quickLogout();
    return;
  }

  showLoadingState(true);
  await loadInitialData();
  setupEventListeners();
  initializeCalendarView();
  renderListView();
  switchView('calendar');
  ensureCartVisible();
  showLoadingState(false);
});

function setSidebarMemberName() {
  try {
    if (typeof bootstrapMemberFromGenericIfNeeded === "function") bootstrapMemberFromGenericIfNeeded();

    const auth = (typeof MemberStore !== "undefined" && MemberStore.getAuthUser && MemberStore.getAuthUser()) ||
      (() => {
        try {
          const raw = sessionStorage.getItem("memberauthUser") || localStorage.getItem("memberauthUser") ||
                      sessionStorage.getItem("authUser") || localStorage.getItem("authUser");
          return raw ? JSON.parse(raw) : null;
        } catch { return null; }
      })();

    const user = auth?.user || auth;
    const displayName = user?.name || user?.username || auth?.name || auth?.username || "Member";

    const el = document.getElementById("sidebarMemberName");
    if (el) el.textContent = displayName;
  } catch (e) {
    console.error("Failed to set sidebar member name:", e);
  }
}

// ========== DATA LOAD & SESSION CALC ==========
async function loadInitialData() {
  try {
    const memberId = memberIdFromAuth();
    if (!memberId) throw new Error('No member ID in auth');

    const memberPromise = timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Member API');
    const classesPromise = timedFetch(`${API_URL}/api/classes`, 'Classes API');
    const enrollmentsPromise = timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Enrollments API');

    const [memberData, classesData, enrollmentsData] = await Promise.all([
      memberPromise.catch(() => ({ success: false, data: null })),
      classesPromise.catch(() => ({ success: false, data: [] })),
      enrollmentsPromise.catch(() => ({ success: false, data: [] })),
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
    showErrorState('Failed to load data. Check console and backend.');
  }
}

function ensureCartVisible() {
  const cartContainer = $('enrollmentCart');
  if (cartContainer) cartContainer.style.display = 'block';
}

function showErrorState(msg = 'Failed to load classes.') {
  const c = $('calendarContainer');
  if (c) c.innerHTML = `<div class="error-state" style="padding: 2rem; text-align: center; color: #dc3545;">${msg}</div>`;
}

// ========== SESSION LOGIC ==========
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
    if (remainingSessionSpan) remainingSessionSpan.innerHTML = `${tempRemainingSessions} <small style="color:#999;">(projected)</small>`;
    let infoText = `Combative (${combative.status}) | Real: ${realRemainingSessions}`;
    if (totalSessionsPerMonth) infoText += ` (total: ${totalSessionsPerMonth}/month)`;
    if (memInfoSpan) memInfoSpan.innerHTML = infoText;
  } else {
    tempRemainingSessions = realRemainingSessions;
    if (remainingSessionSpan) remainingSessionSpan.textContent = realRemainingSessions;
    let infoText = `Combative (${combative.status}) | Remaining: ${realRemainingSessions}`;
    if (totalSessionsPerMonth) infoText += ` (allocated: ${totalSessionsPerMonth}/month)`;
    if (memInfoSpan) memInfoSpan.textContent = infoText;
  }

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
  renderCalendarNavigation();
  updateCalendarTitle();
}

function renderCalendarGrid() {
  const container = $('calendarContainer');
  if (!container) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" id="prevMonth" aria-label="Previous month" title="Previous month">‹</button>
    <span id="currentMonthDisplay"></span>
    <button class="calendar-nav-btn" id="nextMonth" aria-label="Next month" title="Next month">›</button></div>
    <div class="calendar-grid">`;

  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  weekdays.forEach((day) => {
    html += `<div class="calendar-header-day">${day}</div>`;
  });

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
    const todayStr = getTodayDateString();
    const isToday = dateStr === todayStr;
    const isPast = dateStr < todayStr;
    const dayClasses = getClassesForDate(dateStr);

    let classChips = '';
    if (dayClasses.length > 0) {
      classChips = dayClasses.slice(0, 2).map((cls) => `<div class="class-chip">${escapeHtml(cls.class_name || 'Class')}</div>`).join('');
      if (dayClasses.length > 2) classChips += `<div class="class-chip">+${dayClasses.length - 2} more</div>`;
    }

    html += `<div class="calendar-cell${isToday ? ' calendar-cell-today' : ''}${isPast ? ' past-date' : ''}${dayClasses.length > 0 ? ' has-classes' : ''}" data-date="${dateStr}"${isPast ? ' style="pointer-events: none; opacity: 0.5; cursor: not-allowed;"' : ''}>
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
  renderCalendarNavigation();

  document.removeEventListener('click', handleCalendarClick, true);
  document.addEventListener('click', handleCalendarClick, true);
}

function renderCalendarNavigation() {
  const prev = $('prevMonth');
  const next = $('nextMonth');
  if (prev) {
    prev.removeEventListener('click', previousMonth);
    prev.addEventListener('click', previousMonth);
  }
  if (next) {
    next.removeEventListener('click', nextMonth);
    next.addEventListener('click', nextMonth);
  }
}

function handleCalendarClick(event) {
  const cell = event.target.closest('.calendar-cell');
  if (!cell || cell.classList.contains('calendar-cell-empty')) return;

  const dateStr = cell.getAttribute('data-date');
  if (!dateStr) return;

  markMemberActivity();

  const todayStr = getTodayDateString();
  if (dateStr < todayStr) {
    showToast('Cannot select past dates', 'error');
    return;
  }

  if (cell.classList.contains('has-classes')) {
    const classes = getClassesForDate(dateStr);
    showDayModal(dateStr, classes);
  }
}

function getClassesForDate(dateStr) {
  const date = new Date(dateStr);
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  const matchingClasses = availableClasses.filter((cls) => {
    const schedule = (cls.schedule || '').toLowerCase();
    if (schedule.includes(dayName)) return true;
    const dayAbbr = dayName.substring(0, 3);
    if (schedule.includes(dayAbbr)) return true;
    return false;
  });

  return matchingClasses;
}

// **UPDATED: Redesigned Day Modal**
function showDayModal(dateStr, classes) {
  markMemberActivity();

  const date = new Date(dateStr);
  const formattedDate = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let modalContent = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3 style="margin:0; font-size:1.4rem;">Classes for ${formattedDate}</h3>
        <div style="font-size:0.9rem; margin-top:0.5rem; opacity:0.9;">
           Sessions remaining: <strong style="color: #fff; font-size:1.1rem;">${tempRemainingSessions}</strong>
        </div>
      </div>
      <div class="day-modal-content">
  `;

  if (classes.length === 0) {
    modalContent += '<div class="no-classes" style="text-align:center; color:#ccc;">No classes scheduled for this date</div>';
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
           <button class="btn btn-primary select-time-btn" data-class="${classId}" data-class-name="${escapeHtml(className)}">
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

  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-container">
        ${modalContent}
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  const timeBtns = modal.querySelectorAll('.select-time-btn');
  timeBtns.forEach((btn) => {
    btn.addEventListener('click', function () {
      const classId = this.dataset.class;
      // Close the day modal before opening the unified enrollment modal
      closeModal('dayModal');
      // Open the unified date/time selection modal, pre-selected to the calendar date
      showClassForEnrollment(classId, dateStr);
    });
  });
}

// ========== CLASS SCHEDULING PARSER ==========
function parseTimeStrToMinutes(timeStr) {
    const [time, period] = timeStr.trim().split(/\s+/);
    if (!time || !period) return 24 * 60; 
    let [hours, minutes] = time.split(':').map(Number);
    if (period.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
}

function getValidDatesForClass(cls) {
    const validDates = [];
    const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    let memberships = memberInfo?.memberships || [];
    const combative = memberships.filter(m => m.type === 'combative' && m.status === 'active')
                                 .sort((a,b) => new Date(b.startDate) - new Date(a.startDate))[0];

    // Establish boundaries based on membership
    let maxDate = new Date(todayDateOnly);
    maxDate.setMonth(maxDate.getMonth() + 1); 

    let minDate = new Date(todayDateOnly);

    if (combative) {
        if (combative.endDate) {
            maxDate = new Date(combative.endDate);
        }
        if (combative.startDate) {
            const start = new Date(combative.startDate);
            start.setHours(0,0,0,0);
            if (start > minDate) minDate = new Date(start);
        }
    }

    const scheduleStr = (cls.schedule || '').toLowerCase();
    const isOneTime = scheduleStr.includes('one-time');

    let classStartTimeMinutes = 24 * 60; 
    const timeMatch = cls.schedule.match(/(\d{1,2}:\d{2}\s?[AP]M)/i);
    if (timeMatch) {
        classStartTimeMinutes = parseTimeStrToMinutes(timeMatch[1]);
    }

    if (isOneTime) {
        const dateMatch = cls.schedule.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
            const classDate = new Date(dateMatch[0]);
            classDate.setHours(0,0,0,0);
            if (classDate >= minDate && classDate <= maxDate) {
                if (classDate.getTime() === todayDateOnly.getTime()) {
                    const nowMinutes = today.getHours() * 60 + today.getMinutes();
                    if (nowMinutes < classStartTimeMinutes) validDates.push(dateMatch[0]);
                } else {
                    validDates.push(dateMatch[0]);
                }
            }
        }
    } else {
        const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const classDays = daysOfWeek.filter(day => scheduleStr.includes(day) || scheduleStr.includes(day.substring(0,3)));

        if (classDays.length > 0) {
            let currDate = new Date(minDate);
            while (currDate <= maxDate) {
                const dayName = daysOfWeek[currDate.getDay()];
                if (classDays.includes(dayName)) {
                    const dateStr = toLocalDateString(currDate);

                    if (currDate.getTime() === todayDateOnly.getTime()) {
                        const nowMinutes = today.getHours() * 60 + today.getMinutes();
                        if (nowMinutes < classStartTimeMinutes) validDates.push(dateStr);
                    } else {
                        validDates.push(dateStr);
                    }
                }
                currDate.setDate(currDate.getDate() + 1);
            }
        }
    }
    return validDates;
}

// **UPDATED: Unified Modal for both List and Calendar View**
function showClassForEnrollment(classId, preselectedDateStr = null) {
  markMemberActivity();

  const cls = availableClasses.find((c) => c.class_id === classId || c._id === classId);
  if (!cls) return;

  const timeSlots = generateTimeSlots(cls.schedule);
  const className = cls.class_name || 'Unnamed Class';
  const validDates = getValidDatesForClass(cls);

  let initialDate = validDates.length > 0 ? validDates[0] : null;
  if (preselectedDateStr && validDates.includes(preselectedDateStr)) {
      initialDate = preselectedDateStr;
  }

  let modalContent = `
    <div class="single-class-modal">
      <div class="day-modal-header">
        <h2 style="margin:0;">${escapeHtml(className)}</h2>
        <div style="font-size:0.95rem; margin-top:0.5rem; opacity:0.9;">
          <p style="margin:0.2rem 0;"><strong>Trainer:</strong> ${escapeHtml(cls.trainer_name || cls.trainer_id || 'TBD')}</p>
          <p style="margin:0.2rem 0;"><strong>Schedule:</strong> ${escapeHtml(cls.schedule || 'Schedule TBD')}</p>
        </div>
      </div>
      <div class="day-modal-content">
        <div class="time-selection">
          <h4 style="margin-top:0; color:#fff; font-size:1.2rem; border-bottom:1px solid #333; padding-bottom:0.5rem; margin-bottom:1.5rem;">Select Date and Time</h4>
  `;

  if (validDates.length === 0) {
      modalContent += `<div class="error-state" style="padding:1.5rem; background:rgba(220,53,69,0.1); border:1px solid #dc3545; border-radius:8px; color:#ff6b6b; text-align:center;">No upcoming dates align with this schedule within your active membership period.</div>`;
  } else {
      modalContent += `
          <div style="margin-bottom: 1.5rem;">
            <label for="enrollDateSelect" style="display:block; margin-bottom:0.5rem; font-weight:bold; color:#ccc;">Available Date:</label>
            <select id="enrollDateSelect" style="width:100%; padding:0.8rem 1rem; border-radius:6px; border:1px solid #444; background:#121212; color:#fff; font-size:1rem; cursor:pointer;">
              ${validDates.map(d => {
                  const dObj = new Date(d);
                  const display = dObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
                  const isSelected = d === initialDate ? 'selected' : '';
                  return `<option value="${d}" ${isSelected}>${display}</option>`;
              }).join('')}
            </select>
          </div>
          
          <div>
            <label style="display:block; margin-bottom:0.5rem; font-weight:bold; color:#ccc;">Select Time Slot:</label>
            <div class="time-slots" style="display:flex; flex-wrap:wrap; gap:0.8rem;">
      `;

      timeSlots.forEach((timeSlot) => {
        modalContent += `
          <button class="time-slot-btn" data-class="${classId}" data-class-name="${escapeHtml(className)}" 
                  data-date="${initialDate}" data-time="${timeSlot}"
                  style="padding: 0.8rem 1.5rem; border: 1px solid #444; background: #222; color: #fff; cursor: pointer; border-radius: 6px; font-weight: 600; flex:1; min-width:140px; transition:all 0.2s;">
            ${timeSlot}
          </button>
        `;
      });
      modalContent += `</div></div>`;
  }

  modalContent += `
        </div>
      </div>
      <div class="day-modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('singleClassModal')">Cancel</button>
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

  const dateSelect = document.getElementById('enrollDateSelect');
  const timeSlotBtns = modal.querySelectorAll('.time-slot-btn');

  // Helper to dynamically disable buttons based on actual enrollment state
  const updateButtonStates = (selectedDate) => {
      timeSlotBtns.forEach((btn) => {
          btn.dataset.date = selectedDate;
          const timeSlot = btn.dataset.time;

          const inCart = enrollCart.some(item => item.classId === classId && item.date === selectedDate && item.time === timeSlot);
          const isEnrolled = memberEnrollments.some((enrollment) => {
            const enDate = new Date(enrollment.sessiondate || enrollment.session_date);
            return (
              (enrollment.classid === classId || enrollment.class_id === classId) &&
              toLocalDateString(enDate) === selectedDate &&
              (enrollment.sessiontime === timeSlot || enrollment.session_time === timeSlot)
            );
          });

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
              btn.style.background = '#222';
              btn.style.borderColor = '#444';
              btn.style.color = '#fff';
              btn.textContent = timeSlot; // Reset text
          }
      });
  };

  // Bind change event to dropdown
  if (dateSelect) {
    dateSelect.addEventListener('change', function () {
      updateButtonStates(this.value);
    });
  }

  // Set initial state
  if (initialDate) {
      updateButtonStates(initialDate);
  }

  // Bind click event to valid buttons
  timeSlotBtns.forEach((btn) => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (this.disabled) return;
      markMemberActivity();

      // Visual feedback on click
      timeSlotBtns.forEach((b) => {
          if (!b.disabled) {
            b.style.background = '#222';
            b.style.borderColor = '#444';
            b.style.color = '#fff';
          }
      });
      this.style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--highlight) 100%)';
      this.style.borderColor = 'transparent';
      this.style.color = '#fff';

      const classIdVal = this.dataset.class;
      const classNameVal = this.dataset.className;
      const dateVal = this.dataset.date;
      const timeVal = this.dataset.time;

      addToEnrollmentCart(classIdVal, dateVal, timeVal, classNameVal);
      setTimeout(() => { modal.style.display = 'none'; }, 300);
    });
  });
}

// ========== CART MANAGEMENT ==========
function addToEnrollmentCart(classId, dateStr, timeSlot, className) {
  markMemberActivity();

  const existing = enrollCart.find(
    (item) => item.classId === classId && item.date === dateStr && item.time === timeSlot
  );

  if (existing) {
    showToast('Already added to cart for this date and time', 'warning');
    return;
  }

  updateSessionCounter(false, 0);
  if (realRemainingSessions < 1) {
    showToast(`No sessions left. Real remaining: ${realRemainingSessions}. Contact admin.`, 'error');
    return;
  }

  enrollCart.push({
    classId: classId,
    className: className,
    date: dateStr,
    time: timeSlot,
  });

  updateCartDisplay();
  updateSessionCounter(true, 0);

  const message =
    tempRemainingSessions < enrollCart.length
      ? `Added! Projected: ${tempRemainingSessions} (over limit—can't confirm until renewed).`
      : 'Added to cart! Sessions temporarily updated on screen.';
  showToast(message, 'success');
}

function updateCartDisplay() {
  const cartContainer = $('enrollmentCart');
  const cartContent = $('cartContent');
  const confirmBtn = $('confirmCartBtn');

  if (cartContainer) cartContainer.style.display = 'block';

  if (enrollCart.length === 0) {
    if (cartContent) cartContent.innerHTML = '<p style="color:#aaa;">No temporary selections. Add from calendar or list.</p>';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirm All Enrollments';
    }
    updateSessionCounter(false, 0);
    return;
  }

  let html = '';
  enrollCart.forEach((item, index) => {
    const dateObj = new Date(item.date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${escapeHtml(item.className)}</strong><br>
          <small>${dayOfWeek}, ${formattedDate} at ${escapeHtml(item.time)}</small>
        </div>
        <button type="button" class="cart-item-remove" onclick="removeFromCart(${index})" title="Remove">✕</button>
      </div>
    `;
  });
  if (cartContent) cartContent.innerHTML = html;

  updateSessionCounter(true, 0);
  if (confirmBtn) {
    confirmBtn.disabled = tempRemainingSessions < enrollCart.length || realRemainingSessions < enrollCart.length;
    confirmBtn.textContent = `Confirm All (${enrollCart.length})`;
  }
}

async function enrollSingleItem(item) {
  const memberId = memberIdFromAuth();
  if (!memberId) throw new Error('Not authenticated');

  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  const authUser = getAuth();
  if (!token || role !== 'member' || !authUser || Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS) {
    quickLogout();
    return;
  }

  const body = {
    class_id: item.classId,
    member_id: memberId,
    session_date: item.date,
    session_time: item.time,
    member_name: memberInfo?.name || 'Unknown',
  };

  const data = await apiFetch(`${API_URL}/api/enrollments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!data.success) throw new Error(data.error || 'Enrollment failed');
  return data;
}

async function confirmAllEnrollments() {
  markMemberActivity();

  if (!enrollCart || enrollCart.length === 0) return;

  showLoadingState(true);

  try {
    const totalItems = enrollCart.length;
    const projectedRemaining = realRemainingSessions - totalItems;
    if (projectedRemaining < 0) {
      showToast(`Not enough sessions: Need ${totalItems}, have ${realRemainingSessions}`, 'error');
      showLoadingState(false);
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
        lastRemaining = result.remaining_sessions || lastRemaining - 1;
      } catch (error) {
        failures.push({ index, item, error: error.message });
      }
    }

    tempRemainingSessions = lastRemaining;

    if (successful === totalItems) {
      enrollCart = [];
      updateCartDisplay();
      showToast(`All ${totalItems} enrollments successful! Sessions left: ${tempRemainingSessions}`, 'success');
      await loadMemberEnrollments();
      updateSessionCounter(false, 0);
    } else if (successful > 0) {
      const successIndices = [];
      for (let i = 0; i < totalItems; i++) {
        if (!failures.find((f) => f.index === i)) successIndices.push(i);
      }
      successIndices.reverse().forEach((idx) => enrollCart.splice(idx, 1));
      updateCartDisplay();
      const errorMsg = failures.map((f) => `${f.item.className}: ${f.error}`).join('; ');
      showToast(`${successful}/${totalItems} successful. Errors: ${errorMsg}`, 'warning');
    } else {
      const errorMsg = failures.map((f) => `${f.item.className}: ${f.error}`).join('; ');
      showToast(`No enrollments successful. Errors: ${errorMsg}`, 'error');
      updateCartDisplay();
    }
  } catch (error) {
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
      timedFetch(`${API_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`, 'Reload Enrollments'),
      timedFetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`, 'Reload Member'),
    ]);
    memberEnrollments = Array.isArray(enrollmentsData?.data) ? enrollmentsData.data : Array.isArray(enrollmentsData) ? enrollmentsData : [];
    memberInfo = memberData && memberData.success && memberData.data ? memberData.data : memberData || null;
    updateSessionCounter(false, 0);
  } catch (err) {
    console.error('Reload failed:', err);
  }
}

function removeFromCart(index) {
  if (index < 0 || index >= enrollCart.length) return;
  enrollCart.splice(index, 1);
  updateCartDisplay();
  updateSessionCounter(true, 1);
  if (enrollCart.length === 0) updateSessionCounter(false, 0);
}

// ========== LIST VIEW ==========
function renderListView() {
  const container = $('classesGrid');
  if (!container || availableClasses.length === 0) {
    if (container) container.innerHTML = `<div class="no-classes" style="padding:2rem;text-align:center;color:#888;">No classes available</div>`;
    return;
  }

  let html = '<div class="classes-grid-container">';
  availableClasses.forEach((cls) => {
    const classId = cls.class_id || cls._id;
    const className = cls.class_name || 'Unnamed Class';
    const trainerName = cls.trainer_name || cls.trainer_id || 'TBD';
    const capacity = cls.capacity || 10;
    const currentEnrollment = cls.current_enrollment || 0;
    const isFull = currentEnrollment >= capacity;

    html += `
      <div class="class-card">
        <div class="class-card-content">
          <h3 class="class-title">${escapeHtml(className)}</h3>
          <div class="class-schedule">${escapeHtml(cls.schedule || 'Schedule TBD')}</div>
          <div class="class-trainer">Trainer: ${escapeHtml(trainerName)}</div>
          <div class="class-capacity">
            ${isFull ? '<span class="status-full">FULL</span>' : `<span class="status-open">${currentEnrollment}/${capacity} spots</span>`}
          </div>
          <div class="class-description">
            <p>${escapeHtml(cls.description || 'No description available')}</p>
          </div>
          <button class="btn btn-primary class-enroll-btn" onclick="showClassForEnrollment('${classId}')" ${isFull ? 'disabled' : ''}>
            ${isFull ? 'Class Full' : 'Enroll Now'}
          </button>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

function setupEventListeners() {
  const calendarTab = $('tabCalendar');
  const listTab = $('tabList');
  const confirmBtn = $('confirmCartBtn');

  if (calendarTab) {
    calendarTab.addEventListener('click', () => {
      markMemberActivity();
      switchView('calendar');
    });
  }
  if (listTab) {
    listTab.addEventListener('click', () => {
      markMemberActivity();
      switchView('list');
    });
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', confirmAllEnrollments);
  }

  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal('dayModal');
      closeModal('singleClassModal');
    }
  });
}

function switchView(view) {
  const calendarView = $('calendarView');
  const listView = $('listView');
  const tabCalendar = $('tabCalendar');
  const tabList = $('tabList');

  if (view === 'calendar') {
    if (calendarView) calendarView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    if (tabCalendar) tabCalendar.classList.add('active');
    if (tabList) tabList.classList.remove('active');
    renderCalendarGrid();
  } else {
    if (calendarView) calendarView.style.display = 'none';
    if (listView) listView.style.display = 'block';
    if (tabList) tabList.classList.add('active');
    if (tabCalendar) tabCalendar.classList.remove('active');
    renderListView();
  }
  markMemberActivity();
}

function previousMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendarGrid();
  updateCalendarTitle();
  markMemberActivity();
}

function nextMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendarGrid();
  updateCalendarTitle();
  markMemberActivity();
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

function updateCalendarTitle() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = monthNames[currentCalendarDate.getMonth()];
  const year = currentCalendarDate.getFullYear();
  const titleElement = $('currentMonthDisplay');
  if (titleElement) titleElement.textContent = `${monthName} ${year}`;
}