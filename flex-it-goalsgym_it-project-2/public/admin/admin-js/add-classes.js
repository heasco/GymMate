const SERVER_URL = 'http://localhost:8080';

let calendar;
let allClasses = [];

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Admin-scoped storage keys to avoid cross-role interference
const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

// --------------------------------------
// Admin storage helpers (namespaced)
// --------------------------------------
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

// --------------------------------------
// Backward‑compatible bootstrap
// Copy valid admin session from generic keys into admin_* once
// --------------------------------------
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
// Shared auth helpers (admin only)
// ------------------------------
function clearLocalAuth() {
  // Clear admin-scoped keys
  AdminStore.clear();

  // Also clear legacy generic keys if they currently represent an admin session.
  // This prevents login.js from auto-redirecting back into admin after logout.
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
    console.error('[Admin clearLocalAuth] failed to clear generic keys:', e);
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

function adminLogout(reason, loginPath = '../admin-login.html') {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearLocalAuth();
  // Notify admin tabs only
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

// Centralized admin auth check
function ensureAdminAuthOrLogout(loginPath) {
  try {
    // Populate admin_* from generic admin keys if needed
    if (!AdminStore.hasSession()) {
      bootstrapAdminFromGenericIfNeeded();
    }

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

    // Refresh timestamp on successful check
    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    // Cross-tab logout: listen for adminLogoutEvent
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

/**
 * Require a valid auth session for this page.
 * - expectedRole: 'admin' | 'member' | 'trainer'
 * - loginPath: relative path to the corresponding login page
 *
 * For this admin module we delegate to ensureAdminAuthOrLogout,
 * keeping the signature unchanged at the call site.
 */
function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

// Global cross‑tab admin logout sync (admin_* only)
window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    adminLogout('adminLogoutEvent from another tab (global)', '../admin-login.html');
  }
});

// ------------------------------
// Utility for authenticated API calls
// ------------------------------
async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../admin-login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../admin-login.html');
    return;
  }

  // Basic timestamp check (same as requireAuth)
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../admin-login.html');
      return;
    }
    // Refresh timestamp on successful API use
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in apiFetch', '../admin-login.html');
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
    // Session invalid/expired OR logged in from another browser:
    // clear, broadcast admin logout to other tabs, and redirect.
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../admin-login.html';
    return;
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async function () {
  const ok = requireAuth('admin', '../admin-login.html');
  if (!ok) return;

  await checkServerConnection();
  await fetchTrainers(); // Secure
  setupEventListeners();
  setMinimumDates();
  setupSidebarAndSession();
});

