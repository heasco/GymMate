const SERVER_URL = 'http://localhost:8080';

// --------------------------------------
// Admin session configuration
// --------------------------------------
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Admin-scoped storage keys
const ADMIN_KEYS = {
  token: 'admin_token',
  authUser: 'admin_authUser',
  role: 'admin_role',
  logoutEvent: 'adminLogoutEvent',
};

// --------------------------------------
// Admin storage helpers (namespaced)
// --------------------------------------
const AdminStore = {
  set(token, userPayload) {
    try {
      const authUser = {
        ...(userPayload || {}),
        timestamp: Date.now(),
        role: 'admin',
        token,
      };

      localStorage.setItem(ADMIN_KEYS.token, token);
      localStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      localStorage.setItem(ADMIN_KEYS.role, 'admin');

      sessionStorage.setItem(ADMIN_KEYS.token, token);
      sessionStorage.setItem(ADMIN_KEYS.authUser, JSON.stringify(authUser));
      sessionStorage.setItem(ADMIN_KEYS.role, 'admin');
    } catch (e) {
      console.error('[AdminStore.set] failed:', e);
    }
  },

  getToken() {
    return (
      sessionStorage.getItem(ADMIN_KEYS.token) ||
      localStorage.getItem(ADMIN_KEYS.token) ||
      null
    );
  },

  getAuthUser() {
    const raw =
      sessionStorage.getItem(ADMIN_KEYS.authUser) ||
      localStorage.getItem(ADMIN_KEYS.authUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[AdminStore.getAuthUser] parse error:', e);
      return null;
    }
  },

  hasSession() {
    return (
      (localStorage.getItem(ADMIN_KEYS.token) ||
        sessionStorage.getItem(ADMIN_KEYS.token)) &&
      (localStorage.getItem(ADMIN_KEYS.authUser) ||
        sessionStorage.getItem(ADMIN_KEYS.authUser)) &&
      ((localStorage.getItem(ADMIN_KEYS.role) ||
        sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin')
    );
  },

  clear() {
    localStorage.removeItem(ADMIN_KEYS.token);
    localStorage.removeItem(ADMIN_KEYS.authUser);
    localStorage.removeItem(ADMIN_KEYS.role);

    sessionStorage.removeItem(ADMIN_KEYS.token);
    sessionStorage.removeItem(ADMIN_KEYS.authUser);
    sessionStorage.removeItem(ADMIN_KEYS.role);
  },
};

// ------------------------------
// Shared auth helpers (admin only)
// ------------------------------
function clearLocalAuth() {
  AdminStore.clear();
  try {
    const genericRole =
      localStorage.getItem('role') || sessionStorage.getItem('role');

    if (genericRole === 'admin') {
      localStorage.removeItem('token');
      localStorage.removeItem('authUser');
      localStorage.removeItem('role');

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
    }
  } catch (e) {
    console.error('[clearLocalAuth] failed to clear generic admin keys:', e);
  }
}

function getApiBase() {
  return window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
    ? SERVER_URL
    : '';
}

function adminLogout(reason, loginPath = '../login.html') {
  console.log('[Admin Logout]:', reason || 'no reason');
  clearLocalAuth();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = loginPath;
}

function ensureAdminAuthOrLogout(loginPath) {
  try {
    if (!AdminStore.hasSession()) {
      adminLogout('missing admin session', loginPath);
      return false;
    }

    const authUser = AdminStore.getAuthUser();
    if (!authUser || authUser.role !== 'admin') {
      adminLogout('invalid or non-admin authUser', loginPath);
      return false;
    }

    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded', loginPath);
      return false;
    }

    authUser.timestamp = Date.now();
    AdminStore.set(AdminStore.getToken(), authUser);

    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_KEYS.logoutEvent) {
        adminLogout('adminLogoutEvent from another tab', loginPath);
      }
    });

    return true;
  } catch (e) {
    console.error('Auth check failed:', e);
    adminLogout('exception in ensureAdminAuthOrLogout', loginPath);
    return false;
  }
}

function requireAuth(expectedRole, loginPath) {
  return ensureAdminAuthOrLogout(loginPath);
}

