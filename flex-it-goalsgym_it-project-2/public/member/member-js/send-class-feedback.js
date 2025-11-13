// Utility for authenticated API calls (adds security header for /api/ routes) with timeout - Handles full URLs
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

  // Use endpoint directly if it's already a full URL; otherwise prepend base
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
  console.log('Auth check starting for member-feedback');  // DEBUG
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

// Configuration
const SERVER_URL = 'http://localhost:8080';

// Global variables
let enrolledClasses = [];
let selectedClass = null;

// Utility Functions
const $ = id => document.getElementById(id);

function getAuth() {
    try {
        return JSON.parse(sessionStorage.getItem('authUser') || 'null');
    } catch (e) {
        console.error('[Auth] Error:', e);
        return null;
    }
}

function memberIdFromAuth() {
    const auth = getAuth();
    if (!auth) return null;
    const user = auth.user || auth;
    return user.memberId || user.member_id || user._id || user.id || null;
}

// Logout function (ENHANCED: Clears token + role)
function logout() {
    sessionStorage.removeItem('authUser');
    sessionStorage.removeItem('memberData');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    window.location.href = '../member-login.html';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function showMessage(message, type = 'success') {
    console.log(`[Message] ${type}: ${message}`);
    const messageEl = $('feedbackStatus');
    if (!messageEl) return;
    
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, 5000);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Init] Page loaded');
    
    // Menu toggle
    if ($('menuToggle')) {
        $('menuToggle').addEventListener('click', () => {
            document.querySelector('.sidebar')?.classList.toggle('collapsed');
        });
    }

    // Logout
    if ($('logoutBtn')) {
        $('logoutBtn').addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // Load member name
    loadMemberName();
    
    // Load classes into dropdown
    loadAttendedClasses();

    // Class selection change
    if ($('classSelect')) {
        $('classSelect').addEventListener('change', function() {
            const selectedValue = this.value;
            console.log('[Select] Changed to:', selectedValue);
            
            if (selectedValue) {
                const classData = enrolledClasses.find(c => c.enrollment_id === selectedValue);
                if (classData) {
                    selectedClass = classData;
                    console.log('[Select] Selected class:', selectedClass);
                }
            } else {
                selectedClass = null;
            }
        });
    }

    // View feedback button
    if ($('viewFeedbackBtn')) {
        $('viewFeedbackBtn').addEventListener('click', viewMyFeedback);
    }

    // Close feedback modal
    if ($('closeFeedbackModal')) {
        $('closeFeedbackModal').addEventListener('click', () => {
            $('feedbackModal').style.display = 'none';
        });
    }

    // Form submission
    if ($('feedbackForm')) {
        $('feedbackForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitFeedback();
        });
    }
});

// Load Member Name
function loadMemberName() {
    const authUser = getAuth();
    if (authUser) {
        const user = authUser.user || authUser;
        const userName = user.name || 'Member';
        
        if ($('memberName')) {
            $('memberName').textContent = userName;
        }
        if ($('memberIdBadge')) {
            $('memberIdBadge').textContent = user.memberId || 'Member';
        }
    }
}

