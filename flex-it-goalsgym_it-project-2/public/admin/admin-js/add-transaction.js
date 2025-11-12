const SERVER_URL = 'http://localhost:8080';
let selectedMember = null;
let searchTimeout = null;

document.addEventListener('DOMContentLoaded', async function () {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    // Check valid session (1 hour expiration)
    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
        return;
    }

    // Toggle sidebar on smaller screens
    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // Logout handler
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });

    // Prevent body scroll when sidebar is open on mobile
    sidebar.addEventListener('transitionend', () => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
    });

    await checkServerConnection();
    setupEventListeners();
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
    }
}

function setupEventListeners() {
    // Member search with debounce
    document.getElementById('memberSearch').addEventListener('input', function (e) {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            hideSearchResults();
            return;
        }

        document.getElementById('searchLoading').classList.remove('hidden');

        searchTimeout = setTimeout(async () => {
            await searchMembers(query);
        }, 300);
    });

    // Form inputs to enable button
    const formInputs = document.querySelectorAll('#transactionForm input, #transactionForm select, #transactionForm textarea');
    formInputs.forEach(input => {
        input.addEventListener('input', checkFormCompletion);
    });

    // Click outside to close search results
    document.addEventListener('click', function (e) {
        if (!e.target.closest('#memberSearch') && !e.target.closest('#searchResults')) {
            hideSearchResults();
        }
    });
}

async function searchMembers(query) {
    try {
        const response = await fetch(`${SERVER_URL}/api/members/search?query=${encodeURIComponent(query)}`);
        const resultsDiv = document.getElementById('searchResults');
        document.getElementById('searchLoading').classList.add('hidden');

        if (response.ok) {
            const result = await response.json();

            if (result.success && result.data && result.data.length > 0) {
                resultsDiv.innerHTML = '';
                result.data.forEach(member => {
                    const div = document.createElement('div');
                    div.className = 'member-result';

                    const memberId = member.memberId || member.member_id || 'N/A';
                    const name = member.name || 'Unknown';
                    const email = member.email || 'No email';

                    let membershipTypes = 'No membership';
                    if (member.memberships && Array.isArray(member.memberships)) {
                        membershipTypes = member.memberships.map(m => m.type).join(', ');
                    } else if (member.type) {
                        membershipTypes = member.type;
                    }

                    div.innerHTML = `
                                <strong>${name}</strong> (${memberId})<br>
                                <small>${email} • ${membershipTypes}</small>
                            `;
                    div.onclick = () => selectMember(member);
                    resultsDiv.appendChild(div);
                });
                resultsDiv.classList.remove('hidden');
            } else {
                resultsDiv.innerHTML = '<div class="member-result">No members found</div>';
                resultsDiv.classList.remove('hidden');
            }
        } else {
            throw new Error('Search failed');
        }
    } catch (error) {
        console.error('Search error:', error);
        showError('Failed to search members');
        hideSearchResults();
    }
}

function hideSearchResults() {
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('searchLoading').classList.add('hidden');
}

function selectMember(member) {
    selectedMember = member;

    const memberId = member.memberId || member.member_id || member._id || 'N/A';
    const name = member.name || 'Unknown';
    const email = member.email || 'No email';

    let membershipTypes = 'No membership';
    if (member.memberships && Array.isArray(member.memberships)) {
        membershipTypes = member.memberships.map(m => m.type).join(', ');
    }

    if (memberId === 'N/A') {
        showError('Selected member does not have a valid ID.');
        return;
    }

    document.getElementById('memberName').textContent = name;
    document.getElementById('memberId').textContent = memberId;
    document.getElementById('memberEmail').textContent = email;
    document.getElementById('memberType').textContent = membershipTypes;
    document.getElementById('selectedMember').classList.remove('hidden');

    hideSearchResults();
    document.getElementById('memberSearch').value = '';

    document.getElementById('transactionForm').classList.remove('hidden');
    checkFormCompletion();

    document.getElementById('step1').classList.add('active');
    document.getElementById('step2').classList.add('active');
    document.getElementById('step3').classList.remove('active');
}

function clearMemberSelection() {
    selectedMember = null;
    document.getElementById('selectedMember').classList.add('hidden');
    document.getElementById('transactionForm').classList.add('hidden');
    document.getElementById('addTransactionButton').disabled = true;

    document.getElementById('step2').classList.remove('active');
    document.getElementById('step3').classList.remove('active');
}

function checkFormCompletion() {
    const amount = document.getElementById('amount').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const paymentDate = document.getElementById('paymentDate').value;

    if (selectedMember && amount > 0 && paymentMethod && paymentDate) {
        document.getElementById('addTransactionButton').disabled = false;
        document.getElementById('step3').classList.add('active');
    } else {
        document.getElementById('addTransactionButton').disabled = true;
    }
}

async function addTransaction() {
    if (!selectedMember) {
        showError('Please select a member');
        return;
    }

    const memberId = selectedMember.memberId || selectedMember.member_id || selectedMember._id;
    if (!memberId) {
        showError('Invalid member ID');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    const paymentMethod = document.getElementById('paymentMethod').value;
    const paymentDate = document.getElementById('paymentDate').value;
    const description = document.getElementById('description').value.trim();

    try {
        document.getElementById('addTransactionButton').disabled = true;
        document.getElementById('addTransactionButton').textContent = 'Adding...';

        const response = await fetch(`${SERVER_URL}/api/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                member_id: memberId,
                amount,
                payment_method: paymentMethod,
                payment_date: paymentDate,
                description: description || undefined
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showTransactionResult('success', `Transaction added successfully for ${selectedMember.name}. ID: ${result.data.transaction_id}`);
        } else {
            showTransactionResult('error', result.error || 'Failed to add transaction');
        }
    } catch (error) {
        console.error('Transaction error:', error);
        showTransactionResult('error', 'Failed to add transaction: ' + error.message);
    } finally {
        document.getElementById('addTransactionButton').disabled = false;
        document.getElementById('addTransactionButton').textContent = 'Add Transaction';
    }
}

function showTransactionResult(type, message) {
    const resultDiv = document.getElementById('resultMessage');
    resultDiv.className = type;
    resultDiv.textContent = message;

    document.getElementById('confirmationAction').classList.add('hidden');
    document.getElementById('transactionResult').classList.remove('hidden');
}

function resetForm() {
    selectedMember = null;

    document.getElementById('selectedMember').classList.add('hidden');
    document.getElementById('transactionForm').classList.add('hidden');
    document.getElementById('amount').value = '';
    document.getElementById('paymentMethod').value = '';
    document.getElementById('paymentDate').value = '';
    document.getElementById('description').value = '';
    document.getElementById('transactionResult').classList.add('hidden');
    document.getElementById('confirmationAction').classList.remove('hidden');
    document.getElementById('addTransactionButton').disabled = true;
    document.getElementById('memberSearch').value = '';

    document.getElementById('step1').classList.add('active');
    document.getElementById('step2').classList.remove('active');
    document.getElementById('step3').classList.remove('active');

    hideMessages();
}

function showError(message) {
    const element = document.getElementById('errorMessage');
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => { element.classList.add('hidden'); }, 5000);
}

function hideMessages() {
    document.getElementById('errorMessage').classList.add('hidden');
    document.getElementById('successMessage').classList.add('hidden');
}