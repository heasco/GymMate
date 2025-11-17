// ========================================
// ATTENDANCE SYSTEM - Admin (Face-based)
// ========================================

const SERVER_URL = 'http://localhost:8080';

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

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
  // Clear admin_* keys
  AdminStore.clear();

  // Also clear legacy generic keys if they currently represent an admin session.
  // This prevents admin-login.html + login.js from auto-redirecting back into admin.
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
    console.error('[clearLocalAuth] failed to clear generic admin keys:', e);
  }
}

function getApiBase() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? SERVER_URL
    : '';
}

function getToken() {
  return AdminStore.getToken();
}

function adminLogout(reason, loginPath = '../admin-login.html') {
  console.log('[Admin Logout]:', reason || 'no reason'); // DEBUG
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

    const token = AdminStore.getToken();
    const authUser = AdminStore.getAuthUser();
    const role =
      sessionStorage.getItem(ADMIN_KEYS.role) ||
      localStorage.getItem(ADMIN_KEYS.role);

    console.log('Auth details (attendance):', {
      hasToken: !!token,
      role,
      hasAuthUser: !!authUser,
    }); // DEBUG

    if (!token || !role || role !== 'admin' || !authUser) {
      console.log('Auth failed - missing token/role/authUser; redirecting'); // DEBUG
      adminLogout('missing admin session', loginPath);
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      console.log('Auth failed - timestamp expired; redirecting'); // DEBUG
      adminLogout('admin session max age exceeded', loginPath);
      return false;
    }

    console.log(
      'Admin authenticated (attendance):',
      authUser.username,
      'Role:',
      role
    ); // DEBUG

    // Refresh timestamp on successful check
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);

    // Cross-tab logout sync (admin only)
    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) {
        console.log('Logout event detected in another tab; clearing auth'); // DEBUG
        adminLogout('adminLogoutEvent from another tab', loginPath);
      }
    });

    return true;
  } catch (e) {
    console.error('Auth check failed (attendance):', e);
    adminLogout('exception in ensureAdminAuthOrLogout', loginPath);
    return false;
  }
}

/**
 * Require a valid auth session for this page.
 * - expectedRole: 'admin' | 'member' | 'trainer'
 * - loginPath: relative path to the corresponding login page
 *
 * For this admin attendance module we just delegate to ensureAdminAuthOrLogout,
 * but keep the signature unchanged at the call site.
 */
function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

// Global cross‑tab admin logout sync (admin_* only)
window.addEventListener('storage', (event) => {
  if (event.key === ADMIN_KEYS.logoutEvent) {
    console.log('Global adminLogoutEvent; clearing auth'); // DEBUG
    adminLogout('adminLogoutEvent from another tab (global)', '../admin-login.html');
  }
});

// ------------------------------
// Utility for authenticated API calls (adds security header) with timeout
// ------------------------------
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint); // DEBUG

  const ok = ensureAdminAuthOrLogout('../admin-login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();
  const role =
    sessionStorage.getItem(ADMIN_KEYS.role) ||
    localStorage.getItem(ADMIN_KEYS.role);

  if (!token || role !== 'admin' || !authUser) {
    console.log('No valid admin token/role/authUser - redirecting to login'); // DEBUG
    adminLogout('missing admin session in apiFetch', '../admin-login.html');
    return;
  }

  // Timestamp check (same policy as requireAuth, but 12 hours)
  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      console.log('Auth expired inside apiFetch - redirecting'); // DEBUG
      adminLogout('admin session max age exceeded in apiFetch', '../admin-login.html');
      return;
    }
    // Refresh timestamp on successful API use
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.log('Failed to parse/refresh authUser inside apiFetch - redirecting'); // DEBUG
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
    'Content-Type': 'application/json', // Default for JSON calls
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

    if (response.status === 401) {
      console.log('401 Unauthorized - clearing auth and redirecting'); // DEBUG
      clearLocalAuth();
      // Notify other admin tabs in this browser
      localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
      window.location.href = '../admin-login.html';
      return;
    }

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`API timeout after ${timeoutMs}ms for`, endpoint); // DEBUG
      throw new Error(`API timeout after ${timeoutMs}ms`);
    }
    console.error('apiFetch error for', endpoint, error); // DEBUG
    throw error;
  }
}

