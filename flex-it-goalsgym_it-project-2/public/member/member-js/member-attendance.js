// ========================================
// Member Attendance - Tokenized front-end
// ========================================

// Server base for localhost; in production, apiFetch uses relative paths
const SERVER_URL = 'http://localhost:8080';

// Secure fetch helper (same pattern as other member pages)
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
    return;
  }
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? `${SERVER_URL}${endpoint}`
      : endpoint;
  }
  const headers = { ...options.headers, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.status === 401) {
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      window.location.href = '../member-login.html';
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

// Initial auth check: token + role + timestamp (1 hour)
(function checkAuth() {
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null');
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000 || !token || role !== 'member') {
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
  }
})();

// Utility
const $ = (id) => document.getElementById(id);
function getAuth() {
  try { return JSON.parse(sessionStorage.getItem('authUser') || 'null'); }
  catch { return null; }
}
function getMemberMongoId() {
  const a = getAuth(); if (!a) return null;
  const u = a.user || a;
  return u._id || u.id || u.memberId || u.member_id || null;
}
function fmtMonthTitle(d) {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function ymd(date) {
  const d = new Date(date);
  const m = `${d.getMonth()+1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// State
let currentMonth = new Date();              // pointer to displayed month
let minMonth = new Date();                  // two months back limit
minMonth.setMonth(minMonth.getMonth() - 2);
let monthAttendance = new Map();            // 'YYYY-MM-DD' => { firstLogin, lastLogout, totalLogs }
let todayYMD = ymd(new Date());

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar toggle and logout
  const menuToggle = $('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  }
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('memberData');
      sessionStorage.removeItem('memberName');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      window.location.href = '../member-login.html';
    });
  }

  // Greeting
  const storedName = sessionStorage.getItem('memberName');
  if ($('memberName')) $('memberName').textContent = storedName || 'Member';
  const auth = getAuth();
  const u = auth?.user || auth;
  if (u && $('memberIdBadge')) $('memberIdBadge').textContent = u.memberId || (u._id || 'Member');

  // Month nav init
  updateMonthTitle();
  setupMonthNavButtons();

  // Load calendar
  renderCalendarSkeleton();
  loadAndRenderMonth();
});

// Month navigation setup
function setupMonthNavButtons() {
  const prevBtn = $('prevMonthBtn');
  const nextBtn = $('nextMonthBtn');

  prevBtn.addEventListener('click', () => {
    // Move back one month if still >= minMonth
    const prev = new Date(currentMonth);
    prev.setMonth(prev.getMonth() - 1);
    if (prev >= startOfMonth(minMonth)) {
      currentMonth = prev;
      updateMonthTitle();
      loadAndRenderMonth();
    }
    refreshNavDisabled();
  });

  nextBtn.addEventListener('click', () => {
    // Allow moving forward only up to current calendar month (no future)
    const next = new Date(currentMonth);
    next.setMonth(next.getMonth() + 1);
    const thisMonth = startOfMonth(new Date());
    if (startOfMonth(next) <= thisMonth) {
      currentMonth = next;
      updateMonthTitle();
      loadAndRenderMonth();
    }
    refreshNavDisabled();
  });

  refreshNavDisabled();
}

function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d) { const x = new Date(d); x.setMonth(x.getMonth()+1, 0); x.setHours(23,59,59,999); return x; }

function refreshNavDisabled() {
  const prevBtn = $('prevMonthBtn');
  const nextBtn = $('nextMonthBtn');
  prevBtn.disabled = startOfMonth(currentMonth) <= startOfMonth(minMonth);
  nextBtn.disabled = startOfMonth(currentMonth) >= startOfMonth(new Date());
}

function updateMonthTitle() {
  if ($('monthTitle')) $('monthTitle').textContent = fmtMonthTitle(currentMonth);
  if ($('summaryMonth')) $('summaryMonth').textContent = fmtMonthTitle(currentMonth);
}

// Render skeleton (header exists already)
function renderCalendarSkeleton() {
  const grid = $('calendarGrid');
  if (!grid) return;
  // Remove any previously rendered days, keep header (first 7 children are header in display:contents)
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);
}

// Load month data and render
async function loadAndRenderMonth() {
  monthAttendance.clear();
  $('calendarLoading').style.display = '';
  $('calendarError').style.display = 'none';
  const memberId = getMemberMongoId();
  if (!memberId) {
    $('calendarLoading').style.display = 'none';
    $('calendarError').style.display = '';
    $('calendarError').textContent = 'Session expired. Please login again.';
    return;
  }

  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);

  // Try primary attendance endpoint (member range), then fallback to enrollments if not available
  try {
    const data = await fetchAttendanceRange(memberId, start, end);
    aggregateAttendance(data);
  } catch (e) {
    $('calendarError').style.display = '';
    $('calendarError').textContent = e.message || 'Failed to load attendance.';
  } finally {
    $('calendarLoading').style.display = 'none';
    renderMonthDays(start, end);
    updateTotals();
  }
}

// Attempt to fetch attendance by member/date range; fallback to enrollments attended
async function fetchAttendanceRange(memberMongoId, start, end) {
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // 1) Preferred: /api/attendance/member/:id?start&end  (backend can add this easily)
  try {
    const res = await apiFetch(`/api/attendance/member/${encodeURIComponent(memberMongoId)}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
    if (res && (res.data || res.logs)) return res.data || res.logs;
  } catch (_) {
    // ignore and fallback
  }

  // 2) Fallback: use enrollments to mark attended days (no login/logout granularity)
  const enrollmentsRes = await apiFetch(`/api/enrollments/member/${encodeURIComponent(memberMongoId)}`);
  const all = enrollmentsRes?.data || [];
  const inRange = all.filter(e => {
    const d = new Date(e.session_date || e.date);
    return d >= start && d <= end && (e.attendance_status === 'attended' || e.attendance === true);
  });
  // Transform to pseudo-attendance: one login per attended day with unknown times
  return inRange.map(e => ({
    memberId: memberMongoId,
    logType: 'login',
    timestamp: e.attended_at || e.session_date || e.date
  }));
}

