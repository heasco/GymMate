const API_URL = 'http://localhost:8080';
let allClassesData = [];
let originalClassesData = [];
let currentFilter = 'all';
let currentMinRating = 0;
let trainerId = null;

document.addEventListener('DOMContentLoaded', async function () {
    // 🔍 DEBUG: Log the raw authUser to diagnose structure
    console.log('=== TRAINER FEEDBACK AUTH DEBUG ===');
    const authUser = JSON.parse(localStorage.getItem('authUser'));
    console.log('Raw authUser from localStorage:', authUser);
    if (authUser) {
        console.log('authUser keys:', Object.keys(authUser));
        console.log('authUser.role:', authUser.role);
        console.log('authUser.timestamp:', authUser.timestamp);
        console.log('authUser.user exists?', !!authUser.user);
        if (authUser.user) console.log('authUser.user keys:', Object.keys(authUser.user));
    }

    // FIXED AUTH CHECK: Support both wrapped (authUser.user) and flattened structures
    const user = authUser?.user || authUser; // Fallback to flattened structure
    const role = authUser?.role;
    const timestamp = authUser?.timestamp || 0;

    if (!authUser || !user || role !== "trainer" || (Date.now() - timestamp > 3600000)) {
        console.log('Auth check failed - logging out');
        localStorage.removeItem('authUser');
        window.location.href = '../trainer-login.html';
        return;
    }

    console.log('Auth check passed! Using user:', user);
    console.log('Extracted trainer ID:', user.trainer_id || user.trainerid || user.trainerId || user.id || user._id);

    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');

    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        window.location.href = '../trainer-login.html';
    });

    // FIXED: Display trainer name from extracted user
    const trainerNameEl = document.getElementById('trainerName');
    if (trainerNameEl) trainerNameEl.textContent = user.name || 'Trainer';

    // FIXED: Trainer ID extraction with more fallbacks
    trainerId = user.trainer_id || user.trainerid || user.trainerId || user.id || user._id;
    if (!trainerId) {
        console.error('No valid trainer ID found');
        document.getElementById('loading').textContent = 'Error: Unable to identify trainer';
        return;
    }

    console.log('Trainer ID:', trainerId);

    // Load all feedback
    await loadAllFeedback();
});

// ✅ LOAD ALL FEEDBACK
async function loadAllFeedback() {
    const loading = document.getElementById('loading');
    const container = document.getElementById('classesContainer');

    try {
        // ✅ FETCH ALL TRAINERS FIRST
        const trainersResp = await fetch(`${API_URL}/api/trainers`);
        if (!trainersResp.ok) throw new Error('Failed to fetch trainers');

        const trainersData = await trainersResp.json();
        const allTrainers = trainersData.data || [];

        // Create a map of trainer_id -> trainer name
        const trainerMap = {};
        allTrainers.forEach(trainer => {
            const tid = trainer.trainer_id || trainer.trainerid || trainer._id;
            trainerMap[tid] = trainer.name;
        });

        // ✅ FETCH ALL CLASSES
        const classesResp = await fetch(`${API_URL}/api/classes`);
        if (!classesResp.ok) throw new Error('Failed to fetch classes');

        const classesData = await classesResp.json();
        const allClasses = classesData.data || [];

        // ✅ FETCH ALL FEEDBACKS
        const feedbackResp = await fetch(`${API_URL}/api/feedbacks/admin/all`);
        if (!feedbackResp.ok) throw new Error('Failed to fetch feedbacks');

        const feedbackData = await feedbackResp.json();
        const allFeedbacks = feedbackData.feedbacks || [];

        console.log('Loaded trainers:', allTrainers.length, 'classes:', allClasses.length, 'feedbacks:', allFeedbacks.length);

        // Organize feedbacks by class_id
        const feedbacksByClass = {};
        allFeedbacks.forEach(fb => {
            const classId = fb.class_id;
            if (!feedbacksByClass[classId]) {
                feedbacksByClass[classId] = [];
            }
            feedbacksByClass[classId].push(fb);
        });

        // ✅ COMBINE CLASS DATA WITH FEEDBACKS AND TRAINER NAMES
        const classesWithFeedback = allClasses.map(cls => {
            const classId = cls.class_id || cls.classid || cls._id;
            const feedbacks = feedbacksByClass[classId] || [];
            const classTrainerId = cls.trainer_id || cls.trainerid;
            const isMyClass = classTrainerId === trainerId;

            // ✅ GET TRAINER NAME FROM MAP
            const trainerName = trainerMap[classTrainerId] || 'Unknown Trainer';

            return {
                ...cls,
                feedbacks: feedbacks,
                originalFeedbacks: feedbacks,
                isMyClass,
                classId,
                trainerName  // ✅ ADD TRAINER NAME
            };
        }).filter(cls => cls.feedbacks.length > 0);

        // Store both original and working copy
        originalClassesData = JSON.parse(JSON.stringify(classesWithFeedback));
        allClassesData = classesWithFeedback;

        loading.style.display = 'none';

        if (allClassesData.length === 0) {
            container.innerHTML = '<div class="no-classes">No feedback available yet.</div>';
            return;
        }

        renderClasses();

    } catch (err) {
        console.error('Error loading feedback:', err);
        loading.style.display = 'none';
        container.innerHTML = '<div class="no-classes">Failed to load feedback: ' + err.message + '. Please try again.</div>';
    }
}