// ✅ Secured AttendanceSystem - All API calls via apiFetch
class AttendanceSystem {
  constructor() {
    console.log('Constructor called'); // DEBUG
    this.camera = document.getElementById('camera');
    this.snapshot = document.getElementById('snapshot');
    this.statusMessage = document.getElementById('statusMessage');
    this.logStatus = document.getElementById('logStatus');
    this.logsContainer = document.getElementById('logsContainer');
    this.modal = document.getElementById('attendanceModal');
    this.modalButtons = document.getElementById('modalButtons');
    this.modalMemberName = document.getElementById('modalMemberName');

    // FIXED: Smart fallback - Target existing loading parent from screenshot
    if (!this.logsContainer) {
      console.warn('logsContainer (#logsContainer) not found - searching for loading parent');
      // Find .loading-logs or element with loading text, use its parent as container
      let loadingEl =
        document.querySelector('.loading-logs') ||
        Array.from(document.querySelectorAll('*')).find(
          (el) =>
            el.textContent &&
            el.textContent.includes('Loading attendance logs')
        );
      if (loadingEl) {
        this.logsContainer = loadingEl.parentElement; // Use parent (e.g., under header)
        console.log('Using existing logs section via loading parent');
        // Ensure ID for future refs
        this.logsContainer.id = 'logsContainer';
      } else {
        // Last resort: Create under attendance header/section
        const header =
          document.querySelector('h3, [class*="logs"], [class*="attendance"]') ||
          document.querySelector('.sidebar'); // From screenshot: sidebar-like
        if (header) {
          this.logsContainer = document.createElement('div');
          this.logsContainer.id = 'logsContainer';
          this.logsContainer.className = 'attendance-logs-container'; // For styling match
          this.logsContainer.innerHTML =
            '<div class="loading-logs">Loading attendance logs...</div>';
          header.parentNode.insertBefore(
            this.logsContainer,
            header.nextSibling
          ); // Insert after header
          console.log('Created fallback container after header');
        } else {
          // Absolute last: Append to body (but styled minimally)
          this.logsContainer = document.createElement('div');
          this.logsContainer.id = 'logsContainer';
          this.logsContainer.style.cssText =
            'position: relative; margin: 10px; padding: 10px; background: #333; color: white;';
          this.logsContainer.innerHTML =
            '<div class="loading-logs">Loading attendance logs...</div>';
          document.body.appendChild(this.logsContainer);
          console.log('Created minimal fallback on body');
        }
      }
    } else {
      console.log('logsContainer found directly');
    }

    console.log('Elements resolved:', {
      camera: !!this.camera,
      logsContainer: !!this.logsContainer,
      modal: !!this.modal,
    }); // DEBUG

    this.lastFaceId = null;
    this.lastDetectedTime = 0;
    this.attendedTodayMap = {};

    this.API_URL = getApiBase();
    this.FACE_API_URL =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5001'
        : 'http://localhost:5001'; // adjust if needed for production

    this.init();
  }

  async init() {
    console.log('Init called'); // DEBUG
    try {
      // Sidebar/menu toggle if present (matches your original UI)
      const menuToggle = document.getElementById('menuToggle');
      const sidebar = document.querySelector('.sidebar');
      const logoutBtn = document.getElementById('logoutBtn');

      console.log('UI elements:', {
        menuToggle: !!menuToggle,
        sidebar: !!sidebar,
        logoutBtn: !!logoutBtn,
      }); // DEBUG

      if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () =>
          sidebar.classList.toggle('collapsed')
        );
      }