// ------------------------------
// Utility for authenticated API calls
// ------------------------------
async function apiFetch(endpoint, options = {}) {
  const ok = ensureAdminAuthOrLogout('../login.html');
  if (!ok) return;

  const token = AdminStore.getToken();
  const authUser = AdminStore.getAuthUser();

  if (!token || !authUser) {
    adminLogout('missing token/authUser in admin apiFetch', '../login.html');
    return;
  }

  try {
    const ts = authUser.timestamp || 0;
    if (!ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout('admin session max age exceeded in apiFetch', '../login.html');
      return;
    }
    authUser.timestamp = Date.now();
    AdminStore.set(token, authUser);
  } catch (e) {
    console.error('Failed to refresh authUser in apiFetch:', e);
    adminLogout('invalid authUser JSON in apiFetch', '../login.html');
    return;
  }

  const url =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
      ? `${SERVER_URL}${endpoint}`
      : endpoint;

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearLocalAuth();
    localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
    window.location.href = '../login.html';
    return;
  }
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `API error: ${response.status}`);
  }
  return response.json();
}

// ------------------------------
// Page init
// ------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const ok = requireAuth('admin', '../login.html');
  if (!ok) return;

  setupSidebarAndSession();
  await checkServerConnection();
  setupViews();
  setupModals();
  
  loadRecipients();
  loadHistory();
  loadTemplates();

  setupFormListener();
  setupViewModalListeners(); 
});

// ------------------------------
// Sidebar + session handling
// ------------------------------
function setupSidebarAndSession() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const authUser = AdminStore.getAuthUser();
    const ts = authUser?.timestamp || 0;
    if (!authUser || !ts || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) {
      adminLogout(
        'admin session max age exceeded in setupSidebarAndSession',
        '../login.html'
      );
      return;
    }
  } catch (e) {
    adminLogout('invalid authUser JSON in setupSidebarAndSession', '../login.html');
    return;
  }

  const adminNameEl = document.getElementById('adminFullName');
  if (adminNameEl) {
    const authUser = AdminStore.getAuthUser();
    adminNameEl.textContent = authUser?.name ? authUser.name : 'Admin';
  }

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () =>
      sidebar.classList.toggle('collapsed')
    );
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = AdminStore.getToken();
      try {
        if (token) {
          const logoutUrl = `${getApiBase()}/api/logout`;
          await fetch(logoutUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        }
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        clearLocalAuth();
        localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
        window.location.href = '../login.html';
      }
    });
  }
}
// ------------------------------
// Server health check
// ------------------------------
async function checkServerConnection() {
  const statusElement = document.getElementById('serverStatus');
  if (!statusElement) return;
  try {
    const result = await apiFetch('/health');
    if (result) {
      statusElement.textContent = 'Connected to server successfully';
      statusElement.className = 'server-status server-connected';
    } else {
      throw new Error('Health check failed');
    }
  } catch (error) {
    statusElement.textContent =
      'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
    console.error('Server connection error:', error);
  }
}
// ------------------------------
// Tab handling
// ------------------------------
function setupViews() {
    const showComposeBtn = document.getElementById('showComposeBtn');
    const showHistoryBtn = document.getElementById('showHistoryBtn');
    const composeView = document.getElementById('composeView');
    const historyView = document.getElementById('historyView');
    const sendSection = document.getElementById('sendSection');
    const historySection = document.getElementById('historySection');

    showComposeBtn.addEventListener('click', () => {
        composeView.style.display = 'block';
        historyView.style.display = 'none';
        sendSection.classList.add('active');
        historySection.classList.remove('active');
        showComposeBtn.classList.add('active');
        showHistoryBtn.classList.remove('active');
    });

    showHistoryBtn.addEventListener('click', () => {
        composeView.style.display = 'none';
        historyView.style.display = 'block';
        sendSection.classList.remove('active');
        historySection.classList.add('active');
        showComposeBtn.classList.remove('active');
        showHistoryBtn.classList.add('active');
    });
}

