const SERVER_URL = 'http://localhost:8080';

let calendar = null;
let allClasses = [];
let allTrainers = [];

// ------------------------------
// Admin session configuration
// ------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

// ------------------------------
// Admin storage helpers
// ------------------------------
const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'admin',
        token,
      };

      localStorage.setItem(ADMIN_KEYS.token, token);
      localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(ADMIN_KEYS.role, 'admin');

      sessionStorage.setItem(ADMIN_KEYS.token, token);
      sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) {
      console.error('[AdminStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(ADMIN_KEYS.token) ||
      localStorage.getItem(ADMIN_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(ADMIN_KEYS.authUser) ||
      localStorage.getItem(ADMIN_KEYS.authUser);

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[AdminStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  hasSession() {
    return (
      (localStorage.getItem(ADMIN_KEYS.token) ||
        sessionStorage.getItem(ADMIN_KEYS.token)) &&
      (localStorage.getItem(ADMIN_KEYS.authUser) ||
        sessionStorage.getItem(ADMIN_KEYS.authUser)) &&
      ((localStorage.getItem(ADMIN_KEYS.role) ||
        sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin')
    );
  },

  clear() {
    localStorage.removeItem(ADMIN_KEYS.token);
    localStorage.removeItem(ADMIN_KEYS.authUser);
    localStorage.removeItem(ADMIN_KEYS.role);

    sessionStorage.removeItem(ADMIN_KEYS.token);
    sessionStorage.removeItem(ADMIN_KEYS.authUser);
    sessionStorage.removeItem(ADMIN_KEYS.role);
  },
};

// ------------------------------
// Backward-compatible bootstrap
// ------------------------------
function bootstrapAdminFromGenericIfNeeded() {
  try {
    if (AdminStore.hasSession()) return;

    const genToken = localStorage.getItem('token');
    const genRole = localStorage.getItem('role');
    const genAuthRaw = localStorage.getItem('authUser');

    if (!genToken || !genRole || genRole !== 'admin' || !genAuthRaw) return;

    const genAuth = JSON.parse(genAuthRaw);
    AdminStore.set(genToken, genAuth);
  } catch (e) {
    console.error('[bootstrapAdminFromGenericIfNeeded] failed:', e);
  }
}

// ------------------------------
// Shared auth helpers
// ------------------------------
function clearLocalAuth() {
  AdminStore.clear();

  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'admin') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[clearLocalAuth] failed:', e);
  }
}

function getApiBase() {
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
    ? SERVER_URL
    : '';
}

function getToken() {
  return AdminStore.getToken();
}

function adminLogout(reason, loginPath = '../login.html') {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearLocalAuth();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) bootstrapAdminFromGenericIfNeeded();

    if (!AdminStore.hasSession()) {
      adminLogout('missing admin session', loginPath);
      return false;
    }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') {
      adminLogout('invalid or non-admin authUser', loginPath);
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded', loginPath);
      return false;
    }

    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) {
        adminLogout('adminLogoutEvent from another tab', loginPath);
      }
    });

    return true;
  } catch (e) {
    console.error('Auth check failed:', e);
    adminLogout('exception in ensureAdminAuthOrLogout', loginPath);
    return false;
  }
}

function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    adminLogout('adminLogoutEvent from another tab (global)', '../login.html');
  }
});

// ------------------------------
// Authenticated API calls
// ------------------------------
async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../login.html');
    return;
  }

  // Timestamp refresh
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../login.html');
      return;
    }
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in apiFetch', '../login.html');
    return;
  }

  const url =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
      ? `${SERVER_URL}${endpoint}`
      : endpoint;

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
    return;
  }

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupSidebarAndSession();
  await checkServerConnection();

  await preloadTrainers();
  await preloadClasses();

  setMinimumDates();
  setupEventListeners();

  resetTrainerSelect('Select schedule first');
  updateSchedulePreview(); // sets preview defaults
});

