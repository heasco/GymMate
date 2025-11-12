const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;

document.addEventListener('DOMContentLoaded', async function () {
    setupSidebarAndSession();
    await checkServerConnection();
    await loadTrainers();
    setupTrainerSearch();
});

// Simple logout function - same as admin-mainpage
function setupSidebarAndSession() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
        return;
    }

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
    });

    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}

async function checkServerConnection() {
    const statusElement = document.getElementById('serverStatus');
    try {
        const response = await fetch(`${SERVER_URL}/health`);
        if (response.ok) {
            statusElement.textContent = 'Connected to server successfully';
            statusElement.className = 'server-status server-connected';
        } else {
            throw new Error('Server response not OK');
        }
    } catch (error) {
        statusElement.textContent = 'Cannot connect to server. Please try again later.';
        statusElement.className = 'server-status server-disconnected';
    }
}

function setupTrainerSearch() {
    const searchInput = document.getElementById('trainerSearch');
    searchInput.addEventListener('input', debounce(searchTrainers, 300));
}

function debounce(func, wait) {
    return function (...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function searchTrainers() {
    const query = document.getElementById('trainerSearch').value.trim();
    const suggestions = document.getElementById('trainerSuggestions');
    const trainerListBody = document.getElementById('trainerListBody');

    suggestions.innerHTML = '';
    suggestions.style.display = 'none';

    if (query.length < 2) {
        loadTrainers();
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/trainers/search?query=${encodeURIComponent(query)}`);
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            suggestions.style.display = 'block';
            result.data.forEach(trainer => {
                const suggestion = document.createElement('div');
                suggestion.className = 'autocomplete-suggestion';
                suggestion.textContent = `${trainer.name} (${trainer.trainer_id})`;
                suggestion.onclick = () => selectTrainer(trainer.trainer_id, trainer.name);
                suggestions.appendChild(suggestion);
            });
            displayTrainers(result.data);
        } else {
            trainerListBody.innerHTML = '<tr><td colspan="6">No trainers found</td></tr>';
        }
    } catch (error) {
        console.error('Error searching trainers:', error);
        trainerListBody.innerHTML = '<tr><td colspan="6">Error loading trainers</td></tr>';
        showMessage('Network error: ' + error.message, 'error');
    }
}

function selectTrainer(trainerId, trainerName) {
    document.getElementById('trainerSearch').value = trainerName;
    document.getElementById('trainerSuggestions').style.display = 'none';
    loadTrainers(trainerId);
}

async function loadTrainers(filterTrainerId = null) {
    const trainerListBody = document.getElementById('trainerListBody');

    let url = `${SERVER_URL}/api/trainers`;
    if (filterTrainerId) {
        url = `${SERVER_URL}/api/trainers/search?query=${encodeURIComponent(filterTrainerId)}`;
    }

    try {
        const response = await fetch(url);
        const result = await response.json();

        trainerListBody.innerHTML = '';

        if (result.success && result.data && result.data.length > 0) {
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
    document.getElementById('trainerListSection').classList.remove('active');
    document.getElementById('editTrainerSection').classList.add('active');

    document.getElementById('editTrainerId').value = trainer.trainer_id;
    document.getElementById('editName').value = trainer.name;
    document.getElementById('editEmail').value = trainer.email;
    document.getElementById('editSpecialization').value = trainer.specialization;
    document.getElementById('editAvailability').value = trainer.is_available;
}

function showTrainerList() {
    document.getElementById('editTrainerSection').classList.remove('active');
    document.getElementById('trainerListSection').classList.add('active');
    document.getElementById('trainerSearch').value = '';
    document.getElementById('trainerSuggestions').style.display = 'none';
    loadTrainers();
}

document.getElementById('editTrainerForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const trainerId = document.getElementById('editTrainerId').value;
    const name = document.getElementById('editName').value.trim();
    const email = document.getElementById('editEmail').value.trim().toLowerCase();
    const specialization = document.getElementById('editSpecialization').value.trim();
    const is_available = document.getElementById('editAvailability').value === 'true';

    const updateData = { name, email, specialization, is_available };

    try {
        const response = await fetch(`${SERVER_URL}/api/trainers/${trainerId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        const result = await response.json();

        if (response.ok) {
            showMessage(result.message || 'Trainer updated successfully', 'success');
            showTrainerList();
            loadTrainers();
        } else {
            showMessage(result.error || 'Failed to update trainer', 'error');
        }
    } catch (error) {
        console.error('Error updating trainer:', error);
        showMessage('Network error: ' + error.message, 'error');
    }
});

function showMessage(message, type) {
    const messageEl = type === 'success' ?
        document.getElementById('successMessage') :
        document.getElementById('errorMessage');

    messageEl.textContent = message;
    messageEl.style.display = 'block';

    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 5000);
}