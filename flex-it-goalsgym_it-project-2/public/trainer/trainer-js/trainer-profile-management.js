const API_URL = 'http://localhost:8080';
let trainerId = null;
let originalData = {};

document.addEventListener('DOMContentLoaded', async function () {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    // 🔍 DEBUG: Log the raw authUser to diagnose structure
    console.log('=== TRAINER PROFILE AUTH DEBUG ===');
    console.log('Raw authUser from localStorage:', authUser);
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

    if (!authUser || !user || role !== "trainer" || (Date.now() - timestamp > 3600000)) {
        console.log('Auth check failed - logging out');
        localStorage.removeItem('authUser');
        window.location.href = '../trainer-login.html';
        return;
    }

    console.log('Auth check passed! Using user:', user);
    console.log('Extracted trainer ID:', user.trainer_id || user.trainerid || user.trainerId || user.id || user._id);

    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
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

    // ✅ LOAD PROFILE DATA
    await loadProfile();

    // ✅ FORM SUBMISSION
    document.getElementById('profileForm').addEventListener('submit', handleSubmit);
});

// ✅ LOAD TRAINER PROFILE
async function loadProfile() {
    try {
        console.log('🔍 Fetching trainer profile for ID:', trainerId);
        const response = await fetch(`${API_URL}/api/trainers/${trainerId}`);

        if (!response.ok) {
            throw new Error(`Failed to load profile: ${response.status}`);
        }

        const data = await response.json();
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

// ✅ HANDLE FORM SUBMISSION
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

        // ✅ CALL UPDATE-PROFILE ROUTE
        const response = await fetch(`${API_URL}/api/trainers/update-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log('📥 Update response:', result);

        if (!response.ok) {
            throw new Error(result.error || 'Failed to update profile');
        }

        // ✅ SUCCESS
        showMessage('✓ Profile updated successfully!', 'success');

        // FIXED: Update localStorage with new values (handle both wrapped and flattened)
        const storedAuthUser = JSON.parse(localStorage.getItem('authUser'));
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

        localStorage.setItem('authUser', JSON.stringify(storedAuthUser));

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

// ✅ RESET FORM
function resetForm() {
    document.getElementById('username').value = originalData.username;
    document.getElementById('email').value = originalData.email;
    document.getElementById('phone').value = originalData.phone;
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    showMessage('Form reset to original values', 'success');
}

// ✅ SHOW MESSAGE
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