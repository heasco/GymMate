// ========================================
// Member Attendance - Logic strictly tied to API / Classes / Streaks
// ========================================

const SERVER_URL = 'http://localhost:8080';
const MEMBER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MEMBER_IDLE_WARNING_MS = 15 * 60 * 1000;

let memberLastActivity = Date.now();
let memberIdleWarningShown = false;

const MEMBER_KEYS = {
  token: 'member_token',
  authUser: 'member_authUser',
  role: 'member_role',
  logoutEvent: 'memberLogoutEvent',
};

const $ = (id) => document.getElementById(id);

// Storage Helpers
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
    return sessionStorage.getItem(MEMBER_KEYS.token) || localStorage.getItem(MEMBER_KEYS.token);
  },
  getAuthUser() {
    const raw = sessionStorage.getItem(MEMBER_KEYS.authUser) || localStorage.getItem(MEMBER_KEYS.authUser);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  hasSession() {
    return this.getToken() && this.getAuthUser() && 
           (localStorage.getItem(MEMBER_KEYS.role) === 'member' || sessionStorage.getItem(MEMBER_KEYS.role) === 'member');
  },
  clear() {
    localStorage.removeItem(MEMBER_KEYS.token);
    localStorage.removeItem(MEMBER_KEYS.authUser);
    localStorage.removeItem(MEMBER_KEYS.role);
    sessionStorage.removeItem(MEMBER_KEYS.token);
    sessionStorage.removeItem(MEMBER_KEYS.authUser);
    sessionStorage.removeItem(MEMBER_KEYS.role);
  }
};

function memberLogout(reason, loginPath = '../login.html') {
  MemberStore.clear();
  localStorage.setItem(MEMBER_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function requireAuth(expectedRole, loginPath) {
  if (!MemberStore.hasSession()) {
    memberLogout('missing session', loginPath);
    return false;
  }
  const user = MemberStore.getAuthUser();
  if (!user || user.role !== 'member') {
    memberLogout('invalid role', loginPath);
    return false;
  }
  if (Date.now() - (user.timestamp || 0) > MEMBER_SESSION_MAX_AGE_MS) {
    memberLogout('session expired', loginPath);
    return false;
  }
  user.timestamp = Date.now();
  MemberStore.set(MemberStore.getToken(), user);
  return true;
}

async function apiFetch(endpoint, options = {}) {
  if (!requireAuth('member', '../login.html')) return;
  const token = MemberStore.getToken();
  
  const url = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? `${SERVER_URL}${endpoint}` : endpoint;

  const headers = { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const res = await fetch(url, { ...options, headers });
  
  if (res.status === 401) {
    memberLogout('unauthorized', '../login.html');
    return;
  }
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

// Globals
let classesCache = {};
let logsByDate = {}; // Groups logs by 'YYYY-MM-DD'
let currentMonthDate = new Date();

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth('member', '../login.html')) return;
    setupSidebar();
    
    // FIX: Render empty calendar instantly so it never looks stuck
    renderCalendar();

    // Load data in the background
    await loadClassesCache();
    await loadAttendanceData();

    // Event listeners
    $('prevMonthBtn').addEventListener('click', () => changeMonth(-1));
    $('nextMonthBtn').addEventListener('click', () => changeMonth(1));
    
    $('closeAttendanceModal').addEventListener('click', () => $('attendanceModal').style.display = 'none');
    $('modalCloseBtn').addEventListener('click', () => $('attendanceModal').style.display = 'none');
    
    window.addEventListener('click', (e) => {
        if (e.target === $('attendanceModal')) $('attendanceModal').style.display = 'none';
    });
});

function setupSidebar() {
    const user = MemberStore.getAuthUser();
    if (user && user.name) {
        $('sidebarMemberName').textContent = user.name;
    }
    const menuToggle = $('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    }
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => memberLogout('user clicked logout'));
    }
}

// 1. Fetch Classes so we can resolve Class Name for Combative attendances
async function loadClassesCache() {
    try {
        const res = await apiFetch('/api/classes');
        if (res && res.success && res.data) {
            res.data.forEach(c => {
                classesCache[c._id] = c.class_name;
            });
        }
    } catch (e) {
        console.error("Failed to map classes:", e);
    }
}

// 2. Fetch Attendance
async function loadAttendanceData() {
    const user = MemberStore.getAuthUser();
    
    // UPDATED: Safely grab the ID whether it's stored as mongoId, memberId, or just id
    const memberId = user?.mongoId || user?.memberId || user?.id; 
    
    if (!memberId) {
        console.error("No member ID found in session payload.");
        return;
    }

    try {
        const res = await apiFetch(`/api/attendance/member/${memberId}`);
        if (res.success && res.data) {
            processLogs(res.data);
            renderCalendar(); // Re-render visually inserting the loaded logs
        }
    } catch (err) {
        console.error("Attendance load error:", err);
    } 
}

