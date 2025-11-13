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

const SERVER_URL = 'http://localhost:8080';
let selectedMember = null;
let searchTimeout = null;

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

  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  // Toggle sidebar on smaller screens
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  // Logout handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../admin-login.html';
    });
  }

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
      sidebar.classList.remove('collapsed');
    }
  });

  // Prevent body scroll when sidebar is open on mobile
  if (sidebar) {
    sidebar.addEventListener('transitionend', () => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = 'auto';
      }
    });
  }

  await checkServerConnection();
  setupEventListeners();
});

async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;
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
  const memberSearch = document.getElementById('memberSearch');
  if (memberSearch) {
    // Member search with debounce
    memberSearch.addEventListener('input', function (e) {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();

      if (query.length < 2) {
        hideSearchResults();
        return;
      }

      const searchLoading = document.getElementById('searchLoading');
      if (searchLoading) searchLoading.classList.remove('hidden');

      searchTimeout = setTimeout(async () => {
        await searchMembers(query);
      }, 300);
    });
  }

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
  const resultsDiv = document.getElementById('searchResults');
  const searchLoading = document.getElementById('searchLoading');
  if (!resultsDiv || !searchLoading) return;
  try {
    // Secure GET with apiFetch
    const result = await apiFetch(`/api/members/search?query=${encodeURIComponent(query)}`);
    searchLoading.classList.add('hidden');

    if (!result.success || !result.data || result.data.length === 0) {
      resultsDiv.innerHTML = '<div class="member-result">No members found</div>';
      resultsDiv.classList.remove('hidden');
      return;
    }

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
  } catch (error) {
    console.error('Search error:', error);
    searchLoading.classList.add('hidden');
    showError('Failed to search members');
    hideSearchResults();
  }
}

function hideSearchResults() {
  const searchResults = document.getElementById('searchResults');
  const searchLoading = document.getElementById('searchLoading');
  if (searchResults) searchResults.classList.add('hidden');
  if (searchLoading) searchLoading.classList.add('hidden');
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

  const memberNameEl = document.getElementById('memberName');
  const memberIdEl = document.getElementById('memberId');
  const memberEmailEl = document.getElementById('memberEmail');
  const memberTypeEl = document.getElementById('memberType');
  const selectedMemberEl = document.getElementById('selectedMember');
  const transactionForm = document.getElementById('transactionForm');
  if (memberNameEl) memberNameEl.textContent = name;
  if (memberIdEl) memberIdEl.textContent = memberId;
  if (memberEmailEl) memberEmailEl.textContent = email;
  if (memberTypeEl) memberTypeEl.textContent = membershipTypes;
  if (selectedMemberEl) selectedMemberEl.classList.remove('hidden');

  hideSearchResults();
  const memberSearch = document.getElementById('memberSearch');
  if (memberSearch) memberSearch.value = '';

  if (transactionForm) transactionForm.classList.remove('hidden');
  checkFormCompletion();

  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  if (step1) step1.classList.add('active');
  if (step2) step2.classList.add('active');
  if (step3) step3.classList.remove('active');
}

function clearMemberSelection() {
  selectedMember = null;
  const selectedMemberEl = document.getElementById('selectedMember');
  const transactionForm = document.getElementById('transactionForm');
  const addTransactionButton = document.getElementById('addTransactionButton');
  if (selectedMemberEl) selectedMemberEl.classList.add('hidden');
  if (transactionForm) transactionForm.classList.add('hidden');
  if (addTransactionButton) addTransactionButton.disabled = true;

  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  if (step2) step2.classList.remove('active');
  if (step3) step3.classList.remove('active');
}

