    document.addEventListener('DOMContentLoaded', () => {
      const menuToggle = document.getElementById('menuToggle');
      const sidebar = document.querySelector('.sidebar');
      const logoutBtn = document.getElementById('logoutBtn');
      const authUser = JSON.parse(localStorage.getItem('authUser'));

      menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
      });

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

      sidebar.addEventListener('transitionend', () => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed')) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = 'auto';
        }
      });

      document.getElementById('specialization').addEventListener('change', function () {
        const customField = document.getElementById('custom_specialization');
        const customLabel = document.getElementById('custom_label');
        if (this.value === 'Other') {
          customField.style.display = 'block';
          customLabel.style.display = 'block';
          customField.required = true;
        } else {
          customField.style.display = 'none';
          customLabel.style.display = 'none';
          customField.required = false;
          customField.value = '';
        }
      });

      document.getElementById('trainerForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        const submitBtn = document.querySelector('.add-trainer-button');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';

        try {
          let specialization = document.getElementById('specialization').value;
          if (specialization === 'Other') {
            specialization = document.getElementById('custom_specialization').value.trim();
          }
          const assignedClassesInput = document.getElementById('assigned_classes').value.trim();
          const assignedClasses = assignedClassesInput
            ? assignedClassesInput.split(',').map((cls) => cls.trim()).filter(Boolean)
            : [];
          const email = document.getElementById('email').value.trim();
          const sendEmailVal = document.querySelector('input[name="send_email"]:checked').value;
          const send_email = (sendEmailVal === "yes");

          const trainerData = {
            name: document.getElementById('name').value.trim(),
            email: email,
            specialization: specialization,
            is_available: document.getElementById('is_available').checked,
            assigned_classes: assignedClasses,
            send_email: send_email
          };

          const response = await fetch('http://localhost:8080/api/trainers', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
            },
            body: JSON.stringify(trainerData),
          });

          const responseData = await response.json();

          if (!response.ok) {
            let errorMsg = 'Failed to add trainer';
            if (responseData.details) {
              errorMsg +=
                ':\n' +
                Object.entries(responseData.details)
                  .filter(([_, value]) => value)
                  .map(([field, error]) => `• ${field}: ${error}`)
                  .join('\n');
            } else if (responseData.error) {
              errorMsg = responseData.error;
            }
            throw new Error(errorMsg);
          }

          let emailMsg = '';
          if (send_email) {
            emailMsg = 'An email was sent to the trainer.\n';
          } else {
            emailMsg = 'No email was sent to the trainer. Please provide the credentials manually.\n';
          }

          alert(`Trainer added successfully!\nUsername: ${responseData.data.username}\nTemporary Password: ${responseData.data.tempPassword}\n${emailMsg}Trainer should change password upon first login.\nTrainer ID: ${responseData.data.trainer_id}\nName: ${responseData.data.name}`);
          this.reset();
          document.getElementById('custom_specialization').style.display = 'none';
          document.getElementById('custom_label').style.display = 'none';
        } catch (err) {
          console.error('Error:', err);
          alert(`Error: ${err.message}`);
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Add Trainer';
        }
      });
    });