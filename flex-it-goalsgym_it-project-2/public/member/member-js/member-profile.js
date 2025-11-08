const API_URL = 'http://localhost:8080';

// Utility functions
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

// Logout function
function logout() {
    localStorage.removeItem('authUser');
    localStorage.removeItem('memberData');
    window.location.href = '../member-login.html';
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Logout functionality
    if ($('sidebarLogout')) {
        $('sidebarLogout').addEventListener('click', e => {
            e.preventDefault();
            logout();
        });
    }

    // Load current member info
    loadProfile();

    // Listen for update submit
    $('profileForm').addEventListener('submit', async function(ev) {
        ev.preventDefault();
        updateProfile();
    });
});

// Load member profile
async function loadProfile() {
    const memberId = memberIdFromAuth();
    if (!memberId) return logout();

    $('profileMsg').style.display = "none";
    
    try {
        const res = await fetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}`);
        if (!res.ok) throw new Error("Failed to load member profile");
        
        const member = (await res.json()).data;
        $('profileEmail').value = member.email || '';
        $('profilePhone').value = member.phone || '';
    } catch (e) {
        $('profileMsg').className = "msg err";
        $('profileMsg').style.display = "";
        $('profileMsg').textContent = "Failed to load profile. Try re-logging in.";
    }
}

// Update member profile
async function updateProfile() {
    const memberId = memberIdFromAuth();
    if (!memberId) return logout();

    const email = $('profileEmail').value.trim();
    const phone = $('profilePhone').value.trim();

    $('profileMsg').style.display = "none";
    
    try {
        const res = await fetch(`${API_URL}/api/members/${encodeURIComponent(memberId)}/profile`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, phone })
        });
        
        const responseData = await res.json();
        if (!res.ok) throw new Error(responseData.error || responseData.message || 'Update failed');

        // Update localStorage with new data
        const auth = getAuth(); 
        if (auth && responseData.data) { 
            auth.user = responseData.data; 
            localStorage.setItem('authUser', JSON.stringify(auth)); 
        }

        $('profileMsg').className = "msg ok"; 
        $('profileMsg').textContent = "Changes saved!"; 
        $('profileMsg').style.display = "";
    } catch (e) {
        $('profileMsg').className = "msg err";
        $('profileMsg').textContent = "Error: " + (e.message || 'Update failed');
        $('profileMsg').style.display = "";
    }
}