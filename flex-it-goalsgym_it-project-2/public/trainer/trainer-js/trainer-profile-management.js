// Utility for authenticated API calls (adds security header for /api/ routes) with timeout - Handles full URLs, GET/POST
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint, 'method:', options.method || 'GET');  // DEBUG (remove in production if needed)
  const token = sessionStorage.getItem('token');
  if (!token) {
    console.log('No token - redirecting to login');  // DEBUG
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../trainer-login.html';
    return;
  }

  // Use endpoint directly if it's already a full URL; otherwise prepend base
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? `http://localhost:8080${endpoint}`
      : endpoint;
  }

  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json' // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      console.log('401 Unauthorized - clearing auth and redirecting');  // DEBUG
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../trainer-login.html';
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

// ✅ INITIAL AUTH CHECK - Token + Role ('trainer') + Timestamp (runs immediately)
(function checkAuth() {
  console.log('Auth check starting for trainer-profile');  // DEBUG
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null'); 
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  
  console.log('Auth details:', { authUser: authUser ? (authUser.username || authUser.email || authUser.name) : null, token: !!token, role });  // DEBUG: Hide sensitive data
  
  // Check timestamp (1 hour) + token + trainer role
  if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000 || !token || role !== 'trainer') { 
    console.log('Auth failed - clearing and redirecting');  // DEBUG
    sessionStorage.removeItem('authUser'); 
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../trainer-login.html'; 
    return;
  } 
  
  console.log('Trainer authenticated:', authUser.username || authUser.email || authUser.name, 'Role:', role);
})();

const API_URL = 'http://localhost:8080';
let trainerId = null;
let originalData = {};

document.addEventListener('DOMContentLoaded', async function () {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(sessionStorage.getItem('authUser'));


    // 🔍 DEBUG: Log the raw authUser to diagnose structure
    console.log('=== TRAINER PROFILE AUTH DEBUG ===');
    console.log('Raw authUser from sessionStorage:', authUser);
    if (authUser) {
        console.log('authUser keys:', Object.keys(authUser));
        console.log('authUser.role:', authUser.role);
        console.log('authUser.timestamp:', authUser.timestamp);
        console.log('authUser.user exists?', !!authUser.user);
        if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
    }


    // FIXED AUTH CHECK: Support both wrapped (authUser.user) and flattened structures
    const user = authUser?.user || authUser; // Fallback to flattened structure
    const role = authUser?.role;
    const timestamp = authUser?.timestamp || 0;


    // ENHANCED: Token + role + timestamp check (in addition to existing check)
    const token = sessionStorage.getItem('token');
    if (!authUser || !user || role !== "trainer" || (Date.now() - timestamp > 3600000) || !token) {
        console.log('Auth check failed - logging out');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('role');
        window.location.href = '../trainer-login.html';
        return;
    }


    console.log('Auth check passed! Using user:', user);
    console.log('Extracted trainer ID:', user.trainer_id || user.trainerid || user.trainerId || user.id || user._id);


    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));


    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        // ENHANCED: Clear token + role
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('role');
        window.location.href = '../trainer-login.html';
    });


    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });


    // ✅ GET TRAINER ID from extracted user with multiple fallbacks
    trainerId = user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;


    if (!trainerId) {
        showMessage('Error: Unable to identify trainer', 'error');
        console.error('Auth user object:', authUser);
        return;
    }


    console.log('✅ Trainer ID:', trainerId);


    // ENHANCED: Token + role check before loading profile
    if (!token || role !== 'trainer' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
        console.log('Invalid session before API - logging out');  // DEBUG
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('role');
        window.location.href = '../trainer-login.html';
        return;
    }


    // ✅ LOAD PROFILE DATA
    await loadProfile();


    // ✅ FORM SUBMISSION
    document.getElementById('profileForm').addEventListener('submit', handleSubmit);
});


// ✅ LOAD TRAINER PROFILE (TOKENIZED)
async function loadProfile() {
    try {
        // ENHANCED: Token + role check before API call
        const token = sessionStorage.getItem('token');
        const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null');
        const role = sessionStorage.getItem('role');
        if (!token || role !== 'trainer' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
            console.log('Invalid session in loadProfile - logging out');  // DEBUG
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('authUser');
            sessionStorage.removeItem('role');
            window.location.href = '../trainer-login.html';
            return;
        }


        console.log('🔍 Fetching trainer profile for ID:', trainerId);
        // TOKENIZED: Use apiFetch for GET
        const data = await apiFetch(`${API_URL}/api/trainers/${trainerId}`);


        console.log('📦 API Response:', data);


        const trainer = data.data;


        if (!trainer) {
            throw new Error('Trainer data not found');
        }


        // Store original data
        originalData = {
            username: trainer.username || '',
            email: trainer.email || '',
            phone: trainer.phone || ''
        };


        // ✅ POPULATE FORM with current values
        document.getElementById('username').value = originalData.username;
        document.getElementById('email').value = originalData.email;
        document.getElementById('phone').value = originalData.phone;


        // Remove placeholder text
        document.getElementById('username').placeholder = 'Enter username';
        document.getElementById('email').placeholder = 'your.email@example.com';


        console.log('✅ Profile loaded successfully:', originalData);


    } catch (err) {
        console.error('❌ Error loading profile:', err);
        showMessage(`Failed to load profile: ${err.message}`, 'error');
    }
}


