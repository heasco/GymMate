const SERVER_URL = 'http://localhost:8080';
let faceImageBlob = null;
let faceSuccessfullyCaptured = false;
let selectedMember = null;

document.addEventListener('DOMContentLoaded', () => {
    setupSidebarAndSession();
    initializeForm();
});

// Format date to readable format: "Month Day, Year"
function formatDate(date) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(date).toLocaleDateString('en-US', options);
}

function setupSidebarAndSession() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    const authUser = JSON.parse(localStorage.getItem('authUser'));

    menuToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    if (!authUser || (Date.now() - authUser.timestamp > 3600000)) {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
        return;
    }

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authUser');
        window.location.href = '../admin-login.html';
    });

    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('collapsed');
        }
    });
}

function initializeForm() {
    const memberForm = document.getElementById('memberForm');

    // ✅ Setup Birthdate Calendar Icon
    setupDatePicker('birthdate', 'birthdateDisplay', 'birthdateIcon');

    // ✅ Setup Join Date Calendar Icon
    const today = new Date();
    const joinDateInput = document.getElementById('joinDate');
    const joinDateDisplay = document.getElementById('joinDateDisplay');

    joinDateInput.valueAsDate = today;
    joinDateDisplay.value = formatDate(today);

    setupDatePicker('joinDate', 'joinDateDisplay', 'joinDateIcon');

    // Membership type toggles
    document.getElementById('monthlyCheckbox').addEventListener('change', function () {
        document.getElementById('monthlyDetails').style.display = this.checked ? "block" : "none";
    });

    document.getElementById('combativeCheckbox').addEventListener('change', function () {
        document.getElementById('combativeDetails').style.display = this.checked ? "block" : "none";
    });

    // Form submission
    memberForm.addEventListener('submit', handleFormSubmit);

    // Face capture functionality
    setupFaceCapture();

    // Renewal modal functionality
    setupRenewalModal();
}

// ✅ UPDATED: Universal Date Picker Setup Function
function setupDatePicker(dateInputId, displayInputId, iconId) {
    const dateInput = document.getElementById(dateInputId);
    const displayInput = document.getElementById(displayInputId);
    const icon = document.getElementById(iconId);

    if (!dateInput || !displayInput || !icon) return;

    // When icon is clicked, trigger the hidden date input
    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        dateInput.click(); // Click the hidden date input
    });

    // Also allow clicking the display input to open calendar
    displayInput.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        dateInput.click();
    });

    // When date is selected, update the display field
    dateInput.addEventListener('change', function () {
        if (this.value) {
            displayInput.value = formatDate(this.value);
        }
    });
}

function setupRenewalModal() {
    const renewBtn = document.getElementById('renewBtn');
    const modal = document.getElementById('renewalModal');
    const closeBtn = document.getElementById('closeRenewalBtn');
    const searchBtn = document.getElementById('searchBtn');
    const renewalForm = document.getElementById('renewalForm');

    // FIX: Prevent checkbox labels from triggering date picker in renewal form
    const renewalCheckboxLabels = document.querySelectorAll('.renewal-checkbox');
    renewalCheckboxLabels.forEach(label => {
        label.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const checkbox = label.querySelector('input[type="checkbox"]');
            if (checkbox && e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                const event = new Event('change', { bubbles: true });
                checkbox.dispatchEvent(event);
            }
        });
    });

    // Open modal
    if (renewBtn) {
        renewBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            modal.style.display = 'flex';
            resetRenewalModal();
        });
    }

    // Close modal
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Search member
    searchBtn.addEventListener('click', searchMember);
    document.getElementById('searchMember').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchMember();
        }
    });

    // Renewal checkboxes
    document.getElementById('renewMonthly').addEventListener('change', function () {
        document.getElementById('renewMonthlyDetails').style.display = this.checked ? 'block' : 'none';
        updateRenewalInfo();
    });

    document.getElementById('renewCombative').addEventListener('change', function () {
        document.getElementById('renewCombativeDetails').style.display = this.checked ? 'block' : 'none';
        updateRenewalInfo();
    });

    // Duration changes
    document.getElementById('renewalDate').addEventListener('change', updateRenewalInfo);
    document.getElementById('renewMonthlyDuration').addEventListener('input', updateRenewalInfo);
    document.getElementById('renewCombativeSessions').addEventListener('input', updateRenewalInfo);

    // Renewal form submission
    renewalForm.addEventListener('submit', handleRenewal);
}

