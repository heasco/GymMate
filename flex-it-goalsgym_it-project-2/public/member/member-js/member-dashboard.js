// ========================================
// Member Dashboard - Enhanced Route Version + JWT Authentication
// ========================================

// Server configuration
const SERVER_URL = 'http://localhost:8080';

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
    loadDashboard();
});

// Initialize page
function initializePage() {
    setupSidebarAndSession();
}

// Setup sidebar and session management - unchanged
function setupSidebarAndSession() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // Menu toggle functionality
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }
    
    // JWT Token auth check
    const authUser = sessionStorage.getItem('authUser');
    const token = sessionStorage.getItem('token');
    const role = sessionStorage.getItem('role');
    
    if (!authUser || !token || role !== 'member') {
        sessionStorage.clear();
        window.location.href = '../member-login.html';
        return;
    }
    
    try {
        const authUserParsed = JSON.parse(authUser);
        if ((Date.now() - authUserParsed.timestamp) > 3600000) {
            sessionStorage.clear();
            window.location.href = '../member-login.html';
            return;
        }
    } catch (error) {
        console.error('Error parsing authUser:', error);
        sessionStorage.clear();
        window.location.href = '../member-login.html';
        return;
    }
    
    // Logout functionality
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.clear();
            window.location.href = '../member-login.html';
        });
    }
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}

// Get member ID from auth
function getMemberIdFromAuth() {
    try {
        const authUserStr = sessionStorage.getItem('authUser') || 'null';
        const authUser = JSON.parse(authUserStr);
        if (!authUser) return null;
        
        const user = authUser.user || authUser;
        return user.memberId || user.member_id || user._id || user.id || null;
    } catch (error) {
        console.error('Error getting member ID:', error);
        return null;
    }
}