// ------------------------------
// Sidebar + session handling
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout(
        'admin session max age exceeded in setupSidebarAndSession',
        '../login.html'
      );
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupSidebarAndSession', '../login.html');
    return;
  }

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () =>
      sidebar.classList.toggle('collapsed')
    );
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getToken();
      try {
        if (token) {
          const logoutUrl = `${getApiBase()}/api/logout`;
          await fetch(logoutUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        clearLocalAuth();
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        window.location.href = '../login.html';
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 768 &&
      sidebar &&
      menuToggle &&
      !sidebar.contains(e.target) &&
      !menuToggle.contains(e.target)
    ) {
      sidebar.classList.remove('collapsed');
    }
  });

  if (sidebar) {
    sidebar.addEventListener('transitionend', () => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = 'auto';
      }
    });
  }
}

// ------------------------------
// Health check
// ------------------------------
async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;

  try {
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error('Health check failed');
    }
  } catch (error) {
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
    console.error('Server connection error:', error);
  }
}

// ------------------------------
// Preload data
// ------------------------------
async function preloadTrainers() {
  const trainerError = document.getElementById('trainerError');
  if (trainerError) trainerError.style.display = 'none';

  const result = await apiFetch('/api/trainers');
  if (!result || !result.success) throw new Error(result?.error || 'Failed to load trainers');

  allTrainers = Array.isArray(result.data) ? result.data : [];
}

async function preloadClasses() {
  const result = await apiFetch('/api/classes');
  if (!result || !result.success) throw new Error(result?.error || 'Failed to load classes');

  allClasses = Array.isArray(result.data) ? result.data : [];
}

// ------------------------------
// Event listeners
// ------------------------------
function setupEventListeners() {
  const scheduleTypeEl = document.getElementById('schedule_type');
  const form = document.getElementById('classForm');

  if (scheduleTypeEl) {
    scheduleTypeEl.addEventListener('change', () => {
      toggleScheduleSection();
      updateSchedulePreview();
      resetTrainerSelect('Complete schedule details');
      maybeRefreshAvailableTrainers();
    });
  }

  // Schedule inputs => refresh preview + available trainers
  const hook = (id, eventName = 'change') => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(eventName, () => {
      updateSchedulePreview();
      maybeRefreshAvailableTrainers();
    });
  };

  hook('class_date');
  hook('one_start_time');
  hook('one_end_time');

  document.querySelectorAll('input[name="days"]').forEach(cb => {
    cb.addEventListener('change', () => {
      updateSchedulePreview();
      maybeRefreshAvailableTrainers();
    });
  });

  hook('start_time');
  hook('end_time');
  hook('start_date');
  hook('end_date');
  hook('month_start');
  hook('week_of_month');

  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }

  const btnViewCalendar = document.getElementById('btnViewCalendar');
  if (btnViewCalendar) {
    btnViewCalendar.addEventListener('click', () => showScheduleView());
  }

  const btnBackToForm = document.getElementById('btnBackToForm');
  if (btnBackToForm) {
    btnBackToForm.addEventListener('click', () => showFormView());
  }
}

// ------------------------------
// Date minimums
// ------------------------------
function setMinimumDates() {
  const today = new Date().toISOString().split('T')[0];
  const ids = ['class_date', 'start_date', 'end_date', 'month_start'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('min', today);
  });
}

// ------------------------------
// Trainer select helpers
// ------------------------------
function resetTrainerSelect(placeholderText) {
  const trainerSelect = document.getElementById('trainer_id');
  const msg = document.getElementById('trainerAvailabilityMsg');
  const err = document.getElementById('trainerError');

  if (!trainerSelect) return;

  trainerSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = placeholderText || 'Select schedule first';
  trainerSelect.appendChild(opt);

  trainerSelect.disabled = true;

  if (msg) msg.textContent = '';
  if (err) err.style.display = 'none';
}

function setTrainerLoading(text) {
  const trainerSelect = document.getElementById('trainer_id');
  const msg = document.getElementById('trainerAvailabilityMsg');
  if (!trainerSelect) return;

  trainerSelect.disabled = true;
  trainerSelect.innerHTML = `<option value="">${text || 'Loading...'}</option>`;
  if (msg) msg.textContent = text || 'Loading...';
}