// ------------------------------
// Modal Handling (Updated for Template Form)
// ------------------------------
function setupModals() {
    const modals = {
        recipient: {
            modal: document.getElementById('recipientModal'),
            openBtn: document.getElementById('openRecipientModalBtn'),
            closeBtn: document.getElementById('closeRecipientModalBtn'),
        },
        template: { // The List Modal
            modal: document.getElementById('templateModal'),
            openBtn: document.getElementById('manageTemplatesBtn'),
            closeBtn: document.getElementById('closeTemplateModalBtn'),
        },
        templateForm: { // The New Form Modal (Big Pop-up)
            modal: document.getElementById('templateFormModal'),
            openBtn: document.getElementById('openAddTemplateModalBtn'),
            closeBtn: document.getElementById('closeTemplateFormModalBtn'),
        },
        recipientPopup: {
            modal: document.getElementById('recipientPopup'),
            closeBtn: document.getElementById('closeRecipientPopupBtn'),
            backdrop: document.getElementById('backdrop'),
        }
    };

    for (const key in modals) {
        const { modal, openBtn, closeBtn, backdrop } = modals[key];
        
        // Open Button Logic
        if (openBtn) {
            openBtn.onclick = () => {
                modal.style.display = 'block';
                // If opening the ADD form, reset it first
                if (key === 'templateForm') {
                    document.getElementById('templateForm').reset();
                    document.getElementById('templateId').value = '';
                    document.getElementById('templateFormTitle').textContent = 'Add New Template';
                }
            };
        }
        
        // Close Button Logic
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.style.display = 'none';
                if (backdrop) backdrop.style.display = 'none';
            }
        }
    }
    
    document.getElementById('confirmRecipientsBtn').onclick = () => {
        updateSelectedRecipientsList();
        modals.recipient.modal.style.display = 'none';
    };

    modals.recipientPopup.backdrop.onclick = () => {
        modals.recipientPopup.modal.style.display = 'none';
        modals.recipientPopup.backdrop.style.display = 'none';
    }

    // Global window click to close all types of modals
    window.onclick = (event) => {
        if (event.target == modals.recipient.modal) modals.recipient.modal.style.display = 'none';
        if (event.target == modals.template.modal) modals.template.modal.style.display = 'none';
        if (event.target == modals.templateForm.modal) modals.templateForm.modal.style.display = 'none';
        
        // Also handle the View Msg modal if clicked outside
        const viewModal = document.getElementById('viewAnnouncementModal');
        if (viewModal && event.target == viewModal) {
            viewModal.style.display = 'none';
        }
    };
}


function updateSelectedRecipientsList() {
    const selectedList = document.getElementById('selectedRecipientsList');
    const checkboxes = document.querySelectorAll('#recipientList input[type="checkbox"]:checked');
    selectedList.innerHTML = '';
    checkboxes.forEach(cb => {
        const li = document.createElement('li');
        li.textContent = cb.parentElement.querySelector('label').textContent;
        selectedList.appendChild(li);
    });
}

// ------------------------------
// Load Recipients
// ------------------------------
let allRecipients = [];
async function loadRecipients() {
    try {
        const result = await apiFetch('/api/announcements/recipients');
        if (result.success) {
            allRecipients = result.data;
            displayRecipients(allRecipients);
        } else {
            throw new Error(result.error || 'Failed to load recipients');
        }
    } catch (error) {
        console.error('Error loading recipients:', error);
        showError('Network error: ' + error.message);
    }
}

function displayRecipients(recipients) {
    const recipientList = document.getElementById('recipientList');
    recipientList.innerHTML = '';
    recipients.forEach(r => {
        const item = document.createElement('div');
        item.className = 'recipient-item';
        item.innerHTML = `
            <input type="checkbox" id="recipient_${r.email}" name="recipients" value="${r.email}" data-role="${r.role}">
            <label for="recipient_${r.email}">${r.name} (${r.email}) - ${r.role}</label>
        `;
        recipientList.appendChild(item);
    });
}

// ------------------------------
// Template Management
// ------------------------------
let allTemplates = [];

async function loadTemplates() {
    try {
        allTemplates = await apiFetch('/api/templates');
        populateTemplateDropdown();
        displayTemplatesInModal();
    } catch (error) {
        console.error('Error loading templates:', error);
        showError('Could not load templates.');
    }
}

function populateTemplateDropdown() {
    const select = document.getElementById('templateSelect');
    select.innerHTML = '<option value="">Select a Template</option>';
    allTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t._id;
        option.textContent = t.name;
        select.appendChild(option);
    });
}