// ✅ HANDLE FORM SUBMISSION (TOKENIZED)
async function handleSubmit(event) {
    event.preventDefault();


    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;


    // ✅ VALIDATE PASSWORD CHANGE (if any password field is filled)
    if (currentPassword || newPassword || confirmPassword) {
        // Check if all password fields are filled
        if (!currentPassword) {
            showMessage("Current password is required to change password.", 'error');
            return;
        }
        if (!newPassword) {
            showMessage("New password is required.", 'error');
            return;
        }
        if (!confirmPassword) {
            showMessage("Please confirm your new password.", 'error');
            return;
        }


        // Check if new passwords match
        if (newPassword !== confirmPassword) {
            showMessage("New password and confirmation do not match.", 'error');
            return;
        }


        // Check minimum length
        if (newPassword.length < 6) {
            showMessage("New password must be at least 6 characters long.", 'error');
            return;
        }
    }


    // ✅ CHECK IF ANY CHANGES WERE MADE
    const hasBasicChanges = username !== originalData.username ||
        email !== originalData.email ||
        phone !== originalData.phone;


    if (!hasBasicChanges && !newPassword) {
        showMessage('No changes to save', 'error');
        return;
    }


    try {
        // ENHANCED: Token + role check before API call
        const token = sessionStorage.getItem('token');
        const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null');
        const role = sessionStorage.getItem('role');
        if (!token || role !== 'trainer' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
            console.log('Invalid session in handleSubmit - logging out');  // DEBUG
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('authUser');
            sessionStorage.removeItem('role');
            window.location.href = '../trainer-login.html';
            return;
        }


        showMessage('Updating profile...', 'info');


        // ✅ BUILD PAYLOAD
        const payload = {
            trainer_id: trainerId,
            username: username,
            email: email,
            phone: phone
        };


        if (currentPassword && newPassword) {
            payload.currentPassword = currentPassword;
            payload.newPassword = newPassword;
        }


        console.log('📤 Sending update:', payload);


        // CALL UPDATE-PROFILE ROUTE (TOKENIZED)
        const result = await apiFetch(`${API_URL}/api/trainers/update-profile`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });


        console.log('📥 Update response:', result);

        if (result.error) {
            throw new Error(result.error || 'Failed to update profile');
        }

        // Sucessfull profile update msg
        showMessage('✓ Profile updated successfully!', 'success');

        // FIXED: Update sessionStorage with new values (handle both wrapped and flattened)
        const storedAuthUser = JSON.parse(sessionStorage.getItem('authUser'));
        const updatedUser = storedAuthUser.user || storedAuthUser; // Extract user part
        updatedUser.username = username;
        updatedUser.email = email;
        updatedUser.phone = phone;


        if (storedAuthUser.user) {
            // Wrapped structure
            storedAuthUser.user = updatedUser;
        } else {
            // Flattened structure
            Object.assign(storedAuthUser, updatedUser);
        }


        sessionStorage.setItem('authUser', JSON.stringify(storedAuthUser));


        // Clear ALL password fields
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';


        // Reload profile after 1 second
        setTimeout(() => {
            loadProfile();
        }, 1000);


    } catch (err) {
        console.error('❌ Error updating profile:', err);
        showMessage(`Error: ${err.message}`, 'error');
    }
}


// RESET FORM
function resetForm() {
    document.getElementById('username').value = originalData.username;
    document.getElementById('email').value = originalData.email;
    document.getElementById('phone').value = originalData.phone;
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    showMessage('Form reset to original values', 'success');
}


// SHOW MESSAGE
function showMessage(message, type) {
    const statusDiv = document.getElementById('profileStatus');
    statusDiv.textContent = message;
    statusDiv.className = `profile-status ${type}`;
    statusDiv.style.display = 'block';


    // Auto-hide after 5 seconds (except for info messages)
    setTimeout(() => {
        if (type !== 'info') {
            statusDiv.style.display = 'none';
        }
    }, 5000);
}
