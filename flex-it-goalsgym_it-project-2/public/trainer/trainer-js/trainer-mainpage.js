// --------------------------------------
// Server & session configuration
// --------------------------------------
const SERVER_URL = 'http://localhost:8080';
const TRAINER_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const TRAINER_IDLE_WARNING_MS = 15 * 60 * 1000;        // 15 minutes

// Trainer-scoped storage keys (avoid admin/member interference)
const TRAINER_KEYS = {
  token: 'trainer_token',
  authUser: 'trainer_authUser',
  role: 'trainer_role',
  logoutEvent: 'trainerLogoutEvent',
};

// Idle tracking (trainer only)
let trainerLastActivity = Date.now();
let trainerIdleWarningShown = false;

// --------------------------------------
// Trainer storage helpers (namespaced)
// --------------------------------------
const TrainerStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'trainer',
        token,
      };

      // Prefer localStorage for cross-tab; mirror to sessionStorage
      localStorage.setItem(TRAINER_KEYS.token, token);
      localStorage.setItem(TRAINER_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(TRAINER_KEYS.role, 'trainer');

      sessionStorage.setItem(TRAINER_KEYS.token, token);
      sessionStorage.setItem(TRAINER_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(TRAINER_KEYS.role, 'trainer');
    } catch (e) {
      console.error('[TrainerStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(TRAINER_KEYS.token) ||
      localStorage.getItem(TRAINER_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(TRAINER_KEYS.authUser) ||
      localStorage.getItem(TRAINER_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[TrainerStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  getRole() {
    return (
      sessionStorage.getItem(TRAINER_KEYS.role) ||
      localStorage.getItem(TRAINER_KEYS.role) ||
      null
    );
  },

  hasSession() {
    const token =
      localStorage.getItem(TRAINER_KEYS.token) ||
      sessionStorage.getItem(TRAINER_KEYS.token);
    const authUser =
      localStorage.getItem(TRAINER_KEYS.authUser) ||
      sessionStorage.getItem(TRAINER_KEYS.authUser);
    const role =
      localStorage.getItem(TRAINER_KEYS.role) ||
      sessionStorage.getItem(TRAINER_KEYS.role);
    return !!token && !!authUser && role === 'trainer';
  },

  clear() {
    localStorage.removeItem(TRAINER_KEYS.token);
    localStorage.removeItem(TRAINER_KEYS.authUser);
    localStorage.removeItem(TRAINER_KEYS.role);

    sessionStorage.removeItem(TRAINER_KEYS.token);
    sessionStorage.removeItem(TRAINER_KEYS.authUser);
    sessionStorage.removeItem(TRAINER_KEYS.role);
  },
};

// --------------------------------------
// Backward‑compatible bootstrap
// Copy valid trainer session from generic keys into trainer_* once
// --------------------------------------
function bootstrapTrainerFromGenericIfNeeded() {
  try {
    if (TrainerStore.hasSession()) return;

    const genToken =
      localStorage.getItem('token') || sessionStorage.getItem('token');
    const genRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');
    const genAuthRaw =
      localStorage.getItem('authUser') || sessionStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'trainer' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    TrainerStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapTrainerFromGenericIfNeeded] failed:', e);
  }
}

// --------------------------------------
// Idle helpers
// --------------------------------------
function markTrainerActivity() {
  trainerLastActivity = Date.now();
  trainerIdleWarningShown = false;
}

// Idle banner at top (trainer)
function showTrainerIdleBanner() {
  let banner = document.getElementById('trainerIdleBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'trainerIdleBanner';
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
      const token = TrainerStore.getToken();
      const authUser = TrainerStore.getAuthUser();
      if (token && authUser) {
        authUser.timestamp = Date.now();
        TrainerStore.set(token, authUser);
      }
      markTrainerActivity();
      trainerIdleWarningShown = true;
      hideTrainerIdleBanner();
    });

    logoutBtn.addEventListener('click', () => {
      trainerLogout('trainer chose logout after idle warning');
    });

    banner.appendChild(textSpan);
    banner.appendChild(stayBtn);
    banner.appendChild(logoutBtn);
    document.body.appendChild(banner);
  } else {
    banner.style.display = 'flex';
  }
}

function hideTrainerIdleBanner() {
  const banner = document.getElementById('trainerIdleBanner');
  if (banner) banner.style.display = 'none';
}

function setupTrainerIdleWatcher() {
  // Treat these as activity
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markTrainerActivity, { passive: true });
  });

  // Check every 30 seconds
  setInterval(() => {
    bootstrapTrainerFromGenericIfNeeded();

    const token = TrainerStore.getToken();
    const role = TrainerStore.getRole();
    const authUser = TrainerStore.getAuthUser();

    if (!token || !authUser || role !== 'trainer') return;

    const ts = authUser.timestamp || 0;

    // Hard 2-hour session cap
    if (!ts || Date.now() - ts > TRAINER_SESSION_MAX_AGE_MS) {
      console.log('Trainer session exceeded 2 hours, logging out (idle watcher).');
      trainerLogout('trainer session max age exceeded in idle watcher');
      return;
    }

    const now = Date.now();
    const idleFor = now - trainerLastActivity;

    if (!trainerIdleWarningShown && idleFor >= TRAINER_IDLE_WARNING_MS) {
      console.log(
        "Trainer idle for 15 minutes. Showing idle banner."
      );
      trainerIdleWarningShown = true;
      showTrainerIdleBanner();
    }
  }, 30000);
}

