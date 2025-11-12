// ✅ CHECK AUTH (Same as your other pages)
const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
    localStorage.removeItem('authUser');
    window.location.href = '../admin-login.html';
}

// ✅ MENU TOGGLE
document.getElementById('menuToggle').addEventListener('click', function () {
    document.querySelector('.sidebar').classList.toggle('collapsed');
});

// ✅ LOGOUT (Only runs when you click logout button)
document.getElementById('logoutBtn').addEventListener('click', function () {
    localStorage.removeItem('authUser');
    window.location.href = '../admin-login.html';
});

const SERVER_URL = 'http://localhost:8080';
let debounceTimeout;

// Tab elements
const tabActive = document.getElementById('tabActive');
const tabInactive = document.getElementById('tabInactive');
const memberListSection = document.getElementById('memberListSection');
const inactiveListSection = document.getElementById('inactiveListSection');

// Toggle tabs
tabActive.addEventListener('click', () => {
    tabActive.classList.add('active');
    tabInactive.classList.remove('active');
    memberListSection.classList.add('active');
    inactiveListSection.classList.remove('active');
    loadMembersStrict('active'); // strict active only
});
tabInactive.addEventListener('click', async () => {
    tabInactive.classList.add('active');
    tabActive.classList.remove('active');
    inactiveListSection.classList.add('active');
    memberListSection.classList.remove('active');
    await loadMembersStrict('inactive'); // strict inactive only
});

document.addEventListener('DOMContentLoaded', async function () {
    await checkServerConnection();
    await loadMembersStrict('active'); // default to active-only on first load
    setupSearchListener();
    document.getElementById('status_filter').addEventListener('change', () => {
        // When on Active tab, enforce active-only unless user explicitly changes filter to something else
        const currentTab = tabActive.classList.contains('active') ? 'active' : 'inactive';
        if (currentTab === 'active') {
            loadMembersStrict('active');
        } else {
            loadMembersStrict('inactive');
        }
    });
});

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
        console.error('Server connection error:', error);
    }
}

function setupSearchListener() {
    const searchInput = document.getElementById('member_search');
    searchInput.addEventListener('input', debounce(searchMembersStrict, 300));
}

function debounce(func, wait) {
    return function (...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Strict search that filters results by current tab's status
async function searchMembersStrict() {
    const query = document.getElementById('member_search').value.trim();
    const suggestions = document.getElementById('autocompleteSuggestions');
    const memberListBody = document.getElementById('memberListBody');
    const errorMessage = document.getElementById('errorMessage');

    suggestions.innerHTML = '';
    suggestions.style.display = 'none';

    const currentTab = tabActive.classList.contains('active') ? 'active' : 'inactive';

    if (query.length < 2) {
        await loadMembersStrict(currentTab);
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/members/search?query=${encodeURIComponent(query)}`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        const result = await response.json();

        // Apply strict status filter client-side to search results
        const data = Array.isArray(result.data) ? result.data.filter(m => (m.status || 'active') === currentTab) : [];

        if (data.length > 0) {
            suggestions.style.display = 'block';
            data.forEach(member => {
                const suggestion = document.createElement('div');
                suggestion.className = 'autocomplete-suggestion';
                suggestion.textContent = `${member.name} (${member.memberId})`;
                suggestion.onclick = () => selectMember(member.memberId, member.name);
                suggestions.appendChild(suggestion);
            });

            if (currentTab === 'active') {
                displayMembersActive(data);
            } else {
                displayMembersInactive(data);
            }
        } else {
            if (currentTab === 'active') {
                memberListBody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
            } else {
                const tbody = document.getElementById('inactiveListBody');
                tbody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error searching members:', error);
        if (currentTab === 'active') {
            memberListBody.innerHTML = '<tr><td colspan="7">Error loading members</td></tr>';
        } else {
            const tbody = document.getElementById('inactiveListBody');
            tbody.innerHTML = '<tr><td colspan="7">Error loading members</td></tr>';
        }
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
}

function selectMember(memberId, memberName) {
    document.getElementById('member_search').value = memberName;
    document.getElementById('autocompleteSuggestions').style.display = 'none';
    // Narrow search by ID while respecting strict status
    searchMembersStrict();
}

// Strict loader by status tab
async function loadMembersStrict(strictStatus) {
    if (strictStatus === 'inactive') {
        await loadInactiveMembers();
        return;
    }
    // active tab
    const memberListBody = document.getElementById('memberListBody');
    const errorMessage = document.getElementById('errorMessage');

    memberListBody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    try {
        const response = await fetch(`${SERVER_URL}/api/members?status=active`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        const result = await response.json();

        const data = Array.isArray(result.data) ? result.data.filter(m => (m.status || 'active') === 'active') : [];
        if (data.length > 0) {
            displayMembersActive(data);
        } else {
            memberListBody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
        }
    } catch (error) {
        console.error('Error loading members:', error);
        memberListBody.innerHTML = '<tr><td colspan="7">Error loading members</td></tr>';
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
}

function displayMembersActive(members) {
    const memberListBody = document.getElementById('memberListBody');
    memberListBody.innerHTML = '';

    // Enforce strict active-only rendering
    const filtered = members.filter(m => (m.status || 'active') === 'active');

    filtered.forEach(member => {
        const memberships = (member.memberships || []).map(m => {
            const durationLabel = m.type === 'combative' ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
            return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(m.endDate).toLocaleDateString()})`;
        }).join(', ');
        const row = document.createElement('tr');
        row.innerHTML = `
        <td>${member.memberId}</td>
        <td>${member.name}</td>
        <td>${member.phone || '-'}</td>
        <td>${member.email || '-'}</td>
        <td>${memberships || 'None'}</td>
        <td>${member.status}</td>
        <td>
          <button class="action-button" onclick='editMember(${JSON.stringify(member)})'>Edit</button>
          <button class="archive-button" onclick="archiveMember('${member.memberId}', 'inactive')">Archive</button>
        </td>
      `;
        memberListBody.appendChild(row);
    });

    if (filtered.length === 0) {
        memberListBody.innerHTML = '<tr><td colspan="7">No members found</td></tr>';
    }
}