function resetRenewalModal() {
    document.getElementById('searchMember').value = '';
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('selectedMemberSection').style.display = 'none';
    document.getElementById('renewalForm').reset();

    const today = new Date();
    const renewalDateInput = document.getElementById('renewalDate');
    if (renewalDateInput) {
        renewalDateInput.valueAsDate = today;
    }

    document.getElementById('renewMonthlyDetails').style.display = 'none';
    document.getElementById('renewCombativeDetails').style.display = 'none';
    document.getElementById('renewalInfoBox').style.display = 'none';
    selectedMember = null;
}

async function searchMember() {
    const query = document.getElementById('searchMember').value.trim();
    const resultsDiv = document.getElementById('searchResults');

    if (!query || query.length < 2) {
        showMessage('Please enter at least 2 characters', 'error');
        return;
    }

    try {
        const authUser = JSON.parse(localStorage.getItem('authUser'));
        const response = await fetch(`${SERVER_URL}/api/members/search?query=${encodeURIComponent(query)}`, {
            headers: {
                'Authorization': `Bearer ${authUser.token}`
            }
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Search failed');
        }

        if (result.data.length === 0) {
            resultsDiv.innerHTML = '<p class="no-results">No members found</p>';
            return;
        }

        resultsDiv.innerHTML = result.data.map(member => `
                    <div class="search-result-item" onclick='selectMemberForRenewal(${JSON.stringify(member).replace(/'/g, "&apos;")})'>
                        <div class="result-info">
                            <strong>${member.memberId}</strong> - ${member.name}
                            <br>
                            <small>Status: <span class="status-${member.status}">${member.status}</span></small>
                        </div>
                    </div>
                `).join('');

    } catch (error) {
        showMessage('Error searching members: ' + error.message, 'error');
    }
}

function selectMemberForRenewal(member) {
    selectedMember = member;
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('selectedMemberSection').style.display = 'block';

    const memberInfoCard = document.getElementById('memberInfoCard');

    let membershipHTML = '';
    if (member.memberships && member.memberships.length > 0) {
        membershipHTML = member.memberships.map(m => {
            const endDate = new Date(m.endDate);
            const isExpired = endDate < new Date();
            return `
                        <div class="membership-item ${isExpired ? 'expired' : m.status}">
                            <span class="membership-type">${m.type.toUpperCase()}</span>
                            <span class="membership-status">${m.status}</span>
                            <span class="membership-date">Expires: ${formatDate(endDate)}</span>
                        </div>
                    `;
        }).join('');
    } else {
        membershipHTML = '<p class="no-membership">No active memberships</p>';
    }

    memberInfoCard.innerHTML = `
                <h4><i class="fas fa-user-circle"></i> ${member.name}</h4>
                <p><strong>Member ID:</strong> ${member.memberId}</p>
                <p><strong>Status:</strong> <span class="status-badge status-${member.status}">${member.status}</span></p>
                <div class="membership-list">
                    <strong>Current Memberships:</strong>
                    ${membershipHTML}
                </div>
            `;
}

function updateRenewalInfo() {
    if (!selectedMember) return;

    const renewalDateInput = document.getElementById('renewalDate');
    if (!renewalDateInput.value) return;

    const renewalDate = new Date(renewalDateInput.value);
    const monthlyChecked = document.getElementById('renewMonthly').checked;
    const combativeChecked = document.getElementById('renewCombative').checked;
    const infoBox = document.getElementById('renewalInfoBox');

    if (!monthlyChecked && !combativeChecked) {
        infoBox.style.display = 'none';
        return;
    }

    let infoHTML = '<strong><i class="fas fa-info-circle"></i> Renewal Summary:</strong><br><br>';

    if (monthlyChecked) {
        const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
        const currentMembership = selectedMember.memberships?.find(m => m.type === 'monthly');
        const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');

        infoHTML += `
                    <div class="info-item">
                        <strong>Monthly Membership:</strong><br>
                        <span class="detail-line">Start Date: ${formatDate(renewalDate)}</span><br>
                        <span class="detail-line">End Date: ${formatDate(endDate)}</span><br>
                        <span class="detail-line">Duration: ${duration} month(s)</span>
                    </div>
                `;
    }

    if (combativeChecked) {
        const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
        const currentMembership = selectedMember.memberships?.find(m => m.type === 'combative');
        const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, 1, 'combative');

        infoHTML += `
                    <div class="info-item">
                        <strong>Combative Membership:</strong><br>
                        <span class="detail-line">Start Date: ${formatDate(renewalDate)}</span><br>
                        <span class="detail-line">End Date: ${formatDate(endDate)}</span><br>
                        <span class="detail-line">Sessions: ${sessions}</span><br>
                        <span class="detail-line">Duration: 1 month</span>
                    </div>
                `;
    }

    infoBox.innerHTML = infoHTML;
    infoBox.style.display = 'block';
}