// 3. Group and process logic for Streaks
function processLogs(logs) {
    logsByDate = {};
    const daysSet = new Set();

    logs.forEach(log => {
        if (!log.timestamp) return;
        const d = new Date(log.timestamp);
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        
        if (!logsByDate[ymd]) logsByDate[ymd] = [];
        logsByDate[ymd].push(log);
        daysSet.add(ymd);
    });

    calculateStreaks(daysSet);
}

function calculateStreaks(daysSet) {
    const sortedDays = Array.from(daysSet).sort();
    
    if ($('lifetimeAttendance')) $('lifetimeAttendance').textContent = sortedDays.length;

    if (sortedDays.length === 0) {
        if ($('currentStreak')) $('currentStreak').innerHTML = '0 <span style="font-size: 0.9rem; color: var(--neutral);">Days</span>';
        if ($('longestStreak')) $('longestStreak').innerHTML = '0 <span style="font-size: 0.9rem; color: var(--neutral);">Days</span>';
        return;
    }

    // Longest Streak Calculation
    let longest = 0;
    let currentRun = 1;
    for (let i = 1; i < sortedDays.length; i++) {
        const d1 = new Date(sortedDays[i-1]);
        const d2 = new Date(sortedDays[i]);
        const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
        const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
        const diff = (utc2 - utc1) / (1000 * 60 * 60 * 24);
        
        if (diff === 1) {
            currentRun++;
        } else {
            if (currentRun > longest) longest = currentRun;
            currentRun = 1;
        }
    }
    if (currentRun > longest) longest = currentRun;
    if ($('longestStreak')) $('longestStreak').innerHTML = `${longest} <span style="font-size: 0.9rem; color: var(--neutral);">Days</span>`;

    // Current Streak Calculation
    let cStreak = 0;
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const tStr = formatDate(today);
    const yStr = formatDate(yesterday);

    if (daysSet.has(tStr) || daysSet.has(yStr)) {
        let checkDate = daysSet.has(tStr) ? new Date(today) : new Date(yesterday);
        while(true) {
            const checkStr = formatDate(checkDate);
            if (daysSet.has(checkStr)) {
                cStreak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }
    }
    if ($('currentStreak')) $('currentStreak').innerHTML = `${cStreak} <span style="font-size: 0.9rem; color: var(--neutral);">Days</span>`;
}

// 4. Calendar Logic
function changeMonth(delta) {
    currentMonthDate.setMonth(currentMonthDate.getMonth() + delta);
    renderCalendar();
}

function renderCalendar() {
    const grid = $('calendarGrid');
    grid.innerHTML = '';
    
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    
    $('currentMonthYear').textContent = currentMonthDate.toLocaleDateString('default', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = new Date().toDateString();

    // Empty cells
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-cell empty';
        grid.appendChild(emptyCell);
    }
    
    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        
        const dateObj = new Date(year, month, day);
        if (dateObj.toDateString() === todayStr) cell.classList.add('today');
        
        const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        cell.appendChild(dayNumber);
        
        // Inject Chips
        const dailyLogs = logsByDate[ymd] || [];
        if (dailyLogs.length > 0) {
            cell.classList.add('has-logs');
            cell.addEventListener('click', () => openAttendanceModal(dateObj, dailyLogs));
            
            dailyLogs.forEach(log => {
                const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const chip = document.createElement('div');
                chip.className = `attendance-chip ${log.logType}`;
                chip.textContent = `${log.logType === 'login' ? 'In' : 'Out'}: ${timeStr}`;
                cell.appendChild(chip);
            });
        }
        
        grid.appendChild(cell);
    }
}

// 5. Modal Rendering
function openAttendanceModal(dateObj, dailyLogs) {
    const modal = $('attendanceModal');
    $('attendanceModalTitle').textContent = `Attendance: ${dateObj.toLocaleDateString('default', { weekday: 'short', month: 'long', day: 'numeric' })}`;
    
    const body = $('attendanceModalBody');
    body.innerHTML = dailyLogs.map(log => {
        const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const action = log.logType === 'login' ? 'Check-In' : 'Check-Out';
        const type = log.attendedType ? (log.attendedType.charAt(0).toUpperCase() + log.attendedType.slice(1)) : 'Unknown';
        const cName = (log.classId && classesCache[log.classId]) ? classesCache[log.classId] : 'Not specified';
        
        let detailsHtml = '';
        if (log.logType === 'login') {
            detailsHtml = `
                <div class="log-details">
                    <strong>Type:</strong> ${type}<br>
                    ${(log.attendedType === 'combative' && log.classId) ? `<strong>Class:</strong> ${cName}` : ''}
                </div>
            `;
        }
        
        return `
            <div class="modal-log-item ${log.logType}">
                <div class="log-time">${timeStr} - <strong>${action}</strong></div>
                ${detailsHtml}
            </div>
        `;
    }).join('');
    
    modal.style.display = 'flex';
}