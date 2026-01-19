// ========================================
// Member Attendance - Tokenized front-end
// With 2-hour max session + 15min idle warning (member only)
// ========================================

// Server base for localhost; in production, apiFetch uses relative paths
const SERVER_URL = 'http://localhost:8080';
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

// Utility
const $ = (id) => document.getElementById(id);

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
// Copy valid member session from generic keys into member_* once
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
// Auth helpers
// --------------------------------------
function getAuth() {
  try {
    bootstrapMemberFromGenericIfNeeded();
    return MemberStore.getAuthUser();
  } catch {
    return null;
  }
}

function getMemberMongoId() {
  const a = getAuth();
  if (!a) return null;
  const u = a.user || a;
  return u._id || u.id || u.memberId || u.member_id || null;
}

function fmtMonthTitle(d) {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function ymd(date) {
  const d = new Date(date);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ------------------------------
// Idle helpers (member attendance)
// ------------------------------
function markMemberActivity() {
  memberLastActivity = Date.now();
  memberIdleWarningShown = false;
}

// Idle banner at top (like console bar)
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
    });

    logoutBtn.addEventListener('click', () => {
      memberLogout('user chose logout after idle warning (attendance)');
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

// Centralized member logout
function memberLogout(reason) {
  console.log('[Member Logout] attendance page:', reason || 'no reason');

  MemberStore.clear();

  // Also clear generic keys if they are for member
  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'member') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[memberLogout] failed clearing generic keys:', e);
  }

  // Notify other member tabs in this browser
  localStorage.setItem(MEMBER_KEYS.logoutEvent, Date.now().toString());

  window.location.href = '../login.html';
}

// Keep backwards-compatible quickLogout wrapper
function quickLogout() {
  console.log('🚪 Quick logout triggered from attendance page!');
  memberLogout('quickLogout');
}

// Cross-tab member logout sync
window.addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEYS.logoutEvent) {
    console.log('[Member Logout] attendance page sees logout from another tab');
    MemberStore.clear();
    window.location.href = '../login.html';
  }
});

// Idle watcher using MemberStore + banner
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
        console.log('Member session exceeded 2 hours, logging out (attendance idle watcher).');
        memberLogout('session max age exceeded in attendance idle watcher');
        return;
      }
    } catch (e) {
      console.error('Failed to parse authUser in attendance idle watcher:', e);
      memberLogout('invalid authUser JSON in attendance idle watcher');
      return;
    }

    const idleFor = Date.now() - memberLastActivity;
    if (!memberIdleWarningShown && idleFor >= MEMBER_IDLE_WARNING_MS) {
      console.log(
        "You've been idle for 15 minutes on attendance page. Showing idle banner."
      );
      memberIdleWarningShown = true;
      showMemberIdleBanner();
    }
  }, 30000);
}

// ------------------------------
// Secure fetch helper (same pattern as other member pages)
// Enhanced: token + role + 2-hour timestamp check + refresh
// ------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  bootstrapMemberFromGenericIfNeeded();

  const token = MemberStore.getToken();
  const role = MemberStore.getRole();
  const authUser = MemberStore.getAuthUser();

  if (!token || !authUser || role !== 'member') {
    memberLogout('missing member session in attendance apiFetch');
    return;
  }

  // 2-hour session max check + refresh timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > MEMBER_SESSION_MAX_AGE_MS) {
      console.log('Session max age exceeded in apiFetch (attendance).');
      memberLogout('session max age exceeded in attendance apiFetch');
      return;
    }
    authUser.timestamp = Date.now();
    MemberStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in attendance apiFetch:', e);
    memberLogout('invalid authUser JSON in attendance apiFetch');
    return;
  }

  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1'
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
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.status === 401 || res.status === 403) {
      console.log('401/403 on attendance apiFetch - logging out');
      memberLogout('401/403 from attendance apiFetch');
      return;
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`API timeout after ${timeoutMs}ms`);
    throw e;
  }
}