function checkFormCompletion() {
  const amountEl = document.getElementById('amount');
  const paymentMethodEl = document.getElementById('paymentMethod');
  const paymentDateEl = document.getElementById('paymentDate');
  const addTransactionButton = document.getElementById('addTransactionButton');
  const step3 = document.getElementById('step3');
  if (!amountEl || !paymentMethodEl || !paymentDateEl || !addTransactionButton || !step3) return;

  const amount = parseFloat(amountEl.value);
  const paymentMethod = paymentMethodEl.value;
  const paymentDate = paymentDateEl.value;

  if (selectedMember && amount > 0 && paymentMethod && paymentDate) {
    addTransactionButton.disabled = false;
    step3.classList.add('active');
  } else {
    addTransactionButton.disabled = true;
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

  const amountEl = document.getElementById('amount');
  const paymentMethodEl = document.getElementById('paymentMethod');
  const paymentDateEl = document.getElementById('paymentDate');
  const descriptionEl = document.getElementById('description');
  const addTransactionButton = document.getElementById('addTransactionButton');
  if (!amountEl || !paymentMethodEl || !paymentDateEl || !addTransactionButton) return;

  const amount = parseFloat(amountEl.value);
  const paymentMethod = paymentMethodEl.value;
  const paymentDate = paymentDateEl.value;
  const description = descriptionEl ? descriptionEl.value.trim() : '';

  try {
    addTransactionButton.disabled = true;
    addTransactionButton.textContent = 'Adding...';

    // Secure POST with apiFetch
    const result = await apiFetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        member_id: memberId,
        amount,
        payment_method: paymentMethod,
        payment_date: paymentDate,
        description: description || undefined
      })
    });

    if (result.success) {
      showTransactionResult('success', `Transaction added successfully for ${selectedMember.name}. ID: ${result.data.transaction_id}`);
    } else {
      showTransactionResult('error', result.error || 'Failed to add transaction');
    }
  } catch (error) {
    console.error('Transaction error:', error);
    showTransactionResult('error', 'Failed to add transaction: ' + error.message);
  } finally {
    addTransactionButton.disabled = false;
    addTransactionButton.textContent = 'Add Transaction';
  }
}

function showTransactionResult(type, message) {
  const resultDiv = document.getElementById('resultMessage');
  const confirmationAction = document.getElementById('confirmationAction');
  const transactionResult = document.getElementById('transactionResult');
  if (resultDiv) {
    resultDiv.className = type;
    resultDiv.textContent = message;
  }
  if (confirmationAction) confirmationAction.classList.add('hidden');
  if (transactionResult) transactionResult.classList.remove('hidden');
}

function resetForm() {
  selectedMember = null;

  const selectedMemberEl = document.getElementById('selectedMember');
  const transactionForm = document.getElementById('transactionForm');
  const amountEl = document.getElementById('amount');
  const paymentMethodEl = document.getElementById('paymentMethod');
  const paymentDateEl = document.getElementById('paymentDate');
  const descriptionEl = document.getElementById('description');
  const transactionResult = document.getElementById('transactionResult');
  const confirmationAction = document.getElementById('confirmationAction');
  const addTransactionButton = document.getElementById('addTransactionButton');
  const memberSearch = document.getElementById('memberSearch');
  if (selectedMemberEl) selectedMemberEl.classList.add('hidden');
  if (transactionForm) transactionForm.classList.add('hidden');
  if (amountEl) amountEl.value = '';
  if (paymentMethodEl) paymentMethodEl.value = '';
  if (paymentDateEl) paymentDateEl.value = '';
  if (descriptionEl) descriptionEl.value = '';
  if (transactionResult) transactionResult.classList.add('hidden');
  if (confirmationAction) confirmationAction.classList.remove('hidden');
  if (addTransactionButton) addTransactionButton.disabled = true;
  if (memberSearch) memberSearch.value = '';

  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  if (step1) step1.classList.add('active');
  if (step2) step2.classList.remove('active');
  if (step3) step3.classList.remove('active');

  hideMessages();
}

function showError(message) {
  const element = document.getElementById('errorMessage');
  if (element) {
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => { element.classList.add('hidden'); }, 5000);
  }
}

function hideMessages() {
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  if (errorMessage) errorMessage.classList.add('hidden');
  if (successMessage) successMessage.classList.add('hidden');
}
