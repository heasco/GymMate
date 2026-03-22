const SERVER_URL = 'http://localhost:8080';
const ADMIN_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
let allProducts = [];

// --- Admin Auth Boilerplate ---
const ADMIN_KEYS = { token: 'admin_token', authUser: 'admin_authUser', role: 'admin_role', logoutEvent: 'adminLogoutEvent' };
const AdminStore = {
  getToken() { return sessionStorage.getItem(ADMIN_KEYS.token) || localStorage.getItem(ADMIN_KEYS.token) || null; },
  getAuthUser() {
    const raw = sessionStorage.getItem(ADMIN_KEYS.authUser) || localStorage.getItem(ADMIN_KEYS.authUser);
    return raw ? JSON.parse(raw) : null;
  },
  hasSession() {
    return (localStorage.getItem(ADMIN_KEYS.token) || sessionStorage.getItem(ADMIN_KEYS.token)) &&
           (localStorage.getItem(ADMIN_KEYS.role) || sessionStorage.getItem(ADMIN_KEYS.role)) === 'admin';
  },
  clear() {
    localStorage.removeItem(ADMIN_KEYS.token); localStorage.removeItem(ADMIN_KEYS.authUser); localStorage.removeItem(ADMIN_KEYS.role);
    sessionStorage.removeItem(ADMIN_KEYS.token); sessionStorage.removeItem(ADMIN_KEYS.authUser); sessionStorage.removeItem(ADMIN_KEYS.role);
  }
};

function adminLogout() {
  AdminStore.clear();
  localStorage.setItem(ADMIN_KEYS.logoutEvent, Date.now().toString());
  window.location.href = '../login.html';
}

