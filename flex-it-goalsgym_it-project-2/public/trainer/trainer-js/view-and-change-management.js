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
// Centralized trainer logout (scoped)
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

// Keep old name for compatibility with existing code
function logout(reason) {
  trainerLogout(reason);
}

// Cross‑tab trainer logout sync
window.addEventListener('storage', (event) => {
  if (event.key === TRAINER_KEYS.logoutEvent) {
    console.log('[Trainer Logout] schedule page sees logout from another tab');
    TrainerStore.clear();
    window.location.href = '../login.html';
  }
});

// --------------------------------------
// Utility for authenticated API calls
// (adds security header, full URLs, timeout, 2h check)
// --------------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log(
    'apiFetch called for:',
    endpoint,
    'method:',
    options.method || 'GET'
  ); // DEBUG

  bootstrapTrainerFromGenericIfNeeded();

  const token = TrainerStore.getToken();
  const authUser = TrainerStore.getAuthUser();
  const role = TrainerStore.getRole();

  if (!token || !authUser || role !== 'trainer') {
    console.log(
      'Missing token/authUser/role in trainer-schedule apiFetch - logging out'
    ); // DEBUG
    trainerLogout('missing token/authUser/role in trainer-schedule apiFetch');
    return;
  }

  // 2-hour session max check + update timestamp
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > TRAINER_SESSION_MAX_AGE_MS) {
      console.log('Trainer session max age exceeded in trainer-schedule apiFetch');
      trainerLogout('trainer session max age exceeded in trainer-schedule apiFetch');
      return;
    }
    // Bump timestamp to extend active session
    authUser.timestamp = Date.now();
    TrainerStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to parse authUser in trainer-schedule apiFetch:', e);
    trainerLogout('invalid authUser JSON in trainer-schedule apiFetch');
    return;
  }

  // Use endpoint directly if full URL; otherwise prepend base
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
        ? `http://localhost:8080${endpoint}`
        : endpoint;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      console.log(
        '401/403 Unauthorized - clearing auth and redirecting (trainer-schedule)'
      ); // DEBUG
      trainerLogout('401/403 from trainer-schedule apiFetch');
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

// ✅ INITIAL AUTH CHECK - Token + Role ('trainer') + 2h Timestamp
(function checkAuth() {
  console.log('Auth check starting for trainer-schedule'); // DEBUG

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
  }); // DEBUG

  if (
    !authUser ||
    !token ||
    role !== 'trainer' ||
    Date.now() - (authUser.timestamp || 0) > TRAINER_SESSION_MAX_AGE_MS
  ) {
    console.log('Auth failed - clearing and redirecting (trainer-schedule)'); // DEBUG
    trainerLogout('initial trainer-schedule auth failed');
    return;
  }

  console.log(
    'Trainer authenticated:',
    authUser.username || authUser.email || authUser.name,
    'Role:',
    role
  );
})();

const API_URL = 'http://localhost:8080';