// ------------------------------
// Health check
// ------------------------------
async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;

  try {
    console.log('Attempting health check to:', `${SERVER_URL}/health`);
    const response = await fetch(`${SERVER_URL}/health`);
    console.log('Health response status:', response.status);
    if (response.ok) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error(
        `Server response not OK: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error('Health check failed:', error);
    statusElement.textContent =
      'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
  }
}

// ------------------------------
// Sidebar + session handling
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Security: Check timestamp + clear token/role on invalid
  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in setupSidebarAndSession', '../admin-login.html');
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupSidebarAndSession', '../admin-login.html');
    return;
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
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        clearLocalAuth();
        // Notify admin tabs in this browser
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        window.location.href = '../admin-login.html';
      }
    });
  }

  // Mobile sidebar click outside
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

  // Overflow handling on collapse (mobile)
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
// Event listeners
// ------------------------------
function setupEventListeners() {
  document
    .getElementById('schedule_type')
    .addEventListener('change', toggleScheduleSection);
  document
    .getElementById('class_date')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('one_start_time')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('one_end_time')
    .addEventListener('change', updateSchedulePreview);
  document
    .querySelectorAll('input[name="days"]')
    .forEach((checkbox) => {
      checkbox.addEventListener('change', updateSchedulePreview);
    });
  document
    .getElementById('start_time')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('end_time')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('start_date')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('end_date')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('month_start')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('week_of_month')
    .addEventListener('change', updateSchedulePreview);
  document
    .getElementById('classForm')
    .addEventListener('submit', handleFormSubmit);
}

// ------------------------------
// Date minimums
// ------------------------------
function setMinimumDates() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('class_date').setAttribute('min', today);
  document.getElementById('start_date').setAttribute('min', today);
  document.getElementById('end_date').setAttribute('min', today);
  document.getElementById('month_start').setAttribute('min', today);
}

// ------------------------------
// Trainer list
// ------------------------------
async function fetchTrainers() {
  const trainerSelect = document.getElementById('trainer_id');
  const errorDiv = document.getElementById('trainerError');
  if (!trainerSelect) return;

  trainerSelect.innerHTML = 'Loading trainers...';
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const result = await apiFetch('/api/trainers');
    if (result.success && result.data && result.data.length > 0) {
      trainerSelect.innerHTML = 'Select a trainer';
      result.data.forEach((trainer) => {
        const option = document.createElement('option');
        option.value = trainer.trainer_id;
        option.textContent = `${trainer.name} (${trainer.specialization})`;
        trainerSelect.appendChild(option);
      });
      if (errorDiv) errorDiv.style.display = 'none';
    } else {
      trainerSelect.innerHTML = 'No trainers available';
      if (errorDiv) {
        errorDiv.textContent = 'No trainers found in the system';
        errorDiv.style.display = 'block';
      }
    }
  } catch (error) {
    console.error('Error fetching trainers:', error);
    trainerSelect.innerHTML = 'Error loading trainers';
    if (errorDiv) {
      errorDiv.textContent = `Network error: ${error.message}`;
      errorDiv.style.display = 'block';
    }
  }
}

// ------------------------------
// Schedule UI
// ------------------------------
function toggleScheduleSection() {
  const scheduleType = document.getElementById('schedule_type').value;
  const oneTimeSchedule = document.getElementById('oneTimeSchedule');
  const recurringSchedule = document.getElementById('recurringSchedule');
  const weeklyOptions = document.getElementById('weeklyOptions');
  const monthlyOptions = document.getElementById('monthlyOptions');

  document.querySelectorAll('.section').forEach((section) => {
    if (section.id !== 'formSection' && section.id !== 'scheduleViewSection') {
      section.style.display = 'none';
    }
  });

  if (scheduleType === 'one-time') {
    oneTimeSchedule.style.display = 'block';
  } else if (scheduleType === 'weekly') {
    recurringSchedule.style.display = 'block';
    weeklyOptions.style.display = 'block';
  } else if (scheduleType === 'monthly') {
    recurringSchedule.style.display = 'block';
    monthlyOptions.style.display = 'block';
  }

  updateSchedulePreview();
}

function updateSchedulePreview() {
  const scheduleType = document.getElementById('schedule_type').value;
  const scheduleInput = document.getElementById('schedule');
  const schedulePreview = document.getElementById('schedulePreview');

  if (!scheduleType) {
    schedulePreview.textContent =
      'Please select schedule type and complete the information above';
    scheduleInput.value = '';
    return;
  }

  const formatTime = (time24) => {
    if (!time24) return '';
    const [hoursStr, minutes] = time24.split(':');
    const hours = parseInt(hoursStr, 10);
    const hour12 = hours % 12 || 12;
    const ampm = hours < 12 ? 'AM' : 'PM';
    return `${hour12}:${minutes} ${ampm}`;
  };

  let scheduleText = '';

  if (scheduleType === 'one-time') {
    const date = document.getElementById('class_date').value;
    const startTime = document.getElementById('one_start_time').value;
    const endTime = document.getElementById('one_end_time').value;
    if (date && startTime && endTime) {
      if (startTime >= endTime) {
        schedulePreview.textContent = 'End time must be after start time';
        scheduleInput.value = '';
        return;
      }
      const formattedDate = new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      scheduleText = `One-time: ${formattedDate}, ${formatTime(
        startTime
      )} - ${formatTime(endTime)}`;
    }
  } else if (scheduleType === 'weekly' || scheduleType === 'monthly') {
    const selectedDays = Array.from(
      document.querySelectorAll('input[name="days"]:checked')
    ).map((cb) => cb.value);
    const startTime = document.getElementById('start_time').value;
    const endTime = document.getElementById('end_time').value;
    if (selectedDays.length > 0 && startTime && endTime) {
      if (startTime >= endTime) {
        schedulePreview.textContent = 'End time must be after start time';
        scheduleInput.value = '';
        return;
      }
      const daysText = selectedDays.join(', ');
      if (scheduleType === 'weekly') {
        const startDate = document.getElementById('start_date').value;
        const endDate = document.getElementById('end_date').value;
        let dateRange = '';
        if (startDate && endDate) {
          dateRange = ` (${new Date(
            startDate
          ).toLocaleDateString()} - ${new Date(
            endDate
          ).toLocaleDateString()})`;
        } else if (startDate) {
          dateRange = ` (Starting ${new Date(
            startDate
          ).toLocaleDateString()})`;
        }
        scheduleText = `Weekly: ${daysText}, ${formatTime(
          startTime
        )} - ${formatTime(endTime)}${dateRange}`;
      } else {
        const monthStart = document.getElementById('month_start').value;
        // monthStart can be used later if you want specific date-based rules
        scheduleText = `Monthly (4 weeks): ${daysText}, ${formatTime(
          startTime
        )} - ${formatTime(endTime)}`;
      }
    }
  }

  if (scheduleText) {
    schedulePreview.textContent = scheduleText;
    scheduleInput.value = scheduleText;
  } else {
    schedulePreview.textContent = 'Please complete all required information';
    scheduleInput.value = '';
  }
}

// ------------------------------
// Form submit
// ------------------------------
async function handleFormSubmit(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const classData = {
    class_name: formData.get('class_name').trim(),
    description: formData.get('description').trim(),
    schedule: formData.get('schedule').trim(),
    trainer_id: formData.get('trainer_id'),
    capacity: parseInt(formData.get('capacity'), 10),
  };

  if (!classData.trainer_id) {
    alert('Please select a trainer');
    return;
  }

  if (!classData.schedule) {
    alert('Please complete the schedule information');
    return;
  }

  try {
    const result = await apiFetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify(classData),
    });
    if (result.success) {
      showSuccess('Class successfully added!');
      document.getElementById('classForm').reset();
      updateSchedulePreview();
      await fetchTrainers(); // Reload trainers if needed
      if (calendar) loadClassesIntoCalendar();
    } else {
      throw new Error(result.error || 'Submission failed');
    }
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
  document.getElementById('formSection').classList.remove('active');
  document.getElementById('scheduleViewSection').classList.add('active');
  initCalendar();
}

function showFormView() {
  document.getElementById('scheduleViewSection').classList.remove('active');
  document.getElementById('formSection').classList.add('active');
}

// ------------------------------
// FullCalendar
// ------------------------------
function initCalendar() {
  if (calendar) {
    calendar.render();
    loadClassesIntoCalendar();
    return;
  }

  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

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
    const result = await apiFetch('/api/classes'); // Secure fetch for calendar events
    if (result.success && result.data) {
      calendar.removeAllEvents();
      allClasses = result.data;

      // TODO: parse schedule strings to concrete events
      // Example placeholder (you can customize with real parsing later):
      result.data.slice(0, 100).forEach((cls) => {
        // implement schedule parsing to events here if needed
      });
    }
  } catch (error) {
    console.error('Error loading classes:', error);
  }
}