async function apiFetch(endpoint, options = {}) {
  if (!AdminStore.hasSession()) { adminLogout(); return; }
  const token = AdminStore.getToken();
  const url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${SERVER_URL}${endpoint}` : endpoint;
  const headers = { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { adminLogout(); return; }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  if (!AdminStore.hasSession()) { adminLogout(); return; }
  
  setupTabs();
  setupSidebar();
  setupModals();
  await checkServerConnection(); 
  await loadProducts();

  const addForm = document.getElementById('addProductForm');
  if (addForm) addForm.addEventListener('submit', handleAddProduct);

  const editForm = document.getElementById('editProductForm');
  if (editForm) editForm.addEventListener('submit', handleEditProduct);
});

// --- Server Health Check ---
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
    statusElement.textContent = 'Cannot connect to server. Please try again later.';
    statusElement.className = 'server-status server-disconnected';
  }
}

// --- Section Switcher (Fixes the overlapping bug) ---
function switchSection(targetSectionId, targetTabId = null) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  // Remove active state from all tabs
  document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
  
  // Show target section
  const targetSection = document.getElementById(targetSectionId);
  if (targetSection) targetSection.classList.add('active');

  // Highlight target tab (if one was provided)
  if (targetTabId) {
    const targetTab = document.getElementById(targetTabId);
    if (targetTab) targetTab.classList.add('active');
  }
}

function setupTabs() {
  const tabList = document.getElementById('tabList');
  const tabAdd = document.getElementById('tabAdd');

  tabList.addEventListener('click', () => {
    switchSection('productListSection', 'tabList');
    loadProducts();
  });

  tabAdd.addEventListener('click', () => {
    switchSection('addProductSection', 'tabAdd');
  });
}

function showProductList() {
  switchSection('productListSection', 'tabList');
}

function setupSidebar() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const logoutBtn = document.getElementById('logoutBtn');
  
  const authUser = AdminStore.getAuthUser();
  document.getElementById('adminFullName').textContent = authUser?.name || 'Admin';

  if (menuToggle && sidebar) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoutBtn) logoutBtn.addEventListener('click', adminLogout);
}

function showMessage(msg, type = 'success') {
  const el = type === 'success' ? document.getElementById('successMessage') : document.getElementById('errorMessage');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

// --- Core Logic ---
async function loadProducts() {
  const tbody = document.getElementById('productListBody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading...</td></tr>';
  
  try {
    const result = await apiFetch('/api/products?status=active');
    allProducts = result.data || [];
    renderTable(allProducts);
  } catch (error) {
    showMessage(error.message, 'error');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #ff3333;">Failed to load products</td></tr>';
  }
}

function renderTable(products) {
  const tbody = document.getElementById('productListBody');
  if(!tbody) return;
  tbody.innerHTML = '';

  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No active products found.</td></tr>';
    return;
  }

  products.forEach(prod => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${prod.product_name}</strong></td>
      <td style="text-transform: capitalize;">${prod.membership_type}</td>
      <td>₱${prod.price.toLocaleString()}</td>
      <td>${prod.schedule || '<span style="color:#777;">N/A</span>'}</td>
      <td><span class="status-badge status-active">${prod.status}</span></td>
      <td>
        <div class="action-buttons">
          <button class="view-button" style="background: transparent; border: 1px solid #ccc; color: #ccc; padding: 5px 10px; border-radius: 4px;" onclick="viewFeedback('${prod._id}')">Feedback (${prod.feedback ? prod.feedback.length : 0})</button>
          <button class="action-button" style="background: #ff3333; color: white; padding: 5px 10px; border: none; border-radius: 4px;" onclick="editProduct('${prod._id}')">Edit</button>
          <button class="archive-button" style="background: transparent; border: 1px solid #dc3545; color: #dc3545; padding: 5px 10px; border-radius: 4px;" onclick="archiveProduct('${prod._id}')">Archive</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function handleAddProduct(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  const data = {
    product_name: document.getElementById('product_name').value.trim(),
    membership_type: document.getElementById('membership_type').value,
    price: parseFloat(document.getElementById('price').value),
    schedule: document.getElementById('schedule').value.trim(),
    description: document.getElementById('description').value.trim()
  };

  try {
    await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(data) });
    showMessage('Product created successfully!');
    e.target.reset();
    showProductList();
    loadProducts();
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// --- Edit Logic ---
function editProduct(id) {
  const product = allProducts.find(p => p._id === id);
  if (!product) return;

  // Use the clean section switcher (don't highlight any tab since we are in "Edit" mode)
  switchSection('editProductSection');

  // Populate Form
  document.getElementById('edit_product_id').value = product._id;
  document.getElementById('edit_product_name').value = product.product_name;
  document.getElementById('edit_membership_type').value = product.membership_type;
  document.getElementById('edit_price').value = product.price;
  document.getElementById('edit_schedule').value = product.schedule || '';
  document.getElementById('edit_description').value = product.description || '';
}

async function handleEditProduct(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  const id = document.getElementById('edit_product_id').value;
  const data = {
    product_name: document.getElementById('edit_product_name').value.trim(),
    membership_type: document.getElementById('edit_membership_type').value,
    price: parseFloat(document.getElementById('edit_price').value),
    schedule: document.getElementById('edit_schedule').value.trim(),
    description: document.getElementById('edit_description').value.trim()
  };

  try {
    await apiFetch(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    showMessage('Product updated successfully!');
    showProductList();
    loadProducts();
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

async function archiveProduct(id) {
  if (!confirm('Are you sure you want to archive this product?')) return;
  try {
    await apiFetch(`/api/products/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
    showMessage('Product archived.');
    loadProducts();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function viewFeedback(id) {
  const product = allProducts.find(p => p._id === id);
  const modal = document.getElementById('feedbackModal');
  const body = document.getElementById('feedbackBody');
  
  if (!product || !product.feedback || product.feedback.length === 0) {
    body.innerHTML = '<p style="color: #ccc;">No feedback submitted for this product yet.</p>';
  } else {
    body.innerHTML = product.feedback.map(f => `
      <div style="background: rgba(0,0,0,0.3); padding: 1rem; margin-bottom: 1rem; border-left: 3px solid #ffbe18; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between;">
          <strong style="color: #fff;">${f.member_name}</strong>
          <span style="color: #ffbe18;">${'★'.repeat(f.rating)}${'☆'.repeat(5-f.rating)}</span>
        </div>
        <p style="color: #ccc; margin-top: 0.5rem; font-size: 0.95rem;">"${f.comment}"</p>
        <small style="color: #777;">${new Date(f.date_submitted).toLocaleDateString()}</small>
      </div>
    `).join('');
  }
  if(modal) modal.style.display = 'flex';
}

function setupModals() {
  const fbModal = document.getElementById('feedbackModal');
  const closeFb = document.getElementById('closeFeedbackBtn');
  if(closeFb) closeFb.addEventListener('click', () => fbModal.style.display = 'none');
  window.addEventListener('click', (e) => { if (e.target === fbModal) fbModal.style.display = 'none'; });
}