      // ✅ LOGOUT - Clears token + authUser + role and informs backend
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
            console.error('Logout error (attendance):', e);
          } finally {
            clearLocalAuth();
            localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
            window.location.href = '../admin-login.html';
          }
        });
      }

      // Close sidebar on outside click (mobile, original behavior)
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

      await this.startCamera();
      this.startFaceDetection();

      // Clear loading state in logs container
      console.log('Clearing logsContainer...'); // DEBUG
      if (this.logsContainer) {
        const loadingChild =
          this.logsContainer.querySelector('.loading-logs') ||
          Array.from(this.logsContainer.children).find(
            (child) =>
              child.textContent &&
              child.textContent.includes('Loading attendance logs')
          );
        if (loadingChild) {
          loadingChild.remove();
          console.log('Original loading removed - ready for logs');
        } else {
          this.logsContainer.innerHTML = ''; // Fallback clear
        }
      } else {
        console.error(
          'logsContainer still null after fallback - skipping clear'
        );
      }

      await this.loadAttendanceLogs(); // Now safe, renders in correct spot
      this.setupAutoRefresh();
      this.setupKeyboardShortcuts();
      console.log('Init completed successfully'); // DEBUG
    } catch (error) {
      console.error('Init error:', error); // DEBUG
      if (this.logsContainer) {
        this.logsContainer.innerHTML =
          '<p class="no-logs">Error loading (check console)</p>';
      }
    }
  }

  // Keyboard shortcuts (original: R refresh, ESC close)
  setupKeyboardShortcuts() {
    console.log('Setting up keyboard shortcuts'); // DEBUG
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (confirm('Close attendance system?')) {
          window.close();
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        this.loadAttendanceLogs();
        this.updateStatus('Logs refreshed', 'success');
      }
    });
  }

  async startCamera() {
    console.log('Starting camera'); // DEBUG
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      if (this.camera) this.camera.srcObject = stream;
      this.updateStatus(
        'Camera active - Ready for face detection',
        'success'
      );
      console.log('Camera started successfully'); // DEBUG
    } catch (error) {
      console.error('Camera error:', error); // DEBUG
      this.updateStatus('Camera access denied: ' + error.message, 'error');
    }
  }

  updateStatus(message, type = 'info') {
    if (this.statusMessage) {
      this.statusMessage.textContent = message;
      this.statusMessage.style.color =
        type === 'error'
          ? '#DC3545'
          : type === 'success'
          ? '#28A745'
          : '#BFBFBF';
    }
  }

  updateLogStatus(message, type = 'info') {
    if (this.logStatus) {
      this.logStatus.textContent = message;
      this.logStatus.style.color =
        type === 'error'
          ? '#DC3545'
          : type === 'success'
          ? '#28A745'
          : type === 'warning'
          ? '#FFC107'
          : '#BFBFBF';
    }
  }

  startFaceDetection() {
    console.log('Starting face detection interval'); // DEBUG
    setInterval(() => this.detectFace(), 3000); // 3s interval
  }

  async detectFace() {
    if (!this.camera || !this.camera.srcObject) return;

    const context = this.snapshot.getContext('2d');
    this.snapshot.width = this.camera.videoWidth;
    this.snapshot.height = this.camera.videoHeight;
    context.drawImage(
      this.camera,
      0,
      0,
      this.snapshot.width,
      this.snapshot.height
    );

    const blob = await new Promise((resolve) =>
      this.snapshot.toBlob(resolve, 'image/jpeg', 0.9)
    );

    await this.sendFaceForVerification(blob);
  }

  async sendFaceForVerification(blob) {
    const formData = new FormData();
    formData.append('image', blob, 'face_capture.jpg');

    try {
      const response = await fetch(`${this.FACE_API_URL}/api/verify-face`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data && data.status === 'success' && data.faceId) {
        await this.handleFaceDetected(data.faceId);
      } else {
        this.updateStatus('No recognizable face detected', 'info');
        this.lastFaceId = null;
      }
    } catch (error) {
      console.error('Face verification error:', error); // DEBUG
      this.updateStatus('Face recognition service unavailable', 'error');
    }
  }

  async handleFaceDetected(faceId) {
    if (
      this.lastFaceId === faceId &&
      Date.now() - this.lastDetectedTime < 5000
    ) {
      return;
    }

    this.lastFaceId = faceId;
    this.lastDetectedTime = Date.now();

    const memberInfo = await this.getMemberInfo(faceId);
    const displayName =
      memberInfo?.name ||
      `${memberInfo?.firstName || ''} ${memberInfo?.lastName || ''}`.trim() ||
      faceId;

    this.updateStatus(`Face detected: ${displayName}`, 'success');
    await this.logAttendance(faceId, displayName);
  }

  // Secure GET member info
  async getMemberInfo(faceId) {
    try {
      const response = await apiFetch(`/api/members/${faceId}`);
      return response && response.success ? response.data : null;
    } catch (error) {
      console.error('Error fetching member:', error);
      return null;
    }
  }

  // Secure POST attendance log (initial)
  async logAttendance(faceId, displayName) {
    try {
      const response = await apiFetch('/api/attendance/log', {
        method: 'POST',
        body: JSON.stringify({ faceId }),
      });

      await this.handleAttendanceResponse(response, faceId, displayName);
    } catch (error) {
      console.error('Attendance log error:', error);
      this.updateLogStatus('Network error - Please try again', 'error');
    }
  }

  async handleAttendanceResponse(data, faceId, displayName) {
    if (data && data.success) {
      if (data.requiresSelection && data.data?.options) {
        this.showAttendanceModal(
          data.data.options,
          data.data.classOptions,
          faceId,
          displayName
        );
      } else if (data.alreadyLoggedIn) {
        this.updateLogStatus(
          `${displayName} - Already logged in`,
          'warning'
        );
      } else if (data.logged) {
        this.updateLogStatus(
          `${displayName} - ${data.logged.toUpperCase()} recorded`,
          'success'
        );
        this.loadAttendanceLogs();
      }
    } else {
      this.updateLogStatus(data?.error || 'Attendance error', 'error');
    }
  }

  showAttendanceModal(options, classOptions, faceId, displayName) {
    if (!this.modal || !this.modalMemberName || !this.modalButtons) return; // Null-safe
    this.modalMemberName.textContent = displayName;
    this.modalButtons.innerHTML = '';

    options.forEach((type) => {
      const button = document.createElement('button');
      button.className = 'modal-btn';
      button.textContent =
        type.charAt(0).toUpperCase() + type.slice(1);
      button.onclick = () =>
        this.selectAttendanceType(
          type,
          faceId,
          displayName,
          classOptions
        );
      this.modalButtons.appendChild(button);
    });

    this.modal.style.display = 'flex';
    this.modal.dataset.faceId = faceId;
  }

  selectAttendanceType(type, faceId, displayName, classOptions) {
    if (this.modal) this.modal.style.display = 'none';

    let classId = null;
    if (
      (type === 'combative' || type === 'both') &&
      classOptions?.length
    ) {
      classId = classOptions[0].id;
    }

    this.logAttendanceWithType(faceId, displayName, type, classId);
  }

  // Secure POST attendance with type
  async logAttendanceWithType(faceId, displayName, attendedType, classId) {
    try {
      const response = await apiFetch('/api/attendance/log', {
        method: 'POST',
        body: JSON.stringify({ faceId, attendedType, classId }),
      });

      if (response && response.success) {
        this.updateLogStatus(
          `${displayName} - ${attendedType.toUpperCase()} recorded`,
          'success'
        );
      } else {
        this.updateLogStatus(
          response?.error || 'Attendance error',
          'error'
        );
      }

      this.loadAttendanceLogs();
    } catch (error) {
      console.error('Attendance with type error:', error);
      this.updateLogStatus('Network error', 'error');
    }
  }

  // Use /api/attendance/today (same shape as checker.js)
  async loadAttendanceLogs() {
    console.log('Starting log load...'); // DEBUG
    try {
      const result = await apiFetch('/api/attendance/today');
      console.log('Logs API Response:', result); // DEBUG

      let logs = [];
      if (
        result &&
        result.success !== false &&
        result.data &&
        result.data.recentActivity &&
        Array.isArray(result.data.recentActivity)
      ) {
        logs = result.data.recentActivity;
      } else if (Array.isArray(result)) {
        logs = result; // Fallback: plain array
      } else if (result && result.data && Array.isArray(result.data)) {
        logs = result.data; // Fallback: {data: [...]}
      }

      logs = logs.slice(0, 10); // limit like checker.js
      console.log('Rendering', logs.length, 'logs'); // DEBUG
      this.renderAttendanceLogs(logs);
    } catch (error) {
      console.error('Load logs error:', error);
      if (this.logsContainer) {
        this.logsContainer.innerHTML =
          '<p class="no-logs">No attendance logs today (or check backend route/server)</p>';
      } else {
        console.warn('Cannot show fallback - logsContainer null');
      }
    }
  }

  // Render from recentActivity format
  renderAttendanceLogs(logs) {
    console.log('Rendering logs:', logs); // DEBUG
    if (!this.logsContainer) {
      console.error('Cannot render - logsContainer missing');
      return;
    }
    if (logs.length === 0) {
      this.logsContainer.innerHTML =
        '<p class="no-logs">No attendance logs today</p>';
      return;
    }

    this.logsContainer.innerHTML = logs
      .map((log) => {
        const time = new Date(log.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });

        const memberName = log.memberName || 'Unknown';
        const logType =
          log.type === 'check-in'
            ? 'login'
            : log.type === 'check-out'
            ? 'logout'
            : 'UNKNOWN';
        const logTypeClass = logType;
        const icon = logType === 'login' ? '↓' : '↑';

        return `
          <div class="log-item ${logTypeClass}">
            <span class="log-icon">${icon}</span>
            <span class="log-time">${time}</span>
            <span class="log-name">${memberName}</span>
            <span class="log-type">${logType.toUpperCase()}</span>
          </div>
        `;
      })
      .join('');
    console.log('Logs rendered successfully in container'); // DEBUG
  }

  setupAutoRefresh() {
    console.log('Setting up auto-refresh'); // DEBUG
    setInterval(() => {
      this.loadAttendanceLogs();
    }, 30000); // 30s
  }
}

// ✅ Initialize when DOM ready (after unified auth)
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded - initializing AttendanceSystem'); // DEBUG
  const ok = requireAuth('admin', '../admin-login.html');
  if (!ok) return;
  new AttendanceSystem();
});
