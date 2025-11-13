// Utility for authenticated API calls (adds security header for /api/ routes) with timeout - FIXED: Handles full URLs
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  console.log('apiFetch called for:', endpoint);  // DEBUG (remove in production if needed)
  const token = sessionStorage.getItem('token');
  if (!token) {
    console.log('No token - redirecting to login');  // DEBUG
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
    return;
  }

  // FIXED: Use endpoint directly if it's already a full URL; otherwise prepend base
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    url = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? `http://localhost:8080${endpoint}`
      : endpoint;
  }

  const headers = { 
    ...options.headers, 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json' // Default for JSON calls
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      console.log('401 Unauthorized - clearing auth and redirecting');  // DEBUG
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('authUser');
      sessionStorage.removeItem('role');
      window.location.href = '../member-login.html';
      return;
    }
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`API timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ✅ INITIAL AUTH CHECK - Token + Role ('member') + Timestamp (runs immediately)
(function checkAuth() {
  console.log('Auth check starting for member-profile');  // DEBUG
  const authUser = JSON.parse(sessionStorage.getItem('authUser') || 'null'); 
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  
  console.log('Auth details:', { authUser: authUser ? authUser.username || authUser.email : null, token: !!token, role });  // DEBUG: Hide sensitive data
  
  // Check timestamp (1 hour) + token + member role
  if (!authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000 || !token || role !== 'member') { 
    console.log('Auth failed - clearing and redirecting');  // DEBUG
    sessionStorage.removeItem('authUser'); 
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html'; 
    return;
  } 
  
  console.log('Member authenticated:', authUser.username || authUser.email, 'Role:', role);
})();

const API_URL = 'http://localhost:8080';

// Utility functions
const $ = id => document.getElementById(id);

function getAuth() {
    try {
        return JSON.parse(sessionStorage.getItem('authUser') || 'null');
    } catch (e) {
        console.error('[Auth] Error parsing authUser:', e);
        return null;
    }
}

function memberIdFromAuth() {
    const auth = getAuth();
    console.log('[Auth] Full auth object:', auth);
    
    if (!auth) {
        console.error('[Auth] No auth found');
        return null;
    }

    const user = auth.user || auth;
    console.log('[Auth] User object:', user);
    
    const id = user.memberId || user.member_id || user._id || user.id || null;
    console.log('[Auth] Extracted member ID:', id);
    
    return id;
}

// Format date to "Month Day, Year"
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Invalid Date';
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    } catch (e) {
        console.error('[Date] Error formatting date:', e);
        return 'N/A';
    }
}

// Logout function (ENHANCED: Clears token + role)
function logout() {
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('memberData');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Init] Page loaded, initializing profile page');
    
    // Logout functionality
    if ($('logoutBtn')) {
        $('logoutBtn').addEventListener('click', e => {
            e.preventDefault();
            logout();
        });
    }

    // Menu toggle
    if ($('menuToggle')) {
        $('menuToggle').addEventListener('click', () => {
            document.querySelector('.sidebar')?.classList.toggle('collapsed');
        });
    }

    // Load current member info
    loadProfile();
    
    // Listen for update submit
    if ($('profileForm')) {
        $('profileForm').addEventListener('submit', async function(ev) {
            ev.preventDefault();
            updateProfile();
        });
    }
});

// Load member profile (ENHANCED: Token + role check; fetch → apiFetch)
async function loadProfile() {
    console.log('[Profile] Starting to load profile...');
    
    const memberId = memberIdFromAuth();
    console.log('[Profile] Member ID from auth:', memberId);
    
    if (!memberId) {
        console.error('[Profile] No member ID found, logging out');
        return logout();
    }

    // ENHANCED: Token + role check
    const token = sessionStorage.getItem('token');
    const role = sessionStorage.getItem('role');
    const authUser = getAuth();
    if (!token || role !== 'member' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
        console.log('[Profile] Invalid session - logging out');  // DEBUG
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('role');
        window.location.href = '../member-login.html';
        return;
    }

    if ($('profileMsg')) {
        $('profileMsg').style.display = "none";
    }

    try {
        const url = `${API_URL}/api/members/${encodeURIComponent(memberId)}`;
        console.log('[Profile] Fetching from URL:', url);
        
        // TOKENIZED: GET via apiFetch
        const response = await apiFetch(url);
        console.log('[Profile] Response data:', response);
        
        const member = response.data || response;
        console.log('[Profile] Member object:', member);

        // Display member name in greeting
        if ($('profileName')) {
            $('profileName').textContent = member.name || 'Member';
            console.log('[Profile] Set profile name:', member.name);
        }

        // Display member ID badge
        if ($('profileMemberId')) {
            $('profileMemberId').textContent = member.memberId || 'N/A';
            console.log('[Profile] Set member ID:', member.memberId);
        }

        // Display basic contact info
        if ($('profileEmail')) {
            $('profileEmail').value = member.email || '';
        }
        if ($('profilePhone')) {
            $('profilePhone').value = member.phone || '';
        }

        // Display member since (createdAt)
        if ($('memberSince')) {
            const joinDateValue = member.createdAt || member.joinDate;
            console.log('[Profile] Join date raw value:', joinDateValue);
            const formattedDate = formatDate(joinDateValue);
            console.log('[Profile] Join date formatted:', formattedDate);
            $('memberSince').textContent = formattedDate;
        }

        // Display membership status (from member.status)
        if ($('membershipStatus')) {
            const status = member.status || 'inactive';
            $('membershipStatus').textContent = status.charAt(0).toUpperCase() + status.slice(1);
            $('membershipStatus').className = `info-value status-${status}`;
            console.log('[Profile] Set membership status:', status);
        }

        // Display membership types and remaining sessions
        if (member.memberships && member.memberships.length > 0) {
            const types = member.memberships.map(m => m.type.charAt(0).toUpperCase() + m.type.slice(1)).join(', ');
            
            if ($('membershipType')) {
                $('membershipType').textContent = types;
                console.log('[Profile] Set membership types:', types);
            }

            // Find combative membership and show remaining sessions
            const combative = member.memberships.find(m => m.type === 'combative');
            if ($('remainingSessions')) {
                if (combative) {
                    $('remainingSessions').textContent = `${combative.remainingSessions || 0} sessions`;
                } else {
                    $('remainingSessions').textContent = '—';
                }
            }
        } else {
            if ($('membershipType')) {
                $('membershipType').textContent = 'No active memberships';
            }
        }

        console.log('[Profile] Profile loaded successfully!');

    } catch (e) {
        console.error('[Profile] Error loading profile:', e);
        
        if ($('profileMsg')) {
            $('profileMsg').className = "message error";
            $('profileMsg').style.display = "";
            $('profileMsg').textContent = "Failed to load profile: " + e.message;
        }
        
        // Show error in the page
        if ($('profileName')) {
            $('profileName').textContent = 'Error loading';
        }
        if ($('profileMemberId')) {
            $('profileMemberId').textContent = 'Error';
        }
        if ($('memberSince')) {
            $('memberSince').textContent = 'Error';
        }
    }
}

// Update member profile (ENHANCED: Token + role check; fetch → apiFetch)
async function updateProfile() {
    console.log('[Update] Starting profile update...');
    
    const memberId = memberIdFromAuth();
    if (!memberId) {
        console.error('[Update] No member ID, logging out');
        return logout();
    }

    // ENHANCED: Token + role check
    const token = sessionStorage.getItem('token');
    const role = sessionStorage.getItem('role');
    const authUser = getAuth();
    if (!token || role !== 'member' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
        console.log('[Update] Invalid session - logging out');  // DEBUG
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('role');
        window.location.href = '../member-login.html';
        return;
    }

    const email = $('profileEmail').value.trim();
    const phone = $('profilePhone').value.trim();

    console.log('[Update] Updating with email:', email, 'phone:', phone);

    if ($('profileMsg')) {
        $('profileMsg').style.display = "none";
    }

    try {
        const url = `${API_URL}/api/members/${encodeURIComponent(memberId)}/profile`;
        console.log('[Update] PUT to URL:', url);
        
        // TOKENIZED: PUT via apiFetch (merges your options)
        const responseData = await apiFetch(url, {
            method: "PUT",
            body: JSON.stringify({ email, phone })
        });
        console.log('[Update] Response data:', responseData);

        if (responseData.error || responseData.message) throw new Error(responseData.error || responseData.message || 'Update failed');

        // Update sessionStorage with new data
        const auth = getAuth();
        if (auth && responseData.data) {
            auth.user = responseData.data;
            sessionStorage.setItem('authUser', JSON.stringify(auth));
            console.log('[Update] Updated sessionStorage');
        }

        if ($('profileMsg')) {
            $('profileMsg').className = "message success";
            $('profileMsg').textContent = "Changes saved!";
            $('profileMsg').style.display = "";
        }

        // Reload profile after 1 second
        setTimeout(() => {
            loadProfile();
            if ($('profileMsg')) {
                $('profileMsg').style.display = "none";
            }
        }, 2000);

    } catch (e) {
        console.error('[Update] Error updating profile:', e);
        
        if ($('profileMsg')) {
            $('profileMsg').className = "message error";
            $('profileMsg').textContent = "Error: " + (e.message || 'Update failed');
            $('profileMsg').style.display = "";
        }
    }
}