// Inactive list handling (strict)
async function loadInactiveMembers() {
    const tbody = document.getElementById('inactiveListBody');
    const errorMessage = document.getElementById('errorMessage');

    tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    try {
        const response = await fetch(`${SERVER_URL}/api/members?status=inactive`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        const result = await response.json();

        const data = Array.isArray(result.data) ? result.data.filter(m => (m.status || 'active') === 'inactive') : [];

        tbody.innerHTML = '';
        if (data.length > 0) {
            displayMembersInactive(data);
        } else {
            tbody.innerHTML = '<tr><td colspan="7">No inactive members</td></tr>';
        }
    } catch (error) {
        console.error('Error loading inactive members:', error);
        tbody.innerHTML = '<tr><td colspan="7">Error loading inactive members</td></tr>';
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
}

function displayMembersInactive(members) {
    const tbody = document.getElementById('inactiveListBody');
    tbody.innerHTML = '';

    // Enforce strict inactive-only rendering
    const filtered = members.filter(m => (m.status || 'active') === 'inactive');

    filtered.forEach(member => {
        const memberships = (member.memberships || []).map(m => {
            const durationLabel = m.type === 'combative' ? `${m.remainingSessions || m.duration} sessions` : `${m.duration} months`;
            return `${m.type} (${m.status}, ${durationLabel}, ends ${new Date(m.endDate).toLocaleDateString()})`;
        }).join(', ');

        const row = document.createElement('tr');
        row.innerHTML = `
        <td>${member.memberId}</td>
        <td>${member.name}</td>
        <td>${member.phone || '-'}</td>
        <td>${member.email || '-'}</td>
        <td>${memberships || 'None'}</td>
        <td>${member.status}</td>
        <td>
          <button class="action-button" onclick="setStatus('${member.memberId}', 'active')">Activate</button>
        </td>
      `;
        tbody.appendChild(row);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No inactive members</td></tr>';
    }
}

async function setStatus(memberId, status) {
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');
    try {
        const response = await fetch(`${SERVER_URL}/api/members/${memberId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify({ status })
        });
        const result = await response.json();
        if (response.ok) {
            successMessage.textContent = result.message || 'Status updated';
            successMessage.style.display = 'block';
            setTimeout(() => successMessage.style.display = 'none', 4000);
            // Refresh the current tab strictly
            const currentTab = tabActive.classList.contains('active') ? 'active' : 'inactive';
            await loadMembersStrict(currentTab);
        } else {
            errorMessage.textContent = result.error || 'Failed to update status';
            errorMessage.style.display = 'block';
            setTimeout(() => errorMessage.style.display = 'none', 5000);
        }
    } catch (error) {
        console.error('Error updating status:', error);
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
}

async function archiveMember(memberId, status) {
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    try {
        const response = await fetch(`${SERVER_URL}/api/members/${memberId}/archive`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify({ status })
        });
        const result = await response.json();

        if (response.ok) {
            successMessage.textContent = result.message;
            successMessage.style.display = 'block';
            setTimeout(() => successMessage.style.display = 'none', 5000);
            await loadMembersStrict('active'); // stay strict on active tab after archive
        } else {
            errorMessage.textContent = result.error || 'Failed to archive member';
            errorMessage.style.display = 'block';
            setTimeout(() => errorMessage.style.display = 'none', 5000);
        }
    } catch (error) {
        console.error('Error archiving member:', error);
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
}

// Edit flow unchanged
function editMember(member) {
    document.getElementById('memberListSection').classList.remove('active');
    document.getElementById('editMemberSection').classList.add('active');

    document.getElementById('edit_member_id').value = member.memberId;
    document.getElementById('edit_name').value = member.name;
    document.getElementById('edit_phone').value = member.phone || '';
    document.getElementById('edit_email').value = member.email || '';

    const membershipsContainer = document.getElementById('membershipsContainer');
    membershipsContainer.innerHTML = '';

    if (member.memberships && member.memberships.length > 0) {
        member.memberships.forEach((membership, index) => {
            addMembershipField(membership, index);
        });
    } else {
        addMembershipField();
    }
}

function addMembershipField(membership = null, index = document.getElementById('membershipsContainer').children.length) {
    const membershipsContainer = document.getElementById('membershipsContainer');
    const membershipDiv = document.createElement('div');
    membershipDiv.className = 'membership-container';
    const durationLabel = membership && membership.type === 'combative' ? 'Sessions' : 'Months';
    membershipDiv.innerHTML = `
      <h4>Membership ${index + 1}</h4>
      <div class="form-group">
        <label for="membership_type_${index}">Type:</label>
        <select id="membership_type_${index}" name="memberships[${index}][type]" required onchange="updateDurationLabel(${index})">
          <option value="monthly" ${membership && membership.type === 'monthly' ? 'selected' : ''}>Monthly</option>
          <option value="combative" ${membership && membership.type === 'combative' ? 'selected' : ''}>Combative</option>
        </select>
      </div>
      <div class="form-group">
        <label for="membership_duration_${index}">${durationLabel}:</label>
        <input type="number" id="membership_duration_${index}" name="memberships[${index}][duration]" value="${membership ? (membership.remainingSessions || membership.duration) : ''}" min="1" required>
      </div>
      <div class="form-group">
        <label for="membership_start_date_${index}">Start Date:</label>
        <input type="date" id="membership_start_date_${index}" name="memberships[${index}][startDate]" value="${membership ? new Date(membership.startDate).toISOString().split('T')[0] : ''}">
      </div>
      <div class="form-group">
        <label for="membership_status_${index}">Status:</label>
        <select id="membership_status_${index}" name="memberships[${index}][status]">
          <option value="active" ${membership && membership.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${membership && membership.status === 'inactive' ? 'selected' : ''}>Inactive</option>
          <option value="suspended" ${membership && membership.status === 'suspended' ? 'selected' : ''}>Suspended</option>
          <option value="expired" ${membership && membership.status === 'expired' ? 'selected' : ''}>Expired</option>
        </select>
      </div>
      <button type="button" class="archive-button" onclick="this.parentElement.remove()">Remove Membership</button>
    `;
    membershipsContainer.appendChild(membershipDiv);
}

function updateDurationLabel(index) {
    const typeSelect = document.getElementById(`membership_type_${index}`);
    const durationLabel = document.getElementById(`membership_duration_${index}`).previousElementSibling;
    durationLabel.textContent = typeSelect.value === 'combative' ? 'Sessions:' : 'Months:';
}

document.getElementById('editMemberForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const memberId = formData.get('member_id');
    const name = formData.get('name').trim();
    const phone = formData.get('phone').trim();
    const email = formData.get('email').trim().toLowerCase();
    const memberships = [];

    document.querySelectorAll('.membership-container').forEach((container, index) => {
        const type = document.getElementById(`membership_type_${index}`).value;
        const duration = parseInt(document.getElementById(`membership_duration_${index}`).value);
        const startDate = document.getElementById(`membership_start_date_${index}`).value;
        const status = document.getElementById(`membership_status_${index}`).value;

        if (type && duration) {
            const membership = { type, duration, status };
            if (startDate) membership.startDate = startDate;
            memberships.push(membership);
        }
    });

    const updateData = { name };
    if (phone) updateData.phone = phone;
    if (email) updateData.email = email;
    if (memberships.length > 0) updateData.memberships = memberships;

    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    try {
        const response = await fetch(`${SERVER_URL}/api/members/${memberId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify(updateData)
        });
        const result = await response.json();

        if (response.ok) {
            successMessage.textContent = result.message;
            successMessage.style.display = 'block';
            setTimeout(() => successMessage.style.display = 'none', 5000);
            showMemberList();
            loadMembersStrict('active');
        } else {
            errorMessage.textContent = result.error || 'Failed to update member';
            errorMessage.style.display = 'block';
            setTimeout(() => errorMessage.style.display = 'none', 5000);
        }
    } catch (error) {
        console.error('Error updating member:', error);
        errorMessage.textContent = 'Network error: ' + error.message;
        errorMessage.style.display = 'block';
        setTimeout(() => errorMessage.style.display = 'none', 5000);
    }
});

function showMemberList() {
    document.getElementById('editMemberSection').classList.remove('active');
    document.getElementById('memberListSection').classList.add('active');
    document.getElementById('member_search').value = '';
    document.getElementById('autocompleteSuggestions').style.display = 'none';
    loadMembersStrict('active');
}