document.addEventListener('DOMContentLoaded', async function () {
  setSidebarTrainerName();
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  bootstrapTrainerFromGenericIfNeeded();
  let authUser = TrainerStore.getAuthUser();
  const token = TrainerStore.getToken();
  const role = TrainerStore.getRole();

  // 🔍 DEBUG: Log the raw authUser to diagnose structure
  console.log('=== TRAINER SCHEDULE AUTH DEBUG ===');
  console.log('AuthUser from TrainerStore:', authUser);
  if (authUser) {
    console.log('authUser keys:', Object.keys(authUser));
    console.log('authUser.role:', authUser.role);
    console.log('authUser.timestamp:', authUser.timestamp);
    console.log('authUser.user exists?', !!authUser.user);
    if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
  }

  // FIXED AUTH CHECK: Support both wrapped (authUser.user) and flattened structures
  const user = authUser?.user || authUser; // Fallback to flattened structure
  const timestamp = authUser?.timestamp || 0;

  // ENHANCED: Token + role + timestamp check (2 hours)
  if (
    !authUser ||
    !user ||
    role !== 'trainer' ||
    !token ||
    Date.now() - timestamp > TRAINER_SESSION_MAX_AGE_MS
  ) {
    console.log('Auth check failed - logging out (trainer-schedule)');
    trainerLogout('trainer-schedule auth failed in DOMContentLoaded');
    return;
  }

  // refresh timestamp via TrainerStore
  TrainerStore.set(token, authUser);

  console.log('Auth check passed! Using user:', user);
  console.log(
    'Extracted trainer ID:',
    user.trainer_id || user.trainerid || user.trainerId || user.id || user._id
  );

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () =>
      sidebar.classList.toggle('collapsed')
    );
  }
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      trainerLogout('manual trainer-schedule logout button');
    });
  }

  // FIXED: Display trainer name from extracted user
  const trainerNameEl = document.getElementById('trainerName');
  if (trainerNameEl) trainerNameEl.textContent = user.name || 'Trainer';

  const classesContainer = document.getElementById('classesContainer');
  const loading = document.getElementById('classesLoading');

  if (!classesContainer || !loading) {
    console.error('Missing DOM elements');
    return;
  }

  try {
    // FIXED: Trainer ID extraction with more fallbacks
    const trainerId =
      user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
    if (!trainerId) {
      throw new Error('No valid trainer ID found');
    }

    console.log('Fetching classes for trainer ID:', trainerId);
    // TOKENIZED: Use apiFetch for GET classes
    const data = await apiFetch(`${API_URL}/api/classes`);
    console.log('Classes API response:', data);
    const allClasses = data.data || [];
    const trainerClasses = allClasses.filter((c) => {
      const cid = c.trainer_id || c.trainerid || c.trainerId || null;
      return cid === trainerId;
    });
    console.log('Filtered classes:', trainerClasses.length);

    loading.style.display = 'none';

    if (trainerClasses.length === 0) {
      classesContainer.innerHTML =
        '<div class="no-classes">No classes assigned to you yet.</div>';
      return;
    }

    const classesWithEnrollment = await Promise.all(
      trainerClasses.map(async (c) => {
        const cid = c.class_id || c.classid || c._id;
        let enrolledCount = 0;

        try {
          // TOKENIZED: Use apiFetch for GET enrollments
          const enroll = await apiFetch(
            `${API_URL}/api/classes/${cid}/enrollments`
          );
          enrolledCount = (enroll.data || []).length;
        } catch (err) {
          console.error(`Enrollments fetch failed for ${cid}:`, err);
        }

        return { ...c, enrolledCount };
      })
    );

    renderClasses(classesWithEnrollment, trainerId);
  } catch (err) {
    console.error('Error loading classes:', err);
    loading.style.display = 'none';
    classesContainer.innerHTML = `<div class="error">Failed to load classes: ${
      err.message
    }. Please try again.</div>`;
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


function parseScheduleDays(schedule) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const activeDays = [];

  days.forEach((day) => {
    if (schedule.includes(day)) {
      activeDays.push(day);
    }
  });

  return activeDays;
}