function displayTemplatesInModal() {
    const list = document.getElementById('templateList');
    list.innerHTML = '';
    allTemplates.forEach(t => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="template-name" data-id="${t._id}">${t.name}</span>
            <div>
                <button class="btn-primary edit-template-btn" data-id="${t._id}">Edit</button>
                <button class="btn-primary delete-template-btn" data-id="${t._id}">Delete</button>
            </div>
        `;
        list.appendChild(li);
    });
}

document.getElementById('templateSelect').addEventListener('change', (e) => {
    const templateId = e.target.value;
    if (!templateId) {
        document.getElementById('subject').value = '';
        document.getElementById('body').value = '';
        return;
    }
    const template = allTemplates.find(t => t._id === templateId);
    if (template) {
        document.getElementById('subject').value = template.subject;
        document.getElementById('body').value = template.body;
    }
});

document.getElementById('templateModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('edit-template-btn')) {
        const templateId = e.target.dataset.id;
        const template = allTemplates.find(t => t._id === templateId);
        if (template) {
            // Populate form
            document.getElementById('templateId').value = template._id;
            document.getElementById('templateName').value = template.name;
            document.getElementById('templateSubject').value = template.subject;
            document.getElementById('templateBody').value = template.body;
            
            // Set Title
            document.getElementById('templateFormTitle').textContent = 'Edit Template';
            
            // Open the Form Modal
            document.getElementById('templateFormModal').style.display = 'block';
        }
    }
    if (e.target.classList.contains('delete-template-btn')) {
        const templateId = e.target.dataset.id;
        if (confirm('Are you sure you want to delete this template?')) {
            deleteTemplate(templateId);
        }
    }
});

document.getElementById('templateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('templateId').value;
    const name = document.getElementById('templateName').value;
    const subject = document.getElementById('templateSubject').value;
    const body = document.getElementById('templateBody').value;
    
    const method = id ? 'PUT' : 'POST';
    const endpoint = id ? `/api/templates/${id}` : '/api/templates';

    try {
        await apiFetch(endpoint, {
            method,
            body: JSON.stringify({ name, subject, body }),
        });
        showSuccess('Template saved successfully!');
        
        // Close the form modal
        document.getElementById('templateFormModal').style.display = 'none';
        document.getElementById('templateForm').reset();
        document.getElementById('templateId').value = '';
        
        // Refresh the list
        loadTemplates();
    } catch (error) {
        console.error('Error saving template:', error);
        showError(error.message || 'An unknown error occurred while saving the template.');
    }
});


async function deleteTemplate(id) {
    try {
        await apiFetch(`/api/templates/${id}`, { method: 'DELETE' });
        showSuccess('Template deleted.');
        loadTemplates();
    } catch (error) {
        console.error('Error deleting template:', error);
        showError('Error deleting template.');
    }
}


// ------------------------------
// Form Handling
// ------------------------------
function setupFormListener() {
    const sendEmailForm = document.getElementById('sendEmailForm');
    sendEmailForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const subject = document.getElementById('subject').value;
        
        // --- START OF EDIT ---
        const bodyRaw = document.getElementById('body').value;
        // Convert enters (\n) to <br> and wrap in a styled div for bigger font
        const body = `<div style="font-size: 16px; font-family: sans-serif; line-height: 1.6;">${bodyRaw.replace(/\n/g, '<br>')}</div>`;
        // --- END OF EDIT ---

        const recipients = Array.from(document.querySelectorAll('#recipientList input[name="recipients"]:checked')).map(el => el.value);

        if (recipients.length === 0) {
            showError("Please select at least one recipient.");
            return;
        }

        try {
            const result = await apiFetch('/api/announcements/send', {
                method: 'POST',
                body: JSON.stringify({ subject, body, recipients }),
            });

            if (result.success) {
                showSuccess('Announcement sent successfully!');
                sendEmailForm.reset();
                document.getElementById('selectedRecipientsList').innerHTML = '';
                document.querySelectorAll('#recipientList input[type="checkbox"]').forEach(cb => cb.checked = false);
                loadHistory(); // Refresh history
            } else {
                throw new Error(result.error || 'Failed to send announcement');
            }
        } catch (error) {
            console.error('Error sending announcement:', error);
            showError('Network error: ' + error.message);
        }
    });

    // Select Members Only logic
    document.getElementById('selectMembersBtn').addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#recipientList input[name="recipients"]');
        checkboxes.forEach(cb => {
            cb.checked = (cb.dataset.role === 'member');
        });
    });

    // Select Trainers Only logic
    document.getElementById('selectTrainersBtn').addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#recipientList input[name="recipients"]');
        checkboxes.forEach(cb => {
            cb.checked = (cb.dataset.role === 'trainer');
        });
    });

    document.getElementById('selectAllBtn').addEventListener('click', () => {
        document.querySelectorAll('#recipientList input[name="recipients"]').forEach(c => c.checked = true);
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
        document.querySelectorAll('#recipientList input[name="recipients"]').forEach(c => c.checked = false);
    });

    document.getElementById('recipient_search').addEventListener('input', (e) => {
        const filter = e.target.value.toLowerCase();
        const filteredRecipients = allRecipients.filter(r => 
            r.name.toLowerCase().includes(filter) || 
            r.email.toLowerCase().includes(filter) || 
            r.role.toLowerCase().includes(filter)
        );
        displayRecipients(filteredRecipients);
    });
}


// ------------------------------
// History
// ------------------------------
async function loadHistory() {
    const historyListBody = document.getElementById('historyListBody');
    try {
        const result = await apiFetch('/api/announcements/history');
        if (result.success) {
            displayHistory(result.data);
        } else {
            throw new Error(result.error || 'Failed to load history');
        }
    } catch (error) {
        console.error('Error loading history:', error);
        showError('Network error: ' + error.message);
    }
}


function displayHistory(history) {
    const historyListBody = document.getElementById('historyListBody');
    historyListBody.innerHTML = '';

    if (history.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = 'No announcements have been sent yet.';
        cell.style.textAlign = 'center';
        row.appendChild(cell);
        historyListBody.appendChild(row);
        return;
    }

    history.forEach(item => {
        const row = document.createElement('tr');

        // 1. Date Column
        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(item.createdAt).toLocaleString();
        row.appendChild(dateCell);

        // 2. Subject Column
        const subjectCell = document.createElement('td');
        subjectCell.textContent = item.subject;
        row.appendChild(subjectCell);
        
        // 3. Recipients Column
        const recipientsCell = document.createElement('td');
        if (item.recipients.length > 5) {
            const truncated = item.recipients.slice(0, 5).join(', ');
            // Safe linking for see-more as well
            const link = document.createElement('a');
            link.href = "#";
            link.className = "see-more-link";
            link.textContent = "See More";
            link.dataset.recipients = JSON.stringify(item.recipients); // Safe data attachment
            
            recipientsCell.textContent = `${truncated} ... `;
            recipientsCell.appendChild(link);
        } else {
            recipientsCell.textContent = item.recipients.join(', ');
        }
        row.appendChild(recipientsCell);

        // 4. Actions Column (FIXED)
        const actionsCell = document.createElement('td');
        
        // Create the button as a DOM element instead of a string
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn-primary view-announcement-btn';
        viewBtn.textContent = 'View'; // Updated Text
        viewBtn.style.padding = '8px 16px'; 
        viewBtn.style.fontSize = '0.9rem';

        // safely attach the JSON object to the button
        viewBtn.dataset.item = JSON.stringify(item);

        actionsCell.appendChild(viewBtn);
        row.appendChild(actionsCell);
        
        historyListBody.appendChild(row);
    });
}

// ------------------------------
// View Modal Logic (New)
// ------------------------------

function setupViewModalListeners() {
    // Close View Modal Logic
    const viewModal = document.getElementById('viewAnnouncementModal');
    const closeViewBtn = document.getElementById('closeViewAnnouncementModalBtn');

    if (closeViewBtn && viewModal) {
        closeViewBtn.onclick = function() {
            viewModal.style.display = 'none';
        }
    }

    // Global listener for History Table Clicks (View Msg & See More)
    const historyListBody = document.getElementById('historyListBody');
    if (historyListBody) {
        historyListBody.addEventListener('click', (e) => {
            // Handle "See More" recipients click
            if (e.target.classList.contains('see-more-link')) {
                e.preventDefault();
                const recipients = JSON.parse(e.target.dataset.recipients);
                showRecipientPopup(recipients);
            }

            // Handle "View Msg" button click - OPEN MODAL INSTEAD OF ALERT
            if (e.target.classList.contains('view-announcement-btn')) {
                const item = JSON.parse(e.target.dataset.item);
                
                // Populate Modal Fields
                const dateEl = document.getElementById('viewDate');
                const subjectEl = document.getElementById('viewSubject');
                const recipientsEl = document.getElementById('viewRecipients');
                const bodyEl = document.getElementById('viewBody');

                if (dateEl) dateEl.textContent = new Date(item.createdAt).toLocaleString();
                if (subjectEl) subjectEl.textContent = item.subject;
                if (recipientsEl) recipientsEl.textContent = item.recipients ? item.recipients.join(', ') : 'No recipients';
                
                // Use innerHTML because the body contains HTML tags (like <br> or <div>)
                if (bodyEl) bodyEl.innerHTML = item.body;
                
                // Show Modal
                if (viewModal) viewModal.style.display = 'block';
            }
        });
    }
}


function showRecipientPopup(recipients) {
    const list = document.getElementById('recipientPopupList');
    list.innerHTML = '';
    recipients.forEach(r => {
        const li = document.createElement('li');
        li.textContent = r;
        list.appendChild(li);
    });
    document.getElementById('backdrop').style.display = 'block';
    document.getElementById('recipientPopup').style.display = 'block';
}

// ------------------------------
// Notifications
// ------------------------------
function showSuccess(message) {
    const successMessage = document.getElementById('successMessage');
    successMessage.textContent = message;
    successMessage.style.display = 'block';
    setTimeout(() => successMessage.style.display = 'none', 3000);
}

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => errorMessage.style.display = 'none', 3000);
}