// Load ATTENDED Classes ONLY (ENHANCED: Token + role check; fetch → apiFetch, including Promise.all)
async function loadAttendedClasses() {
    console.log('[LoadClasses] Starting...');
    
    const memberId = memberIdFromAuth();
    console.log('[LoadClasses] Member ID:', memberId);
    
    if (!memberId) {
        console.error('[LoadClasses] No member ID');
        logout();
        return;
    }

    // ENHANCED: Token + role check
    const token = sessionStorage.getItem('token');
    const role = sessionStorage.getItem('role');
    const authUser = getAuth();
    if (!token || role !== 'member' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
        console.log('[LoadClasses] Invalid session - logging out');  // DEBUG
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('role');
        window.location.href = '../member-login.html';
        return;
    }

    const classSelect = $('classSelect');
    if (!classSelect) {
        console.error('[LoadClasses] classSelect not found!');
        return;
    }
    
    classSelect.innerHTML = '<option value="">Loading classes...</option>';

    try {
        // Use the NEW /attended route
        const url = `${SERVER_URL}/api/enrollments/member/${encodeURIComponent(memberId)}/attended`;
        console.log('[LoadClasses] Fetching:', url);
        
        // TOKENIZED: GET via apiFetch
        const data = await apiFetch(url);
        console.log('[LoadClasses] Data received:', data);
        
        const enrollments = data.data || [];
        console.log('[LoadClasses] Attended enrollments:', enrollments.length);
        
        if (enrollments.length === 0) {
            classSelect.innerHTML = '<option value="">No attended classes yet</option>';
            showMessage('You have not attended any classes yet', 'error');
            return;
        }

        // Fetch class details (TOKENIZED: Promise.all with apiFetch)
        console.log('[LoadClasses] Fetching class details...');
        const classDetails = await Promise.all(
            enrollments.map(async (enrollment) => {
                try {
                    const classUrl = `${SERVER_URL}/api/classes/${encodeURIComponent(enrollment.class_id)}`;
                    
                    // TOKENIZED: GET via apiFetch
                    const classData = await apiFetch(classUrl);
                    
                    return {
                        enrollment_id: enrollment.enrollment_id || enrollment._id,
                        class_id: enrollment.class_id,
                        class_name: classData.data?.class_name || 'Unnamed Class',
                        trainer_id: classData.data?.trainer_id || '',
                        session_date: enrollment.session_date,
                        session_time: enrollment.session_time,
                        attendance_status: enrollment.attendance_status,
                        status: enrollment.status
                    };
                } catch (error) {
                    console.error(`[LoadClasses] Error fetching class ${enrollment.class_id}:`, error);
                }
                return null;
            })
        );

        // Filter and sort
        enrolledClasses = classDetails
            .filter(cls => cls !== null)
            .sort((a, b) => new Date(b.session_date) - new Date(a.session_date));

        console.log('[LoadClasses] Processed classes:', enrolledClasses.length);

        // Populate dropdown
        classSelect.innerHTML = '<option value="">-- Select your attended class --</option>';
        
        enrolledClasses.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls.enrollment_id;
            option.textContent = `${cls.class_name} - ${formatDate(cls.session_date)} ✓`;
            classSelect.appendChild(option);
        });

        console.log('[LoadClasses] Dropdown populated with', enrolledClasses.length, 'attended classes');

    } catch (error) {
        console.error('[LoadClasses] Error:', error);
        classSelect.innerHTML = '<option value="">Failed to load classes</option>';
        showMessage('Failed to load your classes. Please refresh the page.', 'error');
    }
}