function renderClasses(classes, trainerId) {
  const container = document.getElementById('classesContainer');
  let html = '';

  classes.forEach((cls) => {
    const classId = cls.class_id || cls.classid || cls._id;
    const className = cls.class_name || cls.classname || 'Unnamed Class';
    const description = cls.description || 'No description available';
    const schedule = cls.schedule || 'Not scheduled';
    const capacity = cls.capacity || '-';
    const enrolled = cls.enrolledCount || 0;

    const activeDays = parseScheduleDays(schedule);
    const dayChecks = {
      Mon: activeDays.includes('Mon'),
      Tue: activeDays.includes('Tue'),
      Wed: activeDays.includes('Wed'),
      Thu: activeDays.includes('Thu'),
      Fri: activeDays.includes('Fri'),
      Sat: activeDays.includes('Sat'),
      Sun: activeDays.includes('Sun'),
    };

    html += `
          <div class="class-card" data-class-id="${classId}">
          <div class="class-header">
              <h3>${className}</h3>
              <span class="enrollment">${enrolled}/${capacity} Enrolled</span>
          </div>
          <p class="class-description">${description}</p>
          <div class="class-details">
              <div class="detail-item">
                  <strong>Current Schedule:</strong>
                  <div class="current-schedule">${schedule}</div>
              </div>
              <div class="detail-item"><strong>Capacity:</strong> ${capacity}</div>
          </div>
          <button class="save-btn" onclick="toggleEditForm('${classId}')">Edit Schedule</button>
          
          <div class="edit-form" id="editForm-${classId}" style="display: none;">
              <h4>Update Schedule</h4>
              
              <div class="schedule-type-selector">
                  <button type="button" class="schedule-type-btn active" onclick="setScheduleType('${classId}', 'weekly')">
                      <i class="fa-solid fa-check btn-icon"></i> Weekly Recurring
                  </button>
                  <button type="button" class="schedule-type-btn" onclick="setScheduleType('${classId}', 'onetime')">
                      <i class="fa-solid fa-calendar-days btn-icon"></i> One-Time Event
                  </button>
              </div>

              <div class="schedule-options" id="weeklyOptions-${classId}">
                  <label class="section-label">
                      <i class="fa-solid fa-check label-icon"></i> Select Days:
                  </label>
                  <div class="day-checkboxes">
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="mon-${classId}" value="Monday" ${
      dayChecks.Mon ? 'checked' : ''
    }>
                          <label for="mon-${classId}">Monday</label>
                      </div>
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="tue-${classId}" value="Tuesday" ${
                            dayChecks.Tue ? 'checked' : ''
                          }>
                          <label for="tue-${classId}">Tuesday</label>
                      </div>
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="wed-${classId}" value="Wednesday" ${
                            dayChecks.Wed ? 'checked' : ''
                          }>
                          <label for="wed-${classId}">Wednesday</label>
                      </div>
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="thu-${classId}" value="Thursday" ${
                            dayChecks.Thu ? 'checked' : ''
                          }>
                          <label for="thu-${classId}">Thursday</label>
                      </div>
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="fri-${classId}" value="Friday" ${
                            dayChecks.Fri ? 'checked' : ''
                          }>
                          <label for="fri-${classId}">Friday</label>
                      </div>
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="sat-${classId}" value="Saturday" ${
                            dayChecks.Sat ? 'checked' : ''
                          }>
                          <label for="sat-${classId}">Saturday</label>
                      </div>
                      <div class="day-checkbox-item">
                          <input type="checkbox" id="sun-${classId}" value="Sunday" ${
                            dayChecks.Sun ? 'checked' : ''
                          }>
                          <label for="sun-${classId}">Sunday</label>
                      </div>
                  </div>
                  <label class="section-label" style="margin-top: 1rem;">
                      <i class="fa-solid fa-clock label-icon"></i> Time Range:
                  </label>
                  <div class="time-input-group">
                      <div class="time-input-wrapper">
                          <input type="time" id="startTime-${classId}" value="07:00" required>
                          <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('startTime-${classId}').showPicker()"></i>
                      </div>
                      <span style="color: var(--accent);">to</span>
                      <div class="time-input-wrapper">
                          <input type="time" id="endTime-${classId}" value="08:00" required>
                          <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('endTime-${classId}').showPicker()"></i>
                      </div>
                  </div>
              </div>

              <div class="schedule-options" id="onetimeOptions-${classId}" style="display: none;">
                  <label class="section-label">
                      <i class="fa-solid fa-calendar-days label-icon"></i> Select Date:
                  </label>
                  <div class="date-input-wrapper">
                      <input type="date" class="date-picker-input" id="eventDate-${classId}" required>
                      <i class="fa-solid fa-calendar-days date-icon-right" onclick="document.getElementById('eventDate-${classId}').showPicker()"></i>
                  </div>
                  <label class="section-label" style="margin-top: 1rem;">
                      <i class="fa-solid fa-clock label-icon"></i> Time Range:
                  </label>
                  <div class="time-input-group">
                      <div class="time-input-wrapper">
                          <input type="time" id="eventStartTime-${classId}" value="07:00" required>
                          <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('eventStartTime-${classId}').showPicker()"></i>
                      </div>
                      <span style="color: var(--accent);">to</span>
                      <div class="time-input-wrapper">
                          <input type="time" id="eventEndTime-${classId}" value="08:00" required>
                          <i class="fa-solid fa-clock time-icon-right" onclick="document.getElementById('eventEndTime-${classId}').showPicker()"></i>
                      </div>
                  </div>
              </div>

              <div class="form-actions" style="margin-top: 1.5rem;">
                  <button class="save-btn" onclick="saveSchedule('${classId}', '${trainerId}')">Save Changes</button>
                  <button class="save-btn" onclick="toggleEditForm('${classId}')" style="background: #666;">Cancel</button>
              </div>
              <div class="edit-status" id="status-${classId}" style="display: none;"></div>
          </div>
          </div>
      `;
  });

  container.innerHTML = html;

  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.min = today;
  });
}