// Initial auth check: token + role + timestamp (2 hours)
(function checkAuth() {
  bootstrapMemberFromGenericIfNeeded();
  const authUser = MemberStore.getAuthUser();
  const token = MemberStore.getToken();
  const role = MemberStore.getRole();

  if (
    !authUser ||
    !token ||
    role !== 'member' ||
    Date.now() - (authUser.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS
  ) {
    memberLogout('failed auth in attendance checkAuth');
  }
})();

// State
let currentMonth = new Date(); // pointer to displayed calendar month
let minMonth = new Date(); // two months back limit
minMonth.setMonth(minMonth.getMonth() - 2);
let monthAttendance = new Map(); // 'YYYY-MM-DD' => { firstLogin, lastLogout, totalLogs }
let todayYMD = ymd(new Date());

// Independent summary month pointer
let summaryMonthDate = new Date();

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  setupMemberIdleWatcher();
  markMemberActivity();
  setSidebarMemberName();

  function setSidebarMemberName() {
  try {
    if (typeof bootstrapMemberFromGenericIfNeeded === "function") {
      bootstrapMemberFromGenericIfNeeded();
    }

    // Prefer the member-scoped authUser (memberauthUser), fallback to generic authUser
    const auth =
      (typeof MemberStore !== "undefined" && MemberStore.getAuthUser && MemberStore.getAuthUser()) ||
      (() => {
        try {
          const raw =
            sessionStorage.getItem("memberauthUser") ||
            localStorage.getItem("memberauthUser") ||
            sessionStorage.getItem("authUser") ||
            localStorage.getItem("authUser");
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })();

    const user = auth?.user || auth;
    const displayName = user?.name || user?.username || auth?.name || auth?.username || "Member";

    const el = document.getElementById("sidebarMemberName");
    if (el) el.textContent = displayName;
  } catch (e) {
    console.error("Failed to set sidebar member name:", e);
  }
}

  // Sidebar toggle and logout
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      markMemberActivity();
    });
  }

  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      memberLogout('manual member logout from attendance page');
    });
  }

  // Greeting
  const storedName = sessionStorage.getItem('memberName');
  if ($('memberName')) $('memberName').textContent = storedName || 'Member';

  const auth = getAuth();
  const u = auth?.user || auth;
  if (u && $('memberIdBadge')) {
    $('memberIdBadge').textContent = u.memberId || u._id || 'Member';
  }

  // Calendar init
  updateMonthTitle();
  setupMonthNavButtons();
  renderCalendarSkeleton();
  loadAndRenderMonth();

  // Summary month (independent from calendar)
  setupSummaryMonthNavButtons();
  updateSummaryMonthTitle();
  loadSummaryMonthTotals();

  // Streak + lifetime stats (all-time logs)
  loadStreakAndLifetime();
});

// Month navigation setup (calendar)
function setupMonthNavButtons() {
  const prevBtn = $('prevMonthBtn');
  const nextBtn = $('nextMonthBtn');
  if (!prevBtn || !nextBtn) return;

  prevBtn.addEventListener('click', () => {
    const prev = new Date(currentMonth);
    prev.setMonth(prev.getMonth() - 1);
    if (prev >= startOfMonth(minMonth)) {
      currentMonth = prev;
      markMemberActivity();
      updateMonthTitle();
      loadAndRenderMonth();
    }
    refreshNavDisabled();
  });

  nextBtn.addEventListener('click', () => {
    const next = new Date(currentMonth);
    next.setMonth(next.getMonth() + 1);
    const thisMonth = startOfMonth(new Date());
    if (startOfMonth(next) <= thisMonth) {
      currentMonth = next;
      markMemberActivity();
      updateMonthTitle();
      loadAndRenderMonth();
    }
    refreshNavDisabled();
  });

  refreshNavDisabled();
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonth(d) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function refreshNavDisabled() {
  const prevBtn = $('prevMonthBtn');
  const nextBtn = $('nextMonthBtn');
  if (!prevBtn || !nextBtn) return;

  prevBtn.disabled = startOfMonth(currentMonth) <= startOfMonth(minMonth);
  nextBtn.disabled = startOfMonth(currentMonth) >= startOfMonth(new Date());
}

function updateMonthTitle() {
  if ($('monthTitle')) $('monthTitle').textContent = fmtMonthTitle(currentMonth);
}

// Render skeleton (header exists already)
function renderCalendarSkeleton() {
  const grid = $('calendarGrid');
  if (!grid) return;
  while (grid.children.length > 7) {
    grid.removeChild(grid.lastChild);
  }
}

// Load month data and render (calendar)
async function loadAndRenderMonth() {
  monthAttendance.clear();
  if ($('calendarLoading')) $('calendarLoading').style.display = '';
  if ($('calendarError')) {
    $('calendarError').style.display = 'none';
    $('calendarError').textContent = '';
  }

  const memberId = getMemberMongoId();
  if (!memberId) {
    if ($('calendarLoading')) $('calendarLoading').style.display = 'none';
    if ($('calendarError')) {
      $('calendarError').style.display = '';
      $('calendarError').textContent = 'Session expired. Please login again.';
    }
    return;
  }

  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);

  try {
    const data = await fetchAttendanceRange(memberId, start, end);
    aggregateAttendance(data);
  } catch (e) {
    if ($('calendarError')) {
      $('calendarError').style.display = '';
      $('calendarError').textContent = e.message || 'Failed to load attendance.';
    }
  } finally {
    if ($('calendarLoading')) $('calendarLoading').style.display = 'none';
    renderMonthDays(start, end);
  }
}

