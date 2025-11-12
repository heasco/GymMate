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


// Setup sidebar and session management
function setupSidebarAndSession() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // Menu toggle functionality
    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    
    // Session check
    const authUser = JSON.parse(localStorage.getItem('authUser'));
    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = '../member-login.html';
        return;
    }
    
    // Logout functionality
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        localStorage.removeItem('memberData');
        window.location.href = '../member-login.html';
    });
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}


// Get member ID from auth - FIXED: Works with new login.js structure
function getMemberIdFromAuth() {
    try {
        const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
        if (!authUser) return null;
        
        // FIXED: Check both old structure (authUser.user) and new structure (direct authUser)
        const user = authUser.user || authUser;
        return user.memberId || user.member_id || user._id || user.id || null;
    } catch (error) {
        console.error('Error getting member ID:', error);
        return null;
    }
}


// Load dashboard data
async function loadDashboard() {
    const memberId = getMemberIdFromAuth();
    if (!memberId) {
        logout();
        return;
    }


    // Set initial loading states
    document.getElementById('dashboardName').textContent = 'Member';
    document.getElementById('dashboardMemberId').textContent = memberId;
    document.getElementById('membershipTypes').innerHTML = '<li>Loading memberships...</li>';
    document.getElementById('remainingCombSessions').textContent = '—';
    document.getElementById('infoEmail').textContent = 'Loading...';
    document.getElementById('infoPhone').textContent = 'Loading...';
    document.getElementById('infoJoinDate').textContent = 'Loading...';
    
    const errorElement = document.getElementById('error');
    errorElement.style.display = 'none';


    try {
        // Load member data
        const memberResponse = await fetch(`${SERVER_URL}/api/members/${encodeURIComponent(memberId)}`);
        if (!memberResponse.ok) {
            throw new Error('Failed to load member data');
        }


        const memberData = await memberResponse.json();
        const member = memberData.data || memberData;


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


        // Load recent classes
        await loadRecentClasses(memberId);


    } catch (error) {
        console.error('Dashboard loading error:', error);
        errorElement.style.display = 'block';
        errorElement.textContent = `${error.message || 'Problem loading dashboard'}. Please try logging in again.`;
    }
}


// Load recent classes
async function loadRecentClasses(memberId) {
    try {
        const enrollmentsResponse = await fetch(`${SERVER_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`);
        
        let rowsHTML = '';
        if (enrollmentsResponse.ok) {
            const enrollmentsData = await enrollmentsResponse.json();
            const enrollments = enrollmentsData.data || enrollmentsData || [];
            
            // Sort by date (most recent first) and take latest 5
            const recentEnrollments = enrollments
                .sort((a, b) => new Date(b.session_date || b.date) - new Date(a.session_date || a.date))
                .slice(0, 5);
            
            if (recentEnrollments.length > 0) {
                rowsHTML = recentEnrollments.map(enrollment => {
                    const className = enrollment.class_id?.class_name || enrollment.class_name || 'Class';
                    const day = enrollment.session_day || enrollment.day || '—';
                    const date = enrollment.session_date || enrollment.date;
                    const status = enrollment.attendance_status || enrollment.status || '—';
                    
                    const formattedDate = date ? new Date(date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    }) : '—';
                    
                    let statusClass = 'status-pending';
                    if (status.toLowerCase() === 'completed' || status.toLowerCase() === 'attended') {
                        statusClass = 'status-completed';
                    } else if (status.toLowerCase() === 'active') {
                        statusClass = 'status-active';
                    }
                    
                    return `
                        <tr>
                            <td>${escapeHtml(className)}</td>
                            <td>${escapeHtml(day)}</td>
                            <td>${formattedDate}</td>
                            <td><span class="status-badge ${statusClass}">${escapeHtml(status)}</span></td>
                        </tr>
                    `;
                }).join('');
            } else {
                rowsHTML = `
                    <tr>
                        <td colspan="4" style="color: var(--neutral); font-style: italic; text-align: center;">
                            No class enrollments yet
                        </td>
                    </tr>
                `;
            }
        } else {
            rowsHTML = `
                <tr>
                    <td colspan="4" style="color: var(--neutral); font-style: italic; text-align: center;">
                        Failed to load enrollments
                    </td>
                </tr>
            `;
        }
        
        document.querySelector('#recentClassesTable tbody').innerHTML = rowsHTML;
        
    } catch (error) {
        console.error('Error loading recent classes:', error);
        document.querySelector('#recentClassesTable tbody').innerHTML = `
            <tr>
                <td colspan="4" style="color: #dc3545; font-style: italic; text-align: center;">
                    Error loading classes
                </td>
            </tr>
        `;
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
    localStorage.removeItem('authUser');
    localStorage.removeItem('memberData');
    window.location.href = '../member-login.html';
}


// Show toast notification
function showToast(message, type = 'info') {
    // Create toast container if it doesn't exist
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
    
    // Create toast element
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
    
    // Set background color based on type
    const colors = {
        success: 'linear-gradient(135deg, #28a745, #20c997)',
        error: 'linear-gradient(135deg, #dc3545, #e83e8c)',
        warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
        info: 'linear-gradient(135deg, var(--primary), var(--highlight))'
    };
    
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Remove toast after 5 seconds
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
    }
`;
document.head.appendChild(style);