function setScheduleType(classId, type) {
  const weeklyOptions = document.getElementById(`weeklyOptions-${classId}`);
  const onetimeOptions = document.getElementById(`onetimeOptions-${classId}`);
  const buttons = document.querySelectorAll(
    `[data-class-id="${classId}"] .schedule-type-btn`
  );

  buttons.forEach((btn, idx) => {
    if ((type === 'weekly' && idx === 0) || (type === 'onetime' && idx === 1)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (type === 'weekly') {
    weeklyOptions.style.display = 'block';
    onetimeOptions.style.display = 'none';
  } else {
    weeklyOptions.style.display = 'none';
    onetimeOptions.style.display = 'block';
  }
}

function toggleEditForm(classId) {
  const form = document.getElementById(`editForm-${classId}`);
  if (form.style.display === 'none') {
    form.style.display = 'block';
  } else {
    form.style.display = 'none';
  }
}

// TOKENIZED: SAVE SCHEDULE
async function saveSchedule(classId, trainerId) {
  const statusDiv = document.getElementById(`status-${classId}`);
  const activeType = document.querySelector(
    `[data-class-id="${classId}"] .schedule-type-btn.active`
  );
  const isWeekly = activeType.textContent.includes('Weekly');

  let scheduleText = '';

  try {
    // ENHANCED: Token + role + timestamp check using TrainerStore
    bootstrapTrainerFromGenericIfNeeded();
    const token = TrainerStore.getToken();
    const authUser = TrainerStore.getAuthUser();
    const role = TrainerStore.getRole();

    if (
      !token ||
      !authUser ||
      role !== 'trainer' ||
      Date.now() - (authUser.timestamp || 0) > TRAINER_SESSION_MAX_AGE_MS
    ) {
      console.log('Invalid session in saveSchedule - logging out'); // DEBUG
      trainerLogout('invalid session in saveSchedule');
      return;
    }

    if (isWeekly) {
      const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const selectedDays = [];

      days.forEach((day, idx) => {
        const checkbox = document.getElementById(`${day}-${classId}`);
        if (checkbox && checkbox.checked) {
          selectedDays.push(dayNames[idx]);
        }
      });

      if (selectedDays.length === 0) {
        statusDiv.textContent = 'Please select at least one day';
        statusDiv.className = 'edit-status error';
        statusDiv.style.display = 'block';
        return;
      }

      const startTime = document.getElementById(`startTime-${classId}`).value;
      const endTime = document.getElementById(`endTime-${classId}`).value;

      if (!startTime || !endTime) {
        statusDiv.textContent = 'Please select start and end times';
        statusDiv.className = 'edit-status error';
        statusDiv.style.display = 'block';
        return;
      }

      scheduleText = `${selectedDays.join(', ')} ${formatTime(
        startTime
      )} - ${formatTime(endTime)}`;
    } else {
      const eventDate = document.getElementById(`eventDate-${classId}`).value;
      const eventStartTime =
        document.getElementById(`eventStartTime-${classId}`).value;
      const eventEndTime = document.getElementById(
        `eventEndTime-${classId}`
      ).value;

      if (!eventDate || !eventStartTime || !eventEndTime) {
        statusDiv.textContent = 'Please fill in all fields';
        statusDiv.className = 'edit-status error';
        statusDiv.style.display = 'block';
        return;
      }

      const date = new Date(eventDate);
      const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      scheduleText = `${dateStr} ${formatTime(eventStartTime)} - ${formatTime(
        eventEndTime
      )}`;
    }

    statusDiv.textContent = 'Updating schedule...';
    statusDiv.className = 'edit-status';
    statusDiv.style.display = 'block';

    // TOKENIZED: Use apiFetch for PUT
    const result = await apiFetch(`${API_URL}/api/classes/${classId}`, {
      method: 'PUT',
      body: JSON.stringify({
        schedule: scheduleText,
        trainer_id: trainerId,
      }),
    });

    console.log('Schedule update response:', result);

    if (result.error) {
      throw new Error(result.error || 'Failed to update schedule');
    }

    statusDiv.textContent = '✓ Schedule updated successfully!';
    statusDiv.className = 'edit-status success';

    const scheduleDisplay = document.querySelector(
      `[data-class-id="${classId}"] .current-schedule`
    );
    if (scheduleDisplay) {
      scheduleDisplay.textContent = scheduleText;
    }

    setTimeout(() => {
      toggleEditForm(classId);
      statusDiv.style.display = 'none';
    }, 2000);
  } catch (err) {
    console.error('Error updating schedule:', err);
    statusDiv.textContent = `Error: ${err.message}`;
    statusDiv.className = 'edit-status error';
    statusDiv.style.display = 'block';
  }
}

function formatTime(time24) {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}