// Aggregate logs into firstLogin/lastLogout per day
function aggregateAttendance(logs) {
  for (const log of (logs || [])) {
    const dKey = ymd(log.timestamp);
    if (!monthAttendance.has(dKey)) {
      monthAttendance.set(dKey, { firstLogin: null, lastLogout: null, totalLogs: 0 });
    }
    const entry = monthAttendance.get(dKey);
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

// Render the grid for the target month
function renderMonthDays(start, end) {
  const grid = $('calendarGrid');
  if (!grid) return;
  // Clear old days (keep header 7 items)
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);

  const year = start.getFullYear();
  const month = start.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // We will render a 6x7 grid for safety (up to 42 cells); fill with previous/next month placeholders
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

      if (dayCounter <= daysInMonth) {
        // Current month day
        isCurrentMonth = true;
        dayNum = dayCounter;
        dayYMD = ymd(new Date(year, month, dayNum));
        dayCounter++;
      } else if (prevDay <= prevDays) {
        // Previous month filler (dimmed)
        dayNum = prevDay;
        const prevYear = prevMonth.getFullYear();
        const prevMon = prevMonth.getMonth();
        dayYMD = ymd(new Date(prevYear, prevMon, prevDay));
        prevDay++;
      } else {
        // Next month filler (not rendered since no future, but for grid completeness)
        const nextDay = dayCounter - daysInMonth;
        const nextMon = new Date(year, month + 1);
        dayYMD = ymd(new Date(nextMon.getFullYear(), nextMon.getMonth(), nextDay));
      }

      // Set day number
      const daySpan = document.createElement('span');
      daySpan.className = 'day-number';
      daySpan.textContent = dayNum;
      cell.appendChild(daySpan);

      // Check if attended or today
      if (isCurrentMonth && dayYMD && monthAttendance.has(dayYMD)) {
        cell.classList.add('attended');
        const entry = monthAttendance.get(dayYMD);
        const chip = document.createElement('span');
        chip.className = 'attendance-chip';
        chip.textContent = entry.totalLogs + (entry.totalLogs > 1 ? ' logs' : ' log');
        cell.appendChild(chip);
        // Click to show modal
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

// Update summary totals
function updateTotals() {
  const totalDays = Array.from(monthAttendance.values()).filter(e => e.totalLogs > 0).length;
  if ($('totalAttendance')) $('totalAttendance').textContent = totalDays;
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

  // List login/logout
  if (entry.firstLogin) {
    const loginItem = document.createElement('div');
    loginItem.className = 'attendance-item';
    loginItem.innerHTML = `
      <span class="label">First Login</span>
      <span class="value">${fmtTime(entry.firstLogin)}</span>
    `;
    body.appendChild(loginItem);
  }
  if (entry.lastLogout) {
    const logoutItem = document.createElement('div');
    logoutItem.className = 'attendance-item';
    logoutItem.innerHTML = `
      <span class="label">Last Logout</span>
      <span class="value">${fmtTime(entry.lastLogout)}</span>
    `;
    body.appendChild(logoutItem);
  }
  if (entry.totalLogs > 0) {
    const totalItem = document.createElement('div');
    totalItem.className = 'attendance-item';
    totalItem.innerHTML = `
      <span class="label">Total Logs</span>
      <span class="value">${entry.totalLogs}</span>
    `;
    body.appendChild(totalItem);
  }

  modal.style.display = 'flex';

  // Close handlers
  const hideModal = () => modal.style.display = 'none';
  closeBtn.addEventListener('click', hideModal);
  modalClose.addEventListener('click', hideModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideModal();
  });
}
