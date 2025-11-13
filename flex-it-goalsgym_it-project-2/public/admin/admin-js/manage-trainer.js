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
    ? `${SERVER_URL}${endpoint}`
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

const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;

document.addEventListener('DOMContentLoaded', async () => {
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

  setupSidebarAndSession();
  await checkServerConnection();
  await loadTrainers();
  setupTrainerSearch();
});

function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
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
}

async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;
  try {
    // Secure health check (apiFetch handles auth, but /health can bypass in backend)
    const result = await apiFetch('/health');
    statusElement.textContent = 'Connected to server successfully';
    statusElement.className = 'server-status server-connected';
  } catch (error) {
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
    console.error('Server connection error:', error);
  }
}

function setupTrainerSearch() {
  const searchInput = document.getElementById('trainerSearch');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(searchTrainers, 300));
  }
}

function debounce(func, wait) {
  return function (...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function searchTrainers() {
  const query = document.getElementById('trainerSearch')?.value.trim();
  const suggestions = document.getElementById('trainerSuggestions');
  const trainerListBody = document.getElementById('trainerListBody');

  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
  }

  if (!query || query.length < 2) {
    await loadTrainers();
    return;
  }

  try {
    // Secure search with apiFetch (GET, returns {success: true, data: [...])
    const result = await apiFetch(`/api/trainers/search?query=${encodeURIComponent(query)}`);

    if (!result.success) {
      throw new Error(result.error || 'Search failed');
    }

    if (result.data && result.data.length > 0) {
      if (suggestions) {
        suggestions.style.display = 'block';
        result.data.forEach(trainer => {
          const suggestion = document.createElement('div');
          suggestion.className = 'autocomplete-suggestion';
          suggestion.textContent = `${trainer.name} (${trainer.trainer_id})`;
          suggestion.onclick = () => selectTrainer(trainer.trainer_id, trainer.name);
          suggestions.appendChild(suggestion);
        });
      }
      displayTrainers(result.data);
    } else {
      if (trainerListBody) trainerListBody.innerHTML = '<tr><td colspan="6">No trainers found</td></tr>';
    }
  } catch (error) {
    console.error('Error searching trainers:', error);
    if (trainerListBody) trainerListBody.innerHTML = '<tr><td colspan="6">Error loading trainers</td></tr>';
    showMessage('Network error: ' + error.message, 'error');
  }
}

function selectTrainer(trainerId, trainerName) {
  const searchInput = document.getElementById('trainerSearch');
  const suggestions = document.getElementById('trainerSuggestions');
  if (searchInput) searchInput.value = trainerName;
  if (suggestions) suggestions.style.display = 'none';
  loadTrainers(trainerId);
}

async function loadTrainers(filterTrainerId = null) {
  const trainerListBody = document.getElementById('trainerListBody');
  if (!trainerListBody) return;

  let endpoint = '/api/trainers';
  if (filterTrainerId) {
    endpoint = `/api/trainers/search?query=${encodeURIComponent(filterTrainerId)}`;
  }

  try {
    // Secure GET with apiFetch
    const result = await apiFetch(endpoint);

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    trainerListBody.innerHTML = '';

    if (result.data && result.data.length > 0) {
      displayTrainers(result.data);
    } else {
      trainerListBody.innerHTML = '<tr><td colspan="6">No trainers found</td></tr>';
    }
  } catch (error) {
    console.error('Error loading trainers:', error);
    trainerListBody.innerHTML = '<tr><td colspan="6">Error loading trainers</td></tr>';
    showMessage('Network error: ' + error.message, 'error');
  }
}

function displayTrainers(trainers) {
  const trainerListBody = document.getElementById('trainerListBody');
  if (!trainerListBody) return;
  trainerListBody.innerHTML = '';

  trainers.forEach(trainer => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${trainer.trainer_id}</td>
      <td>${trainer.name}</td>
      <td>${trainer.email}</td>
      <td>${trainer.specialization}</td>
      <td>
        <span class="availability-badge ${trainer.is_available ? 'availability-available' : 'availability-unavailable'}">
          ${trainer.is_available ? 'Available' : 'Unavailable'}
        </span>
      </td>
      <td>
        <button class="action-button" onclick='editTrainer(${JSON.stringify(trainer)})'>Edit</button>
      </td>
    `;
    trainerListBody.appendChild(row);
  });
}

function editTrainer(trainer) {
  const trainerListSection = document.getElementById('trainerListSection');
  const editTrainerSection = document.getElementById('editTrainerSection');
  if (trainerListSection) trainerListSection.classList.remove('active');
  if (editTrainerSection) editTrainerSection.classList.add('active');

  document.getElementById('editTrainerId').value = trainer.trainer_id;
  document.getElementById('editName').value = trainer.name;
  document.getElementById('editEmail').value = trainer.email;
  document.getElementById('editSpecialization').value = trainer.specialization;
  document.getElementById('editAvailability').value = trainer.is_available;
}

function showTrainerList() {
  const editTrainerSection = document.getElementById('editTrainerSection');
  const trainerListSection = document.getElementById('trainerListSection');
  const trainerSearch = document.getElementById('trainerSearch');
  const trainerSuggestions = document.getElementById('trainerSuggestions');
  if (editTrainerSection) editTrainerSection.classList.remove('active');
  if (trainerListSection) trainerListSection.classList.add('active');
  if (trainerSearch) trainerSearch.value = '';
  if (trainerSuggestions) trainerSuggestions.style.display = 'none';
  loadTrainers();
}

const editTrainerForm = document.getElementById('editTrainerForm');
if (editTrainerForm) {
  editTrainerForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const trainerId = document.getElementById('editTrainerId').value;
    const name = document.getElementById('editName').value.trim();
    const email = document.getElementById('editEmail').value.trim().toLowerCase();
    const specialization = document.getElementById('editSpecialization').value.trim();
    const is_available = document.getElementById('editAvailability').value === 'true';

    const updateData = { name, email, specialization, is_available };

    try {
      // Secure PUT with apiFetch
      const result = await apiFetch(`/api/trainers/${trainerId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });

      if (result.success) {
        showMessage(result.message || 'Trainer updated successfully', 'success');
        showTrainerList();
        loadTrainers();
      } else {
        throw new Error(result.error || 'Failed to update trainer');
      }
    } catch (error) {
      console.error('Error updating trainer:', error);
      showMessage('Network error: ' + error.message, 'error');
    }
  });
}

function showMessage(message, type) {
  const messageEl = type === 'success' ?
    document.getElementById('successMessage') :
    document.getElementById('errorMessage');

  if (messageEl) {
    messageEl.textContent = message;
    messageEl.style.display = 'block';
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 5000);
  }
}
