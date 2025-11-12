// login.js - Universal secure login handler for all 3 roles with timestamp
const loginForm = document.getElementById('loginForm');
const errorDiv = document.getElementById('errorMessage');
let failedAttempts = 0;
let isLocked = false;
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 30; // seconds

function sanitize(input) {
  // Remove NoSQL injection characters
  return typeof input === 'string' ? input.replace(/[$.\s]/g, '') : '';
}

function lockout() {
  isLocked = true;
  errorDiv.textContent = `Too many failed attempts. Please wait ${LOCKOUT_TIME} seconds.`;
  const btn = loginForm.querySelector('.login-button');
  if (btn) btn.disabled = true;
  
  setTimeout(() => {
    isLocked = false;
    failedAttempts = 0;
    errorDiv.textContent = '';
    if (btn) btn.disabled = false;
  }, LOCKOUT_TIME * 1000);
}

if (loginForm) {
  loginForm.addEventListener('submit', async function(e) {
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
    
    try {
      const apiUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8080/api/login'
        : '/api/login';
        
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        // Add timestamp to user object for session management
        const authData = {
          ...result.user,
          timestamp: Date.now(), // CRITICAL: Add timestamp
          role: role
        };
        
        // Store auth data with timestamp
        localStorage.setItem('authUser', JSON.stringify(authData));
        
        // Also store individual fields if needed by other pages
        if (result.user.name) {
          localStorage.setItem('memberName', result.user.name);
        }
        
        // Redirect based on role
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
        if (errorDiv) errorDiv.textContent = result.message || 'Login failed. Please check your credentials.';
        if (failedAttempts >= MAX_ATTEMPTS) lockout();
      }
    } catch (err) {
      console.error('Login error:', err);
      if (errorDiv) errorDiv.textContent = 'Network error. Please check your connection.';
    }
  });
}