// ✅ FILTER CLASSES (FIXED: Accept button param instead of event)
function filterClasses(type, button) {
    currentFilter = type;

    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    button.classList.add('active');

    renderClasses();
}

// ✅ APPLY RATING FILTER
function applyRatingFilter() {
    currentMinRating = parseInt(document.getElementById('minRating').value);
    renderClasses();
}

// ✅ RENDER CLASSES
function renderClasses() {
    const container = document.getElementById('classesContainer');

    // Start with original data (deep copy to avoid mutation)
    let filtered = JSON.parse(JSON.stringify(originalClassesData));

    // Filter by class ownership first
    if (currentFilter === 'my') {
        filtered = filtered.filter(cls => cls.isMyClass);
    }

    // Filter feedbacks by rating for each class
    if (currentMinRating > 0) {
        filtered = filtered.map(cls => {
            const filteredFeedbacks = cls.originalFeedbacks.filter(fb => fb.rating >= currentMinRating);
            return {
                ...cls,
                feedbacks: filteredFeedbacks,
                feedbackCount: filteredFeedbacks.length
            };
        }).filter(cls => cls.feedbacks.length > 0);
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-classes">No classes match the selected filters.</div>';
        return;
    }

    let html = '';

    filtered.forEach(cls => {
        const className = cls.class_name || cls.classname || 'Unnamed Class';
        const schedule = cls.schedule || 'Not scheduled';
        const trainerName = cls.trainerName || 'Unknown Trainer';  // ✅ USE TRAINER NAME
        const avgRating = calculateAverageRating(cls.feedbacks);
        const myClassBadge = cls.isMyClass ? '<span class="my-class-badge">My Class</span>' : '';
        const myClassCls = cls.isMyClass ? 'my-class' : '';

        html += `
                    <div class="class-card ${myClassCls}">
                    <div class="class-header">
                        <h3>${className}</h3>
                        <div class="class-meta">
                            ${myClassBadge}
                            <div class="schedule">${schedule}</div>
                            <div class="enrollment">${cls.feedbacks.length} Feedback${cls.feedbacks.length !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div class="trainer-info">
                        <strong>Trainer:</strong> ${trainerName} | <strong>Avg Rating:</strong> ${avgRating.toFixed(1)} ⭐
                    </div>
                    <div class="feedback-section">
                        <h4>Student Feedback</h4>
                        <div class="feedback-list">
                            ${renderFeedbacks(cls.feedbacks)}
                        </div>
                    </div>
                    </div>
                `;
    });

    container.innerHTML = html;
}

// ✅ RENDER FEEDBACKS
function renderFeedbacks(feedbacks) {
    if (feedbacks.length === 0) {
        return '<div class="no-feedbacks">No feedback for this class yet.</div>';
    }

    return feedbacks.map(fb => {
        const rating = fb.rating || 0;
        const comment = fb.comment || 'No comment provided';
        const date = fb.date_submitted ? new Date(fb.date_submitted).toLocaleDateString() : 'Unknown date';
        const stars = generateStars(rating);

        return `
                    <div class="feedback-item">
                    <div class="feedback-header">
                        <div class="star-rating">
                            ${stars}
                            <span class="rating-number">(${rating}/5)</span>
                        </div>
                        <div class="feedback-date">${date}</div>
                    </div>
                    <div class="feedback-comment">"${comment}"</div>
                    <div class="feedback-meta">
                        <strong>Member ID:</strong> ${fb.member_id}
                    </div>
                    </div>
                `;
    }).join('');
}

// ✅ GENERATE STARS
function generateStars(rating) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= rating) {
            stars += '<span class="star filled">★</span>';
        } else {
            stars += '<span class="star">☆</span>';
        }
    }
    return stars;
}

// ✅ CALCULATE AVERAGE RATING
function calculateAverageRating(feedbacks) {
    if (feedbacks.length === 0) return 0;
    const sum = feedbacks.reduce((acc, fb) => acc + (fb.rating || 0), 0);
    return sum / feedbacks.length;
}