// JWT Authentication Helper
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    sessionStorage.clear();
    window.location.href = '../member-login.html';
    return;
  }
  
  let url = endpoint;
  if (!endpoint.startsWith('http')) {
    if (!endpoint.startsWith('/api/')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    url = `${SERVER_URL}${endpoint}`;
    console.log('API URL:', url);
  }
  
  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`, 
    'Content-Type': 'application/json' 
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.status === 401 || res.status === 403) {
      sessionStorage.clear();
      window.location.href = '../member-login.html';
      return;
    }
    
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw e;
  }
}

// Load dashboard data - MODIFIED to use enhanced enrollments route
async function loadDashboard() {
    const memberId = getMemberIdFromAuth();
    if (!memberId) {
        logout();
        return;
    }

    // Set initial loading states
    document.getElementById('dashboardName').textContent = 'Loading...';
    document.getElementById('dashboardMemberId').textContent = `ID: ${memberId}`;
    document.getElementById('membershipTypes').innerHTML = '<li>Loading memberships...</li>';
    document.getElementById('remainingCombSessions').textContent = '—';
    document.getElementById('infoEmail').textContent = 'Loading...';
    document.getElementById('infoPhone').textContent = 'Loading...';
    document.getElementById('infoJoinDate').textContent = 'Loading...';
    
    const errorElement = document.getElementById('error');
    errorElement.style.display = 'none';

    try {
        // Load member data - unchanged
        console.log('Loading member data for:', memberId);
        const memberResponse = await apiFetch('/members');
        let targetMember = null;
        
        if (memberResponse.success && Array.isArray(memberResponse.data)) {
            console.log('Searching for member ID:', memberId, 'in', memberResponse.data.length, 'members');
            targetMember = memberResponse.data.find(m => {
                const matches = (m.memberId && m.memberId === memberId) || 
                               (m.username && m.username === memberId) ||
                               (m._id && m._id.toString() === memberId.toString());
                return matches;
            });
            
            if (targetMember) {
                console.log('Member found successfully');
            } else {
                console.warn('Member not found in members array');
                console.log('Available member IDs:', memberResponse.data.map(m => m.memberId || m.username || m._id));
            }
        }

        const member = targetMember || memberResponse;

        // Update basic member info
        document.getElementById('dashboardName').textContent = member.name || member.username || 'Member';
        document.getElementById('dashboardMemberId').textContent = member.memberId || memberId;
        document.getElementById('infoEmail').textContent = member.email || '—';
        document.getElementById('infoPhone').textContent = member.phone || '—';
        
        // Format join date
        if (member.joinDate || member.createdAt) {
            const joinDate = new Date(member.joinDate || member.createdAt);
            document.getElementById('infoJoinDate').textContent = joinDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } else {
            document.getElementById('infoJoinDate').textContent = '—';
        }

        // Process memberships
        let combativeSessions = '—';
        const memberships = member.memberships || [];
        
        if (memberships.length > 0) {
            const membershipHTML = memberships.map(membership => {
                const type = membership.type || '—';
                const endDate = membership.endDate ? new Date(membership.endDate).toLocaleDateString() : '—';
                const remainingSessions = membership.remainingSessions !== undefined ? membership.remainingSessions : 
                                         membership.remaining !== undefined ? membership.remaining : null;
                
                // Track combative sessions
                if (type.toLowerCase().includes('combative') && remainingSessions !== null) {
                    combativeSessions = parseInt(remainingSessions) || 0;
                }
                
                return `
                    <li>
                        <span>${type.charAt(0).toUpperCase() + type.slice(1)}</span>
                        <span style="color: var(--neutral); font-size: 0.9rem;">
                            (valid until ${endDate})
                            ${remainingSessions !== null ? ` · ${remainingSessions} sessions left` : ''}
                        </span>
                    </li>
                `;
            }).join('');
            
            document.getElementById('membershipTypes').innerHTML = membershipHTML;
        } else {
            document.getElementById('membershipTypes').innerHTML = '<li>No active memberships</li>';
        }
        
        document.getElementById('remainingCombSessions').textContent = combativeSessions !== '—' ? combativeSessions : '0';

        // Load recent classes using the new enhanced route
        await loadRecentClasses(memberId);

    } catch (error) {
        console.error('Dashboard loading error:', error);
        const errorElement = document.getElementById('error');
        if (errorElement) {
            errorElement.style.display = 'block';
            errorElement.textContent = `${error.message || 'Problem loading dashboard'}. Please try logging in again.`;
        }
    }
}

// Load recent classes - FIXED to use enhanced route
async function loadRecentClasses(memberId) {
    try {
        console.log('Loading enhanced enrollments for member:', memberId);
        
        // Use the new enhanced route
        const enhancedEnrollmentsResponse = await apiFetch(`/enrollments/member/${encodeURIComponent(memberId)}/enhanced`);
        let rowsHTML = '';
        
        console.log('Enhanced enrollments response:', enhancedEnrollmentsResponse);
        
        if (enhancedEnrollmentsResponse.success && Array.isArray(enhancedEnrollmentsResponse.data)) {
            const enrollments = enhancedEnrollmentsResponse.data;
            console.log('Enhanced enrollments loaded:', enrollments.length);
            
            // Sort by date (most recent first) and take latest 5
            const recentEnrollments = enrollments
                .sort((a, b) => new Date(b.session_date || b.date) - new Date(a.session_date || a.date))
                .slice(0, 5);
            
            if (recentEnrollments.length > 0) {
                rowsHTML = recentEnrollments.map(enrollment => {
                    // Get class name directly from the enhanced enrollment
                    const className = enrollment.class_name || enrollment.class_display_name || 'Class';
                    const sessionDate = new Date(enrollment.session_date || enrollment.date);
                    const dayOfWeek = sessionDate.toLocaleDateString('en-US', { weekday: 'long' });
                    const formattedDate = sessionDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    });
                    const status = enrollment.attendance_status || enrollment.status || 'Scheduled';
                    
                    let statusClass = 'status-pending';
                    if (status.toLowerCase() === 'attended' || status.toLowerCase() === 'completed') {
                        statusClass = 'status-completed';
                    } else if (status.toLowerCase() === 'scheduled' || status.toLowerCase() === 'active') {
                        statusClass = 'status-active';
                    }
                    
                    console.log('Rendering enhanced class row:', {
                        className,
                        dayOfWeek,
                        formattedDate,
                        status,
                        rawEnrollment: enrollment
                    });
                    
                    return `
                        <tr>
                            <td>${escapeHtml(className)}</td>
                            <td>${escapeHtml(dayOfWeek)}</td>
                            <td>${formattedDate}</td>
                            <td><span class="status-badge ${statusClass}">${escapeHtml(status)}</span></td>
                        </tr>
                    `;
                }).join('');
            } else {
                rowsHTML = `
                    <tr>
                        <td colspan="4" style="color: var(--neutral); font-style: italic; text-align: center;">
                            No upcoming classes
                        </td>
                    </tr>
                `;
            }
        } else {
            console.warn('Enhanced enrollments response not successful:', enhancedEnrollmentsResponse);
            
            // Try fallback to original route if enhanced route fails
            console.log('Falling back to original enrollments route...');
            const fallbackResponse = await apiFetch(`/enrollments/member/${encodeURIComponent(memberId)}`);
            
            if (fallbackResponse.success && Array.isArray(fallbackResponse.data)) {
                // Fallback: use the original route but show class_id instead
                const enrollments = fallbackResponse.data;
                rowsHTML = enrollments
                    .slice(0, 5)
                    .map(enrollment => {
                        const className = enrollment.class_id || 'Class';
                        const sessionDate = new Date(enrollment.session_date || enrollment.date);
                        const dayOfWeek = sessionDate.toLocaleDateString('en-US', { weekday: 'long' });
                        const formattedDate = sessionDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                        });
                        const status = enrollment.attendance_status || enrollment.status || 'Scheduled';
                        
                        let statusClass = 'status-pending';
                        if (status.toLowerCase() === 'attended' || status.toLowerCase() === 'completed') {
                            statusClass = 'status-completed';
                        } else if (status.toLowerCase() === 'scheduled' || status.toLowerCase() === 'active') {
                            statusClass = 'status-active';
                        }
                        
                        return `
                            <tr>
                                <td>${escapeHtml(className)}</td>
                                <td>${escapeHtml(dayOfWeek)}</td>
                                <td>${formattedDate}</td>
                                <td><span class="status-badge ${statusClass}">${escapeHtml(status)}</span></td>
                            </tr>
                        `;
                    }).join('');
            } else {
                rowsHTML = `
                    <tr>
                        <td colspan="4" style="color: #dc3545; font-style: italic; text-align: center;">
                            Failed to load classes - both enhanced and fallback routes
                        </td>
                    </tr>
                `;
            }
        }
        
        const tableBody = document.querySelector('#recentClassesTable tbody');
        if (tableBody) {
            tableBody.innerHTML = rowsHTML;
        } else {
            console.error('Table body element #recentClassesTable tbody not found');
        }
        
    } catch (error) {
        console.error('Error loading recent classes:', error);
        const tableBody = document.querySelector('#recentClassesTable tbody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="color: #dc3545; font-style: italic; text-align: center;">
                        Error loading classes
                    </td>
                </tr>
            `;
        }
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Logout function
function logout() {
    sessionStorage.clear();
    window.location.href = '../member-login.html';
}

// Show toast notification - unchanged
function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        padding: 12px 20px;
        border-radius: var(--radius);
        color: var(--accent);
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(10px);
        animation: slideIn 0.3s ease;
    `;
    
    const colors = {
        success: 'linear-gradient(135deg, #28a745, #20c997)',
        error: 'linear-gradient(135deg, #dc3545, #e83e8c)',
        warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
        info: 'linear-gradient(135deg, var(--primary), var(--highlight))'
    };
    
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

// Add CSS for toast animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
`;
document.head.appendChild(style);
