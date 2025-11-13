// Utility for authenticated API calls (adds security header for /api/ routes)
async function apiFetch(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }

  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `http://localhost:8080${endpoint}`
    : endpoint;

  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json' // Default for this file's JSON calls
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token || role !== 'admin') {
    window.location.href = '../admin-login.html';
    return;
  }
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || '{}');
  if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../admin-login.html';
    return;
  }

  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../admin-login.html';
    });
  }

  // Mobile sidebar click outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
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

  const specializationSelect = document.getElementById('specialization');
  if (specializationSelect) {
    specializationSelect.addEventListener('change', function () {
      const customField = document.getElementById('custom_specialization');
      const customLabel = document.getElementById('custom_label');
      if (this.value === 'Other') {
        if (customField) customField.style.display = 'block';
        if (customLabel) customLabel.style.display = 'block';
        if (customField) customField.required = true;
      } else {
        if (customField) customField.style.display = 'none';
        if (customLabel) customLabel.style.display = 'none';
        if (customField) {
          customField.required = false;
          customField.value = '';
        }
      }
    });
  }

  const trainerForm = document.getElementById('trainerForm');
  if (trainerForm) {
    trainerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submitBtn = document.querySelector('.add-trainer-button');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';
      }

      try {
        let specialization = document.getElementById('specialization').value;
        if (specialization === 'Other') {
          specialization = document.getElementById('custom_specialization').value.trim();
        }
        const assignedClassesInput = document.getElementById('assigned_classes').value.trim();
        const assignedClasses = assignedClassesInput
          ? assignedClassesInput.split(',').map((cls) => cls.trim()).filter(Boolean)
          : [];
        const email = document.getElementById('email').value.trim();
        const sendEmailVal = document.querySelector('input[name="send_email"]:checked').value;
        const send_email = (sendEmailVal === "yes");

        const trainerData = {
          name: document.getElementById('name').value.trim(),
          email: email,
          specialization: specialization,
          is_available: document.getElementById('is_available').checked,
          assigned_classes: assignedClasses,
          send_email: send_email
        };

        // Secure POST with apiFetch (JSON body)
        const responseData = await apiFetch('/api/trainers', {
          method: 'POST',
          body: JSON.stringify(trainerData)
        });

        let emailMsg = '';
        if (send_email) {
          emailMsg = 'An email was sent to the trainer.\n';
        } else {
          emailMsg = 'No email was sent to the trainer. Please provide the credentials manually.\n';
        }

        alert(`Trainer added successfully!\nUsername: ${responseData.data.username}\nTemporary Password: ${responseData.data.tempPassword}\n${emailMsg}Trainer should change password upon first login.\nTrainer ID: ${responseData.data.trainer_id}\nName: ${responseData.data.name}`);
        this.reset();
        const customField = document.getElementById('custom_specialization');
        const customLabel = document.getElementById('custom_label');
        if (customField) customField.style.display = 'none';
        if (customLabel) customLabel.style.display = 'none';
      } catch (err) {
        console.error('Error:', err);
        let errorMsg = 'Failed to add trainer';
        if (err.message.includes('API error')) {
          // For non-JSON errors, but since apiFetch parses JSON, handle as before if needed
          errorMsg = err.message;
        } else if (err.details) {
          errorMsg +=
            ':\n' +
            Object.entries(err.details)
              .filter(([_, value]) => value)
              .map(([field, error]) => `• ${field}: ${error}`)
              .join('\n');
        } else if (err.error) {
          errorMsg = err.error;
        }
        alert(`Error: ${errorMsg}`);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Add Trainer';
        }
      }
    });
  }
});