// --------------------------------------
// Centralized trainer logout (trainer-only)
// --------------------------------------
function trainerLogout(reason) {
  console.log('[Trainer Logout]:', reason || 'no reason');

  // Clear trainer_* keys
  TrainerStore.clear();

  // Also clear legacy generic keys if they currently represent a trainer session
  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'trainer') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[trainerLogout] failed to clear generic trainer keys:', e);
  }

  // Notify other trainer tabs in this browser
  localStorage.setItem(TRAINER_KEYS.logoutEvent, Date.now().toString());

  window.location.href = '../login.html';
}

// Backwards-compatible name used in existing code
function logout(reason) {
  trainerLogout(reason);
}

// Cross‑tab trainer logout sync (trainer_* only)
window.addEventListener('storage', (event) => {
  if (event.key === TRAINER_KEYS.logoutEvent) {
    console.log('[Trainer Logout] dashboard sees logout from another tab');
    TrainerStore.clear();
    window.location.href = '../login.html';
  }
});

// --------------------------------------
// Authenticated API helper (trainer)
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const token = TrainerStore.getToken();
  const authUser = TrainerStore.getAuthUser();
  const role = TrainerStore.getRole();

  if (!token || !authUser || role !== 'trainer') {
    console.log('Missing token/authUser/role in trainer apiFetch - logging out'); // DEBUG
    trainerLogout('missing token/authUser/role in trainer apiFetch');
    return;
  }

  // 2-hour session max check + update timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > TRAINER_SESSION_MAX_AGE_MS) {
      console.log('Trainer session max age exceeded in apiFetch');
      trainerLogout('trainer session max age exceeded in apiFetch');
      return;
    }
    // Bump timestamp to extend active session
    authUser.timestamp = Date.now();
    TrainerStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in trainer apiFetch:', e);
    trainerLogout('invalid authUser JSON in trainer apiFetch');
    return;
  }

  // Build URL: support full URLs or relative /api routes
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    if (!endpoint.startsWith('/api/')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    url = `${SERVER_URL}${endpoint}`;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log('401/403 from trainer apiFetch - logging out'); // DEBUG
      trainerLogout('401/403 from trainer apiFetch');
      return;
    }

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`API timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// --------------------------------------
// INITIAL AUTH CHECK (trainer)
// --------------------------------------
(function checkAuth() {
  console.log('Auth check starting for trainer-dashboard'); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  console.log('Auth details:', {
    authUser: authUser
      ? authUser.username || authUser.email || authUser.name
      : null,
    token: !!token,
    role,
  });

  if (
    !authUser ||
    !token ||
    role !== 'trainer' ||
    Date.now() - (authUser.timestamp || 0) > TRAINER_SESSION_MAX_AGE_MS
  ) {
    console.log('Initial trainer auth failed - logging out'); // DEBUG
    trainerLogout('initial trainer auth failed');
    return;
  }

  console.log(
    'Trainer authenticated:',
    authUser.username || authUser.email || authUser.name,
    'Role:',
    role
  );
})();

// --------------------------------------
// Helper: current week range
// --------------------------------------
function getCurrentWeekRange() {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  const day = now.getDay() || 7;
  start.setDate(now.getDate() - day + 1);
  end.setDate(start.getDate() + 6);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Calculate attendance streak
function calcAttendanceStreak(dates) {
  if (dates.length === 0) return 0;
  let streak = 1,
    max = 1;
  dates.sort();
  for (let i = 1; i < dates.length; i++) {
    const d0 = new Date(dates[i - 1]);
    const d1 = new Date(dates[i]);
    if (d1 - d0 === 86400000) {
      streak++;
      if (streak > max) max = streak;
    } else {
      streak = 1;
    }
  }
  return max;
}

// --------------------------------------
// Main trainer dashboard logic
// --------------------------------------
document.addEventListener('DOMContentLoaded', async function () {
  // Idle tracking
  setupTrainerIdleWatcher();
  markTrainerActivity();
  setSidebarTrainerName();

  // SIDEBAR & AUTH SETUP
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Get trainer auth from TrainerStore
  bootstrapTrainerFromGenericIfNeeded();
  let authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  // DEBUG: auth structure
  console.log('=== TRAINER AUTH DEBUG ===');
  console.log('AuthUser from TrainerStore:', authUser);
  if (authUser) {
    console.log('authUser keys:', Object.keys(authUser));
    console.log('authUser.role:', authUser.role);
    console.log('authUser.timestamp:', authUser.timestamp);
    console.log('authUser.user exists?', !!authUser.user);
    if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
  }

  // Support both wrapped (authUser.user) and flattened
  const user = authUser?.user || authUser;
  const timestamp = authUser?.timestamp || 0;

  // Extra safety auth check (2h max)
  if (!authUser || !user || role !== 'trainer' || !token ||
      Date.now() - timestamp > TRAINER_SESSION_MAX_AGE_MS) {
    console.log('Auth check failed in DOMContentLoaded - logging out');
    trainerLogout('trainer auth failed in DOMContentLoaded');
    return;
  }

  // Refresh timestamp on page load via TrainerStore
  TrainerStore.set(token, authUser);

  console.log('Auth check passed! Using user:', user);
  console.log(
    'Extracted trainer ID:',
    user.trainer_id || user.trainerid || user.trainerId || user.id || user._id
  );

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      if (sidebar) sidebar.classList.toggle('collapsed');
      markTrainerActivity();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      trainerLogout('manual trainer logout button');
    });
  }

  // Display trainer info
  const trainerNameEl = document.getElementById('trainerName');
  const specializationEl = document.getElementById('specialization');
  if (trainerNameEl) trainerNameEl.textContent = user.name || 'Unknown Trainer';
  if (specializationEl && user.specialization) {
    specializationEl.textContent = `Specialization: ${user.specialization}`;
  }

  const scheduleDiv = document.getElementById('trainerSchedule');
  const loading = document.getElementById('scheduleLoading');
  const metricsDiv = document.getElementById('dashboardMetrics');

  if (!scheduleDiv || !loading || !metricsDiv) {
    console.error('Missing required DOM elements');
    return;
  }

  try {
    // Get trainer ID (multiple fallbacks)
    const trainerId =
      user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
    if (!trainerId) {
      throw new Error('No valid trainer ID found');
    }

    console.log('Fetching classes from /api/classes');
    const data = await apiFetch('/api/classes');
    console.log('Classes API response:', data);
    const allFromApi = (data && data.data) || [];

    // Filter classes by trainer_id
    const classes = allFromApi.filter((c) => {
      const cid = c.trainer_id || c.trainerid || c.trainerId || null;
      return cid === trainerId;
    });
    console.log('Filtered classes for trainer:', classes.length, classes);

    loading.style.display = 'none';

    if (classes.length === 0) {
      scheduleDiv.innerHTML =
        '<div class="no-classes">No assigned classes or schedule found.</div>';
      metricsDiv.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:2.5em 1.5em;">
              <div><strong>Weekly Attendance Total:</strong> <span class="attendance-badge high-badge">0</span></div>
              <div><strong>Most Attended Session:</strong> <span class="attendance-badge">N/A</span></div>
            </div>`;
      console.log('No classes found for this trainer');
      return;
    }

    const { start: weekStart, end: weekEnd } = getCurrentWeekRange();
    let totalWeeklyAttendance = 0;
    let bestSession = null;
    let bestCount = 0;

    console.log('Fetching enrollments for', classes.length, 'classes...');
    const classInfo = await Promise.all(
      classes.map(async (c) => {
        const cid = c.class_id || c.classid || c._id;
        console.log(`Fetching enrollments for class ID: ${cid}`);
        let enrollments = [];

        try {
          const enroll = await apiFetch(`/api/classes/${cid}/enrollments`);
          enrollments = (enroll && enroll.data) || [];
        } catch (err) {
          console.error(`Enrollments fetch failed for ${cid}:`, err);
        }

        const attendanceByDate = {};
        let weeklyAttendance = 0;

        enrollments.forEach((e) => {
          const status = (e.attendance_status || '').toLowerCase();
          if (status !== 'attended') return;

          const sessionDate = e.session_date;
          const dateStr = sessionDate
            ? new Date(sessionDate).toISOString().slice(0, 10)
            : 'unknown';

          if (!attendanceByDate[dateStr]) attendanceByDate[dateStr] = 0;
          attendanceByDate[dateStr]++;

          const dt = new Date(dateStr);
          if (dt >= weekStart && dt <= weekEnd) weeklyAttendance++;
        });

        Object.entries(attendanceByDate).forEach(([dt, count]) => {
          const d = new Date(dt);
          if (d >= weekStart && d <= weekEnd) {
            totalWeeklyAttendance += count;
          }
          if (count > bestCount) {
            bestCount = count;
            bestSession = { class: c, date: dt, count };
          }
        });

        const enrolled = enrollments.length || 0;
        const capacity = c.capacity || '-';
        const participationRate = enrolled
          ? Math.round((weeklyAttendance / enrolled) * 100)
          : 0;
        const datesAttended = Object.keys(attendanceByDate);
        const streak = calcAttendanceStreak(datesAttended);
        const lowAttendance =
          enrolled && c.capacity && enrolled / c.capacity < 0.5;

        return {
          name: c.class_name || c.classname || 'Unnamed',
          schedule: c.schedule || '',
          capacity,
          enrolled,
          weeklyAttendance,
          participationRate,
          mostAttended:
            Object.entries(attendanceByDate).sort((a, b) => b[1] - a[1])[0] ||
            null,
          streak,
          attendanceByDate,
          lowAttendance,
        };
      })
    );

    console.log('All class info processed:', classInfo);

    // UPDATE DASHBOARD METRICS
    let dashHTML = `<div style="display:flex;flex-wrap:wrap;gap:2.5em 1.5em;">`;
    dashHTML += `<div><strong>Weekly Attendance Total:</strong> <span class="attendance-badge high-badge">${totalWeeklyAttendance}</span></div>`;
    dashHTML += `<div><strong>Most Attended Session:</strong> <span class="attendance-badge">${
      bestSession
        ? `${bestSession.class.class_name || bestSession.class.classname} (${
            bestSession.date
          }) – ${bestSession.count} attended`
        : 'N/A'
    }</span></div>`;
    dashHTML += `</div>`;
    metricsDiv.innerHTML = dashHTML;

    // BUILD ATTENDANCE TABLE
    let html = `<table class="dashboard-table"><thead><tr>
                  <th>Class Name</th>
                  <th>Schedule</th>
                  <th>Capacity</th>
                  <th>Enrolled</th>
                  <th>Attendance<br>This Week</th>
                  <th>Participation<br>Rate (%)</th>
                  <th>Attendance<br>Streak</th>
                  <th>Attended By Date</th>
                </tr></thead><tbody>`;

    for (const c of classInfo) {
      html += `<tr${
        c.lowAttendance
          ? ' style="background:#fdf6b2;color:#78350f;border-left:5px solid #eab308"'
          : ''
      }>
                <td>${c.name}</td>
                <td>${c.schedule}</td>
                <td>${c.capacity}</td>
                <td><b>${c.enrolled}</b> ${
                  c.lowAttendance
                    ? '<span class="attendance-badge low-badge">Low</span>'
                    : ''
                }</td>
                <td><span class="attendance-badge high-badge">${c.weeklyAttendance}</span></td>
                <td><span class="attendance-badge">${c.participationRate}%</span></td>
                <td><span class="attendance-badge streak-badge">${c.streak}</span></td>
                <td>`;

      html +=
        Object.entries(c.attendanceByDate)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, count]) => `${date}: <b>${count}</b>`)
          .join('<br>') || '<span style="color:#999">No attended sessions</span>';

      html += `</td></tr>`;
    }

    html += '</tbody></table>';
    scheduleDiv.innerHTML = html;

    console.log('Trainer dashboard loaded successfully');
    console.log('=== END TRAINER DEBUG ===');
  } catch (err) {
    console.error('Error loading trainer dashboard:', err);
    loading.style.display = 'none';
    scheduleDiv.innerHTML = `<div class="error">Failed to load schedule: ${
      err.message
    }. Check console for details.</div>`;
    metricsDiv.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:2.5em 1.5em;">
              <div><strong>Weekly Attendance Total:</strong> <span class="attendance-badge high-badge">Error</span></div>
              <div><strong>Most Attended Session:</strong> <span class="attendance-badge">Error</span></div>
            </div>`;
  }
});

function setSidebarTrainerName() {
  try {
    if (typeof bootstrapTrainerFromGenericIfNeeded === "function") {
      bootstrapTrainerFromGenericIfNeeded();
    }

    const auth =
      (typeof TrainerStore !== "undefined" && TrainerStore.getAuthUser && TrainerStore.getAuthUser()) ||
      (() => {
        try {
          const raw =
            sessionStorage.getItem("trainerauthUser") ||
            localStorage.getItem("trainerauthUser") ||
            sessionStorage.getItem("authUser") ||
            localStorage.getItem("authUser");
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })();

    const user = auth?.user || auth;
    const displayName = user?.name || user?.username || auth?.name || auth?.username || "Trainer";

    const el = document.getElementById("sidebarTrainerName");
    if (el) el.textContent = displayName;
  } catch (e) {
    console.error("Failed to set sidebar trainer name:", e);
  }
}