// ------------------------------
// Schedule UI
// ------------------------------
function toggleScheduleSection() {
  const scheduleType = document.getElementById('schedule_type')?.value;
  const oneTimeSchedule = document.getElementById('oneTimeSchedule');
  const recurringSchedule = document.getElementById('recurringSchedule');
  const weeklyOptions = document.getElementById('weeklyOptions');
  const monthlyOptions = document.getElementById('monthlyOptions');

  if (oneTimeSchedule) oneTimeSchedule.style.display = 'none';
  if (recurringSchedule) recurringSchedule.style.display = 'none';
  if (weeklyOptions) weeklyOptions.style.display = 'none';
  if (monthlyOptions) monthlyOptions.style.display = 'none';

  if (scheduleType === 'one-time') {
    if (oneTimeSchedule) oneTimeSchedule.style.display = 'block';
  } else if (scheduleType === 'weekly') {
    if (recurringSchedule) recurringSchedule.style.display = 'block';
    if (weeklyOptions) weeklyOptions.style.display = 'block';
  } else if (scheduleType === 'monthly') {
    if (recurringSchedule) recurringSchedule.style.display = 'block';
    if (monthlyOptions) monthlyOptions.style.display = 'block';
  }
}

function time24ToAmPm(time24) {
  if (!time24) return '';
  const [hh, mm] = time24.split(':');
  const h = parseInt(hh, 10);
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${mm} ${ampm}`;
}

function updateSchedulePreview() {
  const scheduleType = document.getElementById('schedule_type')?.value;
  const scheduleInput = document.getElementById('schedule');
  const schedulePreview = document.getElementById('schedulePreview');

  if (!scheduleInput || !schedulePreview) return;

  if (!scheduleType) {
    schedulePreview.textContent =
      'Please select schedule type and complete the information above';
    scheduleInput.value = '';
    return;
  }

  const params = getScheduleParamsFromUI();
  if (!params.valid) {
    schedulePreview.textContent = params.message || 'Please complete all required information';
    scheduleInput.value = '';
    return;
  }

  // Use a consistent schedule string format stored in Classes.schedule
  // One-time: "One-time YYYY-MM-DD, h:mm AM - h:mm PM"
  // Weekly:   "Weekly Monday, Wednesday, h:mm AM - h:mm PM (Starting YYYY-MM-DD)" or "(YYYY-MM-DD - YYYY-MM-DD)"
  // Monthly:  "Monthly Monday, Wednesday, h:mm AM - h:mm PM (4 weeks)"
  let scheduleText = '';

  if (params.type === 'one-time') {
    scheduleText = `One-time ${params.date}, ${time24ToAmPm(params.start)} - ${time24ToAmPm(params.end)}`;
  } else if (params.type === 'weekly') {
    const dayText = params.days.join(', ');
    let rangeText = '';
    if (params.startDate && params.endDate) rangeText = ` (${params.startDate} - ${params.endDate})`;
    else if (params.startDate) rangeText = ` (Starting ${params.startDate})`;

    scheduleText = `Weekly ${dayText}, ${time24ToAmPm(params.start)} - ${time24ToAmPm(params.end)}${rangeText}`;
  } else if (params.type === 'monthly') {
    const dayText = params.days.join(', ');
    scheduleText = `Monthly ${dayText}, ${time24ToAmPm(params.start)} - ${time24ToAmPm(params.end)} (4 weeks)`;
  }

  schedulePreview.textContent = scheduleText;
  scheduleInput.value = scheduleText;
}

function getScheduleParamsFromUI() {
  const type = document.getElementById('schedule_type')?.value;

  const invalid = (message) => ({ valid: false, message, type });

  if (!type) return invalid('Select schedule type first');

  if (type === 'one-time') {
    const date = document.getElementById('class_date')?.value || '';
    const start = document.getElementById('one_start_time')?.value || '';
    const end = document.getElementById('one_end_time')?.value || '';

    if (!date || !start || !end) return invalid('Complete the one-time date and time');
    if (start >= end) return invalid('End time must be after start time');

    return { valid: true, type, date, start, end };
  }

  if (type === 'weekly' || type === 'monthly') {
    const days = Array.from(document.querySelectorAll('input[name="days"]:checked'))
      .map(cb => cb.value);

    const start = document.getElementById('start_time')?.value || '';
    const end = document.getElementById('end_time')?.value || '';

    if (!days.length || !start || !end) return invalid('Select day(s) and start/end time');
    if (start >= end) return invalid('End time must be after start time');

    const startDate = (type === 'weekly') ? (document.getElementById('start_date')?.value || '') : '';
    const endDate = (type === 'weekly') ? (document.getElementById('end_date')?.value || '') : '';

    return { valid: true, type, days, start, end, startDate, endDate };
  }

  return invalid('Unknown schedule type');
}

// ------------------------------
// Availability filtering (client-side)
// ------------------------------
function maybeRefreshAvailableTrainers() {
  const params = getScheduleParamsFromUI();
  if (!params.valid) return;

  refreshAvailableTrainers(params);
}

async function refreshAvailableTrainers(target) {
  setTrainerLoading('Checking available trainers...');

  // Build quick lookup: trainer_id -> classes[]
  const classesByTrainer = new Map();
  allClasses.forEach(cls => {
    const tid = cls.trainer_id;
    if (!tid) return;
    if (!classesByTrainer.has(tid)) classesByTrainer.set(tid, []);
    classesByTrainer.get(tid).push(cls);
  });

  const available = allTrainers.filter(tr => {
    if (!tr) return false;

    // 1) Global available switch
    if (tr.is_available === false) return false;

    // 2) WeeklyAvailability + leaveRecords
    if (!trainerMatchesWeeklyAvailability(tr, target)) return false;
    if (!trainerPassesLeaveCheck(tr, target)) return false;

    // 3) Schedule conflicts vs existing assigned classes
    const existing = classesByTrainer.get(tr.trainer_id) || [];
    const conflict = existing.some(cls => classConflictsWithTarget(cls, target));
    return !conflict;
  });

  renderTrainerOptions(available);
}

function renderTrainerOptions(trainers) {
  const trainerSelect = document.getElementById('trainer_id');
  const msg = document.getElementById('trainerAvailabilityMsg');
  const err = document.getElementById('trainerError');

  if (!trainerSelect) return;

  trainerSelect.innerHTML = '';

  if (!trainers.length) {
    trainerSelect.disabled = true;
    trainerSelect.innerHTML = `<option value="">No trainers available for this schedule</option>`;
    if (msg) msg.textContent = 'No trainers match the selected schedule/time.';
    if (err) {
      err.textContent = 'Try adjusting days/time, or update trainer availability.';
      err.style.display = 'block';
    }
    return;
  }

  trainerSelect.disabled = false;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select an available trainer';
  trainerSelect.appendChild(placeholder);

  trainers
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .forEach(tr => {
      const option = document.createElement('option');
      option.value = tr.trainer_id;
      option.textContent = `${tr.name} (${tr.specialization || 'N/A'})`;
      trainerSelect.appendChild(option);
    });

  if (msg) msg.textContent = `${trainers.length} trainer(s) available.`;
  if (err) err.style.display = 'none';
}

function trainerMatchesWeeklyAvailability(trainer, target) {
  // weeklyAvailability structure is an object like:
  // { monday: ["morning","afternoon","evening"], ... }
  const avail = trainer.weeklyAvailability || {};

  const timePeriod = getTimePeriod(target.start, target.end);

  const dayRequired = (dayName) => {
    const key = String(dayName || '').toLowerCase();
    const slots = Array.isArray(avail[key]) ? avail[key] : null;
    // If not set, treat as available (so missing data doesn't block you)
    if (!slots) return true;
    return slots.includes(timePeriod);
  };

  if (target.type === 'one-time') {
    const dow = new Date(target.date).toLocaleDateString('en-US', { weekday: 'long' });
    return dayRequired(dow);
  }

  if (target.type === 'weekly' || target.type === 'monthly') {
    return target.days.every(dayRequired);
  }

  return true;
}

function trainerPassesLeaveCheck(trainer, target) {
  const leaves = Array.isArray(trainer.leaveRecords) ? trainer.leaveRecords : [];

  if (target.type === 'one-time') {
    return !leaves.some(l => l?.date === target.date);
  }

  // For recurring, do not block (leave can happen occasionally).
  // If you want strict blocking for weekly/monthly, implement by generating session dates.
  return true;
}

function getTimePeriod(start24, end24) {
  // Use start time only to decide the slot
  const hour = parseInt(String(start24 || '0:0').split(':')[0], 10);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function time12ToMinutes(t) {
  // "1:05 PM" -> minutes
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();

  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;

  return h * 60 + min;
}

function time24ToMinutes(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  // [start, end) overlap check
  return aStart < bEnd && bStart < aEnd;
}

function classConflictsWithTarget(cls, target) {
  // Only compare time overlap + matching date/day rules.
  const parsed = parseClassSchedule(cls?.schedule);
  if (!parsed) return false;

  const targetStart = time24ToMinutes(target.start);
  const targetEnd = time24ToMinutes(target.end);
  if (targetStart === null || targetEnd === null) return false;

  if (!overlaps(targetStart, targetEnd, parsed.startMin, parsed.endMin)) return false;

  // Target: one-time => conflicts if existing hits that date (or recurring on that weekday)
  if (target.type === 'one-time') {
    if (parsed.type === 'one-time') return parsed.date === target.date;

    const dow = new Date(target.date).toLocaleDateString('en-US', { weekday: 'long' });
    return parsed.days.includes(dow);
  }

  // Target: weekly/monthly => conflicts if share any weekday
  if (target.type === 'weekly' || target.type === 'monthly') {
    if (parsed.type === 'one-time') {
      // If existing one-time occurs on one of the selected days, treat as conflict.
      const dow = new Date(parsed.date).toLocaleDateString('en-US', { weekday: 'long' });
      return target.days.includes(dow);
    }
    // recurring vs recurring
    return parsed.days.some(d => target.days.includes(d));
  }

  return false;
}

function parseClassSchedule(scheduleStr) {
  const s = String(scheduleStr || '').trim();
  if (!s) return null;

  // One-time new format:
  // "One-time 2026-01-18, 1:00 PM - 2:00 PM"
  let m = s.match(/^One-time[:\s]+(\d{4}-\d{2}-\d{2})\s*,\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (m) {
    const startMin = time12ToMinutes(m[2].toUpperCase().replace(/\s+/g, ' '));
    const endMin = time12ToMinutes(m[3].toUpperCase().replace(/\s+/g, ' '));
    if (startMin === null || endMin === null) return null;
    return { type: 'one-time', date: m[1], days: [], startMin, endMin };
  }

  // One-time old UI format:
  // "One-time: Sunday, January 18, 2026, 1:00 PM - 2:00 PM"
  m = s.match(/^One-time:?\s*(.+?),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (m) {
    const dateGuess = new Date(m[1]);
    if (!isNaN(dateGuess.getTime())) {
      const date = dateGuess.toISOString().slice(0, 10);
      const startMin = time12ToMinutes(m[2].toUpperCase().replace(/\s+/g, ' '));
      const endMin = time12ToMinutes(m[3].toUpperCase().replace(/\s+/g, ' '));
      if (startMin === null || endMin === null) return null;
      return { type: 'one-time', date, days: [], startMin, endMin };
    }
  }

  // Weekly:
  // "Weekly Monday, Wednesday, 1:00 PM - 2:00 PM (Starting 2026-01-18)"
  // or "Weekly: Monday, Wednesday, 1:00 PM - 2:00 PM"
  m = s.match(/^Weekly:?\s*([A-Za-z,\s]+),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (m) {
    const days = m[1].split(',').map(v => v.trim()).filter(Boolean);
    const startMin = time12ToMinutes(m[2].toUpperCase().replace(/\s+/g, ' '));
    const endMin = time12ToMinutes(m[3].toUpperCase().replace(/\s+/g, ' '));
    if (startMin === null || endMin === null) return null;
    return { type: 'weekly', date: null, days, startMin, endMin };
  }

  // Monthly:
  // "Monthly Monday, Wednesday, 1:00 PM - 2:00 PM (4 weeks)"
  m = s.match(/^Monthly(?:\s*\(4\s*weeks\))?:?\s*([A-Za-z,\s]+),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (m) {
    const days = m[1].split(',').map(v => v.trim()).filter(Boolean);
    const startMin = time12ToMinutes(m[2].toUpperCase().replace(/\s+/g, ' '));
    const endMin = time12ToMinutes(m[3].toUpperCase().replace(/\s+/g, ' '));
    if (startMin === null || endMin === null) return null;
    return { type: 'monthly', date: null, days, startMin, endMin };
  }

  return null;
}

// ------------------------------
// Form submit
// ------------------------------
async function handleFormSubmit(e) {
  e.preventDefault();

  const schedule = document.getElementById('schedule')?.value?.trim() || '';
  const trainer_id = document.getElementById('trainer_id')?.value || '';

  if (!schedule) {
    alert('Please complete the schedule information first');
    return;
  }
  if (!trainer_id) {
    alert('Please select an available trainer');
    return;
  }

  const class_name = document.getElementById('class_name')?.value?.trim() || '';
  const description = document.getElementById('description')?.value?.trim() || '';
  const capacity = parseInt(document.getElementById('capacity')?.value || '0', 10);

  if (!class_name) return alert('Class name is required');
  if (!capacity || capacity < 1) return alert('Capacity must be at least 1');

  // Re-check availability right before submit (in case schedule changed)
  const params = getScheduleParamsFromUI();
  if (!params.valid) {
    alert(params.message || 'Fix schedule first');
    return;
  }

  // Client-side safety: ensure selected trainer still available
  const selectedTrainer = allTrainers.find(t => t.trainer_id === trainer_id);
  if (!selectedTrainer) {
    alert('Selected trainer not found. Refresh and try again.');
    return;
  }

  // Refresh conflicts (cheap)
  const trainerClasses = allClasses.filter(c => c.trainer_id === trainer_id);
  const anyConflict = trainerClasses.some(c => classConflictsWithTarget(c, params));
  if (anyConflict) {
    alert('Trainer is no longer available for that schedule/time. Please choose another trainer.');
    await preloadClasses();
    await preloadTrainers();
    await refreshAvailableTrainers(params);
    return;
  }

  const payload = { class_name, description, schedule, trainer_id, capacity };

  try {
    const result = await apiFetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!result || !result.success) {
      throw new Error(result?.error || 'Submission failed');
    }

    showSuccess('Class successfully added!');

    // refresh caches so the next availability check is accurate
    await preloadClasses();
    await preloadTrainers();

    document.getElementById('classForm').reset();
    toggleScheduleSection();
    updateSchedulePreview();
    resetTrainerSelect('Select schedule first');

    if (calendar) loadClassesIntoCalendar();
  } catch (error) {
    console.error('Error:', error);
    alert(error.message);
  }
}

// ------------------------------
// Success message
// ------------------------------
function showSuccess(message) {
  const successElement = document.getElementById('successMessage');
  if (!successElement) return;

  successElement.textContent = message;
  successElement.style.display = 'block';
  setTimeout(() => (successElement.style.display = 'none'), 5000);
}

// ------------------------------
// View toggle
// ------------------------------
function showScheduleView() {
  const formSection = document.getElementById('formSection');
  const scheduleViewSection = document.getElementById('scheduleViewSection');

  if (formSection) formSection.style.display = 'none';
  if (scheduleViewSection) scheduleViewSection.style.display = 'block';

  initCalendar();
}

function showFormView() {
  const formSection = document.getElementById('formSection');
  const scheduleViewSection = document.getElementById('scheduleViewSection');

  if (scheduleViewSection) scheduleViewSection.style.display = 'none';
  if (formSection) formSection.style.display = 'block';
}

// ------------------------------
// FullCalendar (optional)
// ------------------------------
function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl || typeof FullCalendar === 'undefined') return;

  if (calendar) {
    calendar.render();
    loadClassesIntoCalendar();
    return;
  }

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'timeGridWeek',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay',
    },
    height: 500,
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    events: [],
  });

  calendar.render();
  loadClassesIntoCalendar();
}

async function loadClassesIntoCalendar() {
  if (!calendar) return;

  try {
    const result = await apiFetch('/api/classes');
    if (result && result.success && Array.isArray(result.data)) {
      calendar.removeAllEvents();
      allClasses = result.data;

    }
  } catch (error) {
    console.error('Error loading classes:', error);
  }
}
