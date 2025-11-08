// Configuration
const SERVER_URL = 'http://localhost:8080';

// Global variables
window.loadedClasses = [];

// Utility Functions
const $ = id => document.getElementById(id);

function getAuth() {
    try {
        return JSON.parse(localStorage.getItem('authUser') || 'null');
    } catch (e) {
        return null;
    }
}

function memberIdFromAuth() {
    const auth = getAuth();
    if (!auth || !auth.user) return null;
    const user = auth.user;
    return user.memberId || user.member_id || user._id || user.id || null;
}

function logout() {
    localStorage.removeItem('authUser');
    localStorage.removeItem('memberData');
    window.location.href = 'file:///C:/Users/Admin/OneDrive/Desktop/ThesisPROJECT/flex-it-goalsgym_it-project-2/flex-it-goalsgym_it-project-2/public/member-login.html';
}

function showMessage(message, type = 'success') {
    const messageEl = $('feedbackStatus');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, 5000);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Menu toggle
    if ($('menuToggle')) {
        $('menuToggle').addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('collapsed');
        });
    }

    // Logout functionality
    if ($('logoutBtn')) {
        $('logoutBtn').addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // Initialize page
    initializePage();
    loadUserClasses();

    // Form submission
    if ($('feedbackForm')) {
        $('feedbackForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitFeedback();
        });
    }
});

// Initialize Page
function initializePage() {
    loadMemberName();
}

// Load Member Name
function loadMemberName() {
    const authUser = getAuth();
    if (authUser && authUser.user) {
        const userName = authUser.user.name || 
                        `${authUser.user.firstName || ''} ${authUser.user.lastName || ''}`.trim() || 
                        'Member';
        $('memberName').textContent = userName;
    }
}

// Load User Classes
async function loadUserClasses() {
    const classSelect = $('classSelect');
    classSelect.innerHTML = '<option value="">Loading your classes...</option>';
    
    const memberId = memberIdFromAuth();
    if (!memberId) {
        logout();
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/enrollments/member/${encodeURIComponent(memberId)}`);
        if (!response.ok) throw new Error('Failed to load enrollments');

        const data = await response.json();
        const enrollments = data.data || [];

        if (enrollments.length === 0) {
            classSelect.innerHTML = '<option value="">No enrolled classes found</option>';
            return;
        }

        // Fetch class details for each enrollment
        const classDetails = await Promise.all(
            enrollments.map(async (enrollment) => {
                const classId = enrollment.class_id || enrollment.classId;
                try {
                    const classResponse = await fetch(`${SERVER_URL}/api/classes/${encodeURIComponent(classId)}`);
                    if (classResponse.ok) {
                        const classData = await classResponse.json();
                        return {
                            class_id: classId,
                            class_name: classData.data?.class_name || 'Unnamed Class',
                            schedule: classData.data?.schedule || '',
                            trainer_id: classData.data?.trainer_id || '',
                            session_date: enrollment.session_date || enrollment.enrollment_date
                        };
                    }
                } catch (error) {
                    console.warn(`Failed to fetch class ${classId}:`, error);
                }
                return null;
            })
        );

        // Filter out null results and update UI
        const validClasses = classDetails.filter(cls => cls !== null);
        window.loadedClasses = validClasses;

        classSelect.innerHTML = '<option value="">-- Select your class --</option>';
        validClasses.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls.class_id;
            option.textContent = `${cls.class_name}${cls.schedule ? ` (${cls.schedule})` : ''}`;
            option.dataset.trainerId = cls.trainer_id;
            classSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading classes:', error);
        classSelect.innerHTML = '<option value="">Failed to load classes</option>';
        showMessage('Failed to load your classes. Please try again.', 'error');
    }
}

// Submit Feedback
async function submitFeedback() {
    const classId = $('classSelect').value;
    const rating = document.querySelector('input[name="rating"]:checked');
    const comment = $('feedbackText').value.trim();
    const memberId = memberIdFromAuth();

    if (!memberId) {
        logout();
        return;
    }

    // Validation
    if (!classId) {
        showMessage('Please select a class.', 'error');
        return;
    }

    if (!rating) {
        showMessage('Please provide a rating.', 'error');
        return;
    }

    if (!comment) {
        showMessage('Please write your feedback.', 'error');
        return;
    }

    // Get trainer ID from selected class
    const selectedClass = window.loadedClasses.find(cls => cls.class_id === classId);
    const trainerId = selectedClass ? selectedClass.trainer_id : '';

    if (!trainerId) {
        showMessage('Unable to find trainer information for this class.', 'error');
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/feedbacks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                class_id: classId,
                member_id: memberId,
                trainer_id: trainerId,
                rating: parseInt(rating.value),
                comment: comment
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Failed to send feedback');
        }

        // Success
        showMessage('Thank you for your feedback! Your comments help us improve.', 'success');
        $('feedbackForm').reset();

        // Reset star ratings
        document.querySelectorAll('input[name="rating"]').forEach(radio => {
            radio.checked = false;
        });

    } catch (error) {
        console.error('Error submitting feedback:', error);
        showMessage(`Failed to send feedback: ${error.message}`, 'error');
    }
}