function calculateNewEndDate(renewalDate, currentEndDateStr, durationMonths, membershipType) {
    const renewal = new Date(renewalDate);
    const currentEnd = currentEndDateStr ? new Date(currentEndDateStr) : null;

    if (membershipType === 'combative' && currentEnd) {
        const twoMonthsAgo = new Date(renewal);
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

        if (currentEnd < twoMonthsAgo) {
            const newEnd = new Date(renewal);
            newEnd.setMonth(newEnd.getMonth() + durationMonths);
            return newEnd;
        }
    }

    if (currentEnd && renewal < currentEnd) {
        const newEnd = new Date(currentEnd);
        newEnd.setMonth(newEnd.getMonth() + durationMonths);
        return newEnd;
    } else {
        const newEnd = new Date(renewal);
        newEnd.setMonth(newEnd.getMonth() + durationMonths);
        return newEnd;
    }
}

async function handleRenewal(e) {
    e.preventDefault();

    if (!selectedMember) {
        showMessage('Please select a member first', 'error');
        return;
    }

    const monthlyChecked = document.getElementById('renewMonthly').checked;
    const combativeChecked = document.getElementById('renewCombative').checked;

    if (!monthlyChecked && !combativeChecked) {
        showMessage('Please select at least one membership type to renew', 'error');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        const renewalDate = new Date(document.getElementById('renewalDate').value);
        const updatedMemberships = [];

        if (selectedMember.memberships) {
            selectedMember.memberships.forEach(m => {
                if (m.type === 'monthly' && !monthlyChecked) {
                    updatedMemberships.push(m);
                } else if (m.type === 'combative' && !combativeChecked) {
                    updatedMemberships.push(m);
                }
            });
        }

        if (monthlyChecked) {
            const duration = parseInt(document.getElementById('renewMonthlyDuration').value) || 1;
            const currentMembership = selectedMember.memberships?.find(m => m.type === 'monthly');
            const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, duration, 'monthly');

            updatedMemberships.push({
                type: 'monthly',
                duration: duration,
                startDate: renewalDate.toISOString(),
                endDate: endDate.toISOString(),
                status: 'active'
            });
        }

        if (combativeChecked) {
            const sessions = parseInt(document.getElementById('renewCombativeSessions').value) || 12;
            const currentMembership = selectedMember.memberships?.find(m => m.type === 'combative');
            const endDate = calculateNewEndDate(renewalDate, currentMembership?.endDate, 1, 'combative');

            updatedMemberships.push({
                type: 'combative',
                duration: sessions,
                remainingSessions: sessions,
                startDate: renewalDate.toISOString(),
                endDate: endDate.toISOString(),
                status: 'active'
            });
        }

        const authUser = JSON.parse(localStorage.getItem('authUser'));
        const response = await fetch(`${SERVER_URL}/api/members/${selectedMember._id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authUser.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                memberships: updatedMemberships,
                status: 'active'
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showMessage('Membership renewed successfully!', 'success');
            setTimeout(() => {
                document.getElementById('renewalModal').style.display = 'none';
                resetRenewalModal();
            }, 2000);
        } else {
            throw new Error(result.error || 'Failed to renew membership');
        }

    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'Adding...';

    const memberships = [];
    if (document.getElementById('monthlyCheckbox').checked) {
        memberships.push({
            type: 'monthly',
            duration: parseInt(document.getElementById('monthlyDuration').value)
        });
    }
    if (document.getElementById('combativeCheckbox').checked) {
        memberships.push({
            type: 'combative',
            duration: parseInt(document.getElementById('combativeSessions').value)
        });
    }

    if (memberships.length === 0) {
        showMessage("Please select at least one membership type", "error");
        btn.disabled = false;
        btn.textContent = originalText;
        return;
    }

    const formData = new FormData();
    formData.append('name', document.getElementById('memberName').value.trim());
    formData.append('birthdate', document.getElementById('birthdate').value);
    formData.append('joinDate', document.getElementById('joinDate').value);
    formData.append('phone', document.getElementById('phone').value.trim() || '');
    formData.append('email', document.getElementById('email').value.trim() || '');
    formData.append('faceEnrolled', faceSuccessfullyCaptured ? 'yes' : 'no');
    formData.append('memberships', JSON.stringify(memberships));

    if (faceImageBlob) {
        formData.append('faceImage', faceImageBlob, 'face.jpg');
    }

    try {
        const authUser = JSON.parse(localStorage.getItem('authUser'));
        const response = await fetch(`${SERVER_URL}/api/members`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authUser.token}`
            },
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            showMessage('Member added successfully!', 'success');
            setTimeout(() => {
                document.getElementById('memberForm').reset();

                // Reset join date to today
                const today = new Date();
                document.getElementById('joinDate').valueAsDate = today;
                document.getElementById('joinDateDisplay').value = formatDate(today);
                document.getElementById('birthdateDisplay').value = '';

                document.getElementById('monthlyDetails').style.display = 'none';
                document.getElementById('combativeDetails').style.display = 'none';
                document.getElementById('faceStatus').textContent = '';
                faceSuccessfullyCaptured = false;
                document.getElementById('message').className = 'message hidden';
            }, 2000);
        } else {
            showMessage(result.error || 'Failed to add member', 'error');
        }
    } catch (error) {
        showMessage('Network error: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function setupFaceCapture() {
    const openBtn = document.getElementById('openFacePaneBtn');
    const closeBtn = document.getElementById('closeFacePaneBtn');
    const captureBtn = document.getElementById('captureFaceBtn');
    const confirmBtn = document.getElementById('confirmFaceBtn');
    const facePane = document.getElementById('facePane');
    const video = document.getElementById('camera');
    const canvas = document.getElementById('snapshot');
    const faceStatus = document.getElementById('faceStatus');
    const resultMsg = document.getElementById('faceResultMsg');

    let stream = null;

    openBtn.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
            video.style.display = 'block';
            canvas.style.display = 'none';
            facePane.style.display = 'flex';
            confirmBtn.disabled = true;
            resultMsg.textContent = '';
        } catch (err) {
            alert('Camera access denied or unavailable');
        }
    });

    closeBtn.addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        facePane.style.display = 'none';
        video.style.display = 'block';
        canvas.style.display = 'none';
    });

    captureBtn.addEventListener('click', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        canvas.toBlob(blob => {
            faceImageBlob = blob;
        }, 'image/jpeg');

        video.style.display = 'none';
        canvas.style.display = 'block';
        confirmBtn.disabled = false;
        resultMsg.textContent = 'Photo captured! Review and confirm or retake.';
    });

    confirmBtn.addEventListener('click', () => {
        faceSuccessfullyCaptured = true;
        faceStatus.textContent = '✓ Face Captured';
        faceStatus.className = 'fp-status-message success';

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        facePane.style.display = 'none';
        resultMsg.textContent = '';
    });
}

function showMessage(text, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
        messageDiv.className = 'message hidden';
    }, 5000);
}