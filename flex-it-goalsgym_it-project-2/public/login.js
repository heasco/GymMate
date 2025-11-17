// login.js - Universal secure login handler with single-session support
// Now role-aware per login page using data-login-role on <body>

const loginForm = document.getElementById('loginForm');
const errorDiv = document.getElementById('errorMessage');

let failedAttempts = 0;
let isLocked = false;

const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 30; // seconds

// Helper to read current page role safely (admin / trainer / member)
function getPageRole() {
  const body = document.body;
  if (!body || !body.dataset) return null;
  return body.dataset.loginRole || null;
}

// Basic input sanitizer
function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[$]/g, '').replace(/\./g, '');
}

// Auto-redirect if already logged in in this browser
function redirectIfAlreadyLoggedIn() {
  try {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    const authUserRaw = localStorage.getItem('authUser');

    if (!token || !role || !authUserRaw) return;

    const authUser = JSON.parse(authUserRaw);

    // Basic expiration check: 2 hours
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    if (!authUser.timestamp || Date.now() - authUser.timestamp > TWO_HOURS) {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');
      return;
    }

    const PAGE_ROLE = getPageRole();

    // Only auto-redirect if the current page is for this role.
    // This fixes: visiting member-login.html while logged in as admin.
    if (PAGE_ROLE && role !== PAGE_ROLE) {
      // Different role than this login page; do NOT auto-redirect.
      // User can choose to log in as a different role.
      return;
    }

    // Role matches the login page (or PAGE_ROLE is not set) - auto-redirect.
    if (role === 'admin') {
      window.location.href = './admin/admin-mainpage.html';
    } else if (role === 'trainer') {
      window.location.href = './trainer/trainer-mainpage.html';
    } else if (role === 'member') {
      window.location.href = './member/member-dashboard.html';
    }
  } catch (e) {
    console.error('Auto-login check failed:', e);
  }
}

// Lockout logic for repeated failed attempts
function lockout() {
  isLocked = true;
  if (errorDiv) {
    errorDiv.textContent = `Too many failed attempts. Please wait ${LOCKOUT_TIME} seconds.`;
  }
  const btn = loginForm ? loginForm.querySelector('.login-button') : null;
  if (btn) btn.disabled = true;

  setTimeout(() => {
    isLocked = false;
    failedAttempts = 0;
    if (errorDiv) errorDiv.textContent = '';
    if (btn) btn.disabled = false;
  }, LOCKOUT_TIME * 1000);
}

// Run auto-redirect on page load
redirectIfAlreadyLoggedIn();

if (loginForm) {
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (isLocked) return;

    if (errorDiv) errorDiv.textContent = '';

    const username = sanitize(loginForm.username.value);
    const password = sanitize(loginForm.password.value);
    const role = sanitize(loginForm.role.value);

    if (!username || !password || !role) {
      if (errorDiv) errorDiv.textContent = 'All fields are required.';
      return;
    }

    const btn = loginForm.querySelector('.login-button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Logging in...';
    }

    try {
      const apiUrl =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
          ? 'http://localhost:8080/api/login'
          : '/api/login';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        const token = result.token;

        // Store token & user in localStorage to share across tabs
        localStorage.setItem('token', token);

        const authData = {
          ...result.user,
          timestamp: Date.now(),
          role,
          token,
        };

        localStorage.setItem('authUser', JSON.stringify(authData));
        localStorage.setItem('role', role);

        // ALSO mirror to sessionStorage so module pages that use sessionStorage see the login
        sessionStorage.setItem('token', token);
        sessionStorage.setItem('authUser', JSON.stringify(authData));
        sessionStorage.setItem('role', role);

        // Broadcast login event so other tabs can react if needed
        localStorage.setItem('loginEvent', Date.now().toString());

        if (role === 'admin') {
          window.location.href = './admin/admin-mainpage.html';
        } else if (role === 'trainer') {
          window.location.href = './trainer/trainer-mainpage.html';
        } else if (role === 'member') {
          window.location.href = './member/member-dashboard.html';
        } else {
          if (errorDiv) errorDiv.textContent = 'Unknown user role.';
        }
      } else {
        failedAttempts++;

        // Backend now revokes old sessions instead of returning ALREADY_LOGGED_IN,
        // so we just show whatever message it sends (or a generic one).
        if (errorDiv) {
          errorDiv.textContent =
            result.message || 'Login failed. Please check your credentials.';
        }

        if (failedAttempts >= MAX_ATTEMPTS) lockout();
      }
    } catch (err) {
      console.error('Login error:', err);
      if (errorDiv) errorDiv.textContent = 'Network error. Please check your connection.';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Login';
      }
    }
  });
}