// View My Feedback (ENHANCED: Token + role check; fetch → apiFetch, including Promise.all)
async function viewMyFeedback() {
    console.log('[ViewFeedback] Loading feedback...');
    
    const memberId = memberIdFromAuth();
    if (!memberId) {
        logout();
        return;
    }

    // ENHANCED: Token + role check
    const token = sessionStorage.getItem('token');
    const role = sessionStorage.getItem('role');
    const authUser = getAuth();
    if (!token || role !== 'member' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
        console.log('[ViewFeedback] Invalid session - logging out');  // DEBUG
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('role');
        window.location.href = '../member-login.html';
        return;
    }

    const modal = $('feedbackModal');
    const feedbackList = $('feedbackList');
    
    if (!modal || !feedbackList) {
        console.error('[ViewFeedback] Modal elements not found');
        return;
    }

    modal.style.display = 'block';
    feedbackList.innerHTML = '<p style="text-align: center; padding: 2rem;">Loading your feedback...</p>';

    try {
        // TOKENIZED: GET via apiFetch
        const data = await apiFetch(`${SERVER_URL}/api/feedbacks/member/${encodeURIComponent(memberId)}`);
        console.log('[ViewFeedback] Feedback data:', data);
        
        const feedbacks = data.feedbacks || [];

        if (feedbacks.length === 0) {
            feedbackList.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--neutral);">You haven\'t sent any feedback yet.</p>';
            return;
        }

        // Fetch class names for each feedback (TOKENIZED: Promise.all with apiFetch)
        const feedbacksWithClasses = await Promise.all(
            feedbacks.map(async (feedback) => {
                try {
                    // TOKENIZED: GET via apiFetch
                    const classData = await apiFetch(`${SERVER_URL}/api/classes/${encodeURIComponent(feedback.class_id)}`);
                    
                    return {
                        ...feedback,
                        class_name: classData.data?.class_name || 'Unknown Class'
                    };
                } catch (error) {
                    console.error(`[ViewFeedback] Error fetching class ${feedback.class_id}:`, error);
                }
                return { ...feedback, class_name: 'Unknown Class' };
            })
        );

        // Display feedbacks
        feedbackList.innerHTML = feedbacksWithClasses.map(fb => {
            const stars = '⭐'.repeat(fb.rating);
            const date = formatDate(fb.createdAt || fb.date_submitted);
            
            return `
                <div class="feedback-item">
                    <div class="feedback-header">
                        <h4>${fb.class_name}</h4>
                        <span class="feedback-date">${date}</span>
                    </div>
                    <div class="feedback-rating">${stars} (${fb.rating}/5)</div>
                    <div class="feedback-comment">${fb.comment || 'No comment provided'}</div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('[ViewFeedback] Error:', error);
        feedbackList.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--error);">Failed to load feedback: ${error.message}</p>`;
    }
}

// Submit Feedback (ENHANCED: Token + role check; fetch → apiFetch)
async function submitFeedback() {
    console.log('[Submit] Starting...');
    
    const rating = document.querySelector('input[name="rating"]:checked');
    const comment = $('feedbackText')?.value.trim();
    const memberId = memberIdFromAuth();

    if (!memberId) {
        logout();
        return;
    }

    // ENHANCED: Token + role check
    const token = sessionStorage.getItem('token');
    const role = sessionStorage.getItem('role');
    const authUser = getAuth();
    if (!token || role !== 'member' || !authUser || (Date.now() - (authUser.timestamp || 0)) > 3600000) {
        console.log('[Submit] Invalid session - logging out');  // DEBUG
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('authUser');
        sessionStorage.removeItem('role');
        window.location.href = '../member-login.html';
        return;
    }

    // Validation
    if (!selectedClass) {
        showMessage('Please select an attended class from the dropdown.', 'error');
        return;
    }

    if (!rating) {
        showMessage('Please provide a rating (1-5 stars).', 'error');
        return;
    }

    if (!comment || comment.length < 10) {
        showMessage('Please write feedback (minimum 10 characters).', 'error');
        return;
    }

    if (!selectedClass.trainer_id) {
        showMessage('Unable to find trainer information for this class.', 'error');
        return;
    }

    try {
        console.log('[Submit] Submitting feedback for:', selectedClass.class_name);
        
        // TOKENIZED: POST via apiFetch (merges your options)
        const data = await apiFetch(`${SERVER_URL}/api/feedbacks`, {
            method: 'POST',
            body: JSON.stringify({
                class_id: selectedClass.class_id,
                member_id: memberId,
                trainer_id: selectedClass.trainer_id,
                rating: parseInt(rating.value),
                comment: comment
            })
        });
        console.log('[Submit] Response:', data);

        if (data.error || data.message) throw new Error(data.error || data.message || 'Failed to send feedback');

        // Success
        showMessage('Thank you for your feedback! 🎉', 'success');
        
        // Reset form
        if ($('feedbackForm')) {
            $('feedbackForm').reset();
        }
        
        // Uncheck all radio buttons
        document.querySelectorAll('input[name="rating"]').forEach(radio => {
            radio.checked = false;
        });
        
        // Clear selection
        selectedClass = null;
        if ($('classSelect')) {
            $('classSelect').value = '';
        }

    } catch (error) {
        console.error('[Submit] Error:', error);
        showMessage(`Failed to send feedback: ${error.message}`, 'error');
    }
}