// Attempt to fetch attendance by member/date range; fallback to enrollments attended
async function fetchAttendanceRange(memberMongoId, start, end) {
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // Preferred: /api/attendance/member/:id?start&end
  try {
    const res = await apiFetch(
      `/api/attendance/member/${encodeURIComponent(
        memberMongoId
      )}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
    );
    if (res && (res.data || res.logs)) return res.data || res.logs;
  } catch (_) {
    // ignore and fallback
  }

  // Fallback: use enrollments to mark attended days (no login/logout granularity)
  const enrollmentsRes = await apiFetch(
    `/api/enrollments/member/${encodeURIComponent(memberMongoId)}`
  );
  const all = enrollmentsRes?.data || [];
  const inRange = all.filter((e) => {
    const d = new Date(e.session_date || e.date);
    const attended =
      e.attendance_status === 'attended' || e.attendance === true;
    return d >= start && d <= end && attended;
  });

  // Transform to pseudo-attendance: one login per attended day with unknown times
  return inRange.map((e) => ({
    memberId: memberMongoId,
    logType: 'login',
    timestamp: e.attended_at || e.session_date || e.date,
  }));
}

// Aggregate logs into firstLogin/lastLogout per day (calendar map)
function aggregateAttendanceInto(logs, targetMap) {
  for (const log of logs || []) {
    if (!log.timestamp) continue;
    const dKey = ymd(log.timestamp);
    if (!targetMap.has(dKey)) {
      targetMap.set(dKey, { firstLogin: null, lastLogout: null, totalLogs: 0 });
    }
    const entry = targetMap.get(dKey);
    entry.totalLogs += 1;

    if (log.logType === 'login') {
      if (!entry.firstLogin || new Date(log.timestamp) < new Date(entry.firstLogin)) {
        entry.firstLogin = log.timestamp;
      }
    }

    if (log.logType === 'logout') {
      if (!entry.lastLogout || new Date(log.timestamp) > new Date(entry.lastLogout)) {
        entry.lastLogout = log.timestamp;
      }
    }
  }
}

function aggregateAttendance(logs) {
  aggregateAttendanceInto(logs, monthAttendance);
}

// Render the grid for the target month
function renderMonthDays(start, end) {
  const grid = $('calendarGrid');
  if (!grid) return;

  while (grid.children.length > 7) grid.removeChild(grid.lastChild);

  const year = start.getFullYear();
  const month = start.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = new Date(year, month - 1);
  const prevDays = new Date(year, month, 0).getDate(); // Last day of prev month

  let dayCounter = 1;
  let prevDay = prevDays - startWeekday + 1;

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-day';

      let isCurrentMonth = false;
      let dayNum = null;
      let dayYMD = null;

      if (row === 0 && col < startWeekday) {
        dayNum = prevDay;
        const prevYear = prevMonth.getFullYear();
        const prevMon = prevMonth.getMonth();
        dayYMD = ymd(new Date(prevYear, prevMon, prevDay));
        prevDay++;
      } else if (dayCounter <= daysInMonth) {
        isCurrentMonth = true;
        dayNum = dayCounter;
        dayYMD = ymd(new Date(year, month, dayNum));
        dayCounter++;
      } else {
        const nextDay = dayCounter - daysInMonth;
        const nextMon = new Date(year, month + 1);
        dayNum = nextDay;
        dayYMD = ymd(new Date(nextMon.getFullYear(), nextMon.getMonth(), nextDay));
        dayCounter++;
      }

      const daySpan = document.createElement('span');
      daySpan.className = 'day-number';
      daySpan.textContent = dayNum;
      cell.appendChild(daySpan);

      if (isCurrentMonth && dayYMD && monthAttendance.has(dayYMD)) {
        cell.classList.add('attended');
        const entry = monthAttendance.get(dayYMD);
        const chip = document.createElement('span');
        chip.className = 'attendance-chip';
        chip.textContent = '  Attended ✅';
        cell.appendChild(chip);

        cell.addEventListener('click', () => showAttendanceModal(dayYMD, entry));
      }

      if (dayYMD === todayYMD) {
        cell.classList.add('today');
      }

      if (!isCurrentMonth) {
        cell.classList.add('other-month');
      }

      grid.appendChild(cell);
    }
  }
}

// Show modal for day details
function showAttendanceModal(dayYMD, entry) {
  const modal = $('attendanceModal');
  const title = $('attendanceModalTitle');
  const body = $('attendanceModalBody');
  const closeBtn = $('closeAttendanceModal');
  const modalClose = $('modalCloseBtn');
  if (!modal || !title || !body) return;

  title.textContent = `Attendance on ${dayYMD}`;
  body.innerHTML = '';

  if (entry.firstLogin) {
    const loginItem = document.createElement('div');
    loginItem.className = 'attendance-item';
    loginItem.innerHTML = `
      <span class="label">Login</span>
      <span class="value">${fmtTime(entry.firstLogin)}</span>
    `;
    body.appendChild(loginItem);
  }

  if (entry.lastLogout) {
    const logoutItem = document.createElement('div');
    logoutItem.className = 'attendance-item';
    logoutItem.innerHTML = `
      <span class="label">Logout</span>
      <span class="value">${fmtTime(entry.lastLogout)}</span>
    `;
    body.appendChild(logoutItem);
  }

  modal.style.display = 'flex';

  const hideModal = () => {
    modal.style.display = 'none';
  };

  if (closeBtn) closeBtn.onclick = hideModal;
  if (modalClose) modalClose.onclick = hideModal;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideModal();
  });
}

// ===== Independent monthly summary (summary card) =====
function setupSummaryMonthNavButtons() {
  const prev = $('prevSummaryMonthBtn');
  const next = $('nextSummaryMonthBtn');
  if (!prev || !next) return;

  prev.addEventListener('click', () => {
    summaryMonthDate.setMonth(summaryMonthDate.getMonth() - 1);
    markMemberActivity();
    updateSummaryMonthTitle();
    loadSummaryMonthTotals();
    refreshSummaryNavDisabled();
  });

  next.addEventListener('click', () => {
    const candidate = new Date(summaryMonthDate);
    candidate.setMonth(candidate.getMonth() + 1);

    const thisMonth = startOfMonth(new Date());
    if (startOfMonth(candidate) <= thisMonth) {
      summaryMonthDate = candidate;
      markMemberActivity();
      updateSummaryMonthTitle();
      loadSummaryMonthTotals();
    }

    refreshSummaryNavDisabled();
  });

  refreshSummaryNavDisabled();
}

function updateSummaryMonthTitle() {
  const el = $('summaryMonth');
  if (el) el.textContent = fmtMonthTitle(summaryMonthDate);
}

function refreshSummaryNavDisabled() {
  const prev = $('prevSummaryMonthBtn');
  const next = $('nextSummaryMonthBtn');
  if (!prev || !next) return;

  const thisMonth = startOfMonth(new Date());
  next.disabled = startOfMonth(summaryMonthDate) >= thisMonth;
}

// Fetch and compute total days attended in selected summary month
async function loadSummaryMonthTotals() {
  const memberId = getMemberMongoId();
  if (!memberId) return;

  const start = startOfMonth(summaryMonthDate);
  const end = endOfMonth(summaryMonthDate);
  const tempMap = new Map();

  try {
    const logs = await fetchAttendanceRange(memberId, start, end);
    aggregateAttendanceInto(logs, tempMap);
  } catch (_) {
    // ignore
  }

  const totalDays = Array.from(tempMap.values()).filter(
    (e) => e.totalLogs > 0
  ).length;

  if ($('totalAttendance')) {
    $('totalAttendance').textContent = String(totalDays);
  }
}

// ===== Streak + lifetime stats (all time) =====
async function fetchAttendanceAll(memberMongoId) {
  try {
    const res = await apiFetch(
      `/api/attendance/member/${encodeURIComponent(memberMongoId)}`
    );
    if (res && (res.data || res.logs)) {
      return res.data || res.logs;
    }
  } catch (_) {
    // ignore
  }
  return [];
}

async function loadStreakAndLifetime() {
  const memberId = getMemberMongoId();
  if (!memberId) return;

  const logs = await fetchAttendanceAll(memberId);
  const daysSet = new Set();

  for (const log of logs || []) {
    if (!log.timestamp) continue;
    daysSet.add(ymd(log.timestamp));
  }

  // Lifetime total days
  if ($('lifetimeAttendance')) {
    $('lifetimeAttendance').textContent = String(daysSet.size || 0);
  }

  if (daysSet.size === 0) {
    if ($('currentStreak')) $('currentStreak').textContent = '0';
    if ($('longestStreak')) $('longestStreak').textContent = '0';
    return;
  }

  // Current streak up to today
  let currentStreak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (true) {
    const key = ymd(cursor);
    if (daysSet.has(key)) {
      currentStreak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  if ($('currentStreak')) {
    $('currentStreak').textContent = String(currentStreak);
  }

  // Longest streak
  const sortedDays = Array.from(daysSet).sort();
  let longest = 0;
  let run = 0;
  let prevDate = null;

  for (const dayKey of sortedDays) {
    const [yearStr, monthStr, dayStr] = dayKey.split('-');
    const d = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
    d.setHours(0, 0, 0, 0);

    if (!prevDate) {
      run = 1;
    } else {
      const diffDays = (d.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
      if (Math.round(diffDays) === 1) {
        run += 1;
      } else {
        run = 1;
      }
    }

    if (run > longest) longest = run;
    prevDate = d;
  }

  if ($('longestStreak')) {
    $('longestStreak').textContent = String(longest);
  }
}
