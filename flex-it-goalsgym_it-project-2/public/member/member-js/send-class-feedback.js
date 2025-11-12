// Configuration
const SERVER_URL = 'http://localhost:8080';

// Global variables
let enrolledClasses = [];
let selectedClass = null;

// Utility Functions
const $ = id => document.getElementById(id);

function getAuth() {
    try {
        return JSON.parse(localStorage.getItem('authUser') || 'null');
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


function logout() {
    localStorage.removeItem('authUser');
    localStorage.removeItem('memberData');
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


// Load ATTENDED Classes ONLY
async function loadAttendedClasses() {
    console.log('[LoadClasses] Starting...');
    
    const classSelect = $('classSelect');
    if (!classSelect) {
        console.error('[LoadClasses] classSelect not found!');
        return;
    }
    
    classSelect.innerHTML = '<option value="">Loading classes...</option>';
    
    const memberId = memberIdFromAuth();
    console.log('[LoadClasses] Member ID:', memberId);
    
    if (!memberId) {
        console.error('[LoadClasses] No member ID');
        logout();
        return;
    }

    try {
        // Use the NEW /attended route
        const url = `${SERVER_URL}/api/enrollments/member/${encodeURIComponent(memberId)}/attended`;
        console.log('[LoadClasses] Fetching:', url);
        
        const response = await fetch(url);
        console.log('[LoadClasses] Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[LoadClasses] Error:', errorText);
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[LoadClasses] Data received:', data);
        
        const enrollments = data.data || [];
        console.log('[LoadClasses] Attended enrollments:', enrollments.length);
        
        if (enrollments.length === 0) {
            classSelect.innerHTML = '<option value="">No attended classes yet</option>';
            showMessage('You have not attended any classes yet', 'error');
            return;
        }

        // Fetch class details
        console.log('[LoadClasses] Fetching class details...');
        const classDetails = await Promise.all(
            enrollments.map(async (enrollment) => {
                try {
                    const classUrl = `${SERVER_URL}/api/classes/${encodeURIComponent(enrollment.class_id)}`;
                    const classResponse = await fetch(classUrl);
                    
                    if (classResponse.ok) {
                        const classData = await classResponse.json();
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
                    }
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

// View My Feedback
async function viewMyFeedback() {
    console.log('[ViewFeedback] Loading feedback...');
    
    const memberId = memberIdFromAuth();
    if (!memberId) {
        logout();
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
        const response = await fetch(`${SERVER_URL}/api/feedbacks/member/${encodeURIComponent(memberId)}`);
        
        if (!response.ok) {
            throw new Error('Failed to load feedback');
        }

        const data = await response.json();
        console.log('[ViewFeedback] Feedback data:', data);
        
        const feedbacks = data.feedbacks || [];

        if (feedbacks.length === 0) {
            feedbackList.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--neutral);">You haven\'t sent any feedback yet.</p>';
            return;
        }

        // Fetch class names for each feedback
        const feedbacksWithClasses = await Promise.all(
            feedbacks.map(async (feedback) => {
                try {
                    const classResponse = await fetch(`${SERVER_URL}/api/classes/${encodeURIComponent(feedback.class_id)}`);
                    if (classResponse.ok) {
                        const classData = await classResponse.json();
                        return {
                            ...feedback,
                            class_name: classData.data?.class_name || 'Unknown Class'
                        };
                    }
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

// Submit Feedback
async function submitFeedback() {
    console.log('[Submit] Starting...');
    
    const rating = document.querySelector('input[name="rating"]:checked');
    const comment = $('feedbackText')?.value.trim();
    const memberId = memberIdFromAuth();

    if (!memberId) {
        logout();
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
        
        const response = await fetch(`${SERVER_URL}/api/feedbacks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                class_id: selectedClass.class_id,
                member_id: memberId,
                trainer_id: selectedClass.trainer_id,
                rating: parseInt(rating.value),
                comment: comment
            })
        });

        const data = await response.json();
        console.log('[Submit] Response:', data);

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Failed to send feedback');
        }

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
