const cron = require('node-cron');
const Member = require('../models/Member');
const transporter = require('../utils/nodemailer');

/**
 * Calculate if a date is exactly 3 days from now
 */
function isThreeDaysFromNow(date) {
  const now = new Date();
  const threeDaysLater = new Date();
  threeDaysLater.setDate(now.getDate() + 3);
  
  // Compare dates (ignoring time)
  const targetDate = new Date(date);
  return (
    targetDate.getDate() === threeDaysLater.getDate() &&
    targetDate.getMonth() === threeDaysLater.getMonth() &&
    targetDate.getFullYear() === threeDaysLater.getFullYear()
  );
}

/**
 * Calculate expiry date (1 month from start date)
 * Handles month-to-month calculation properly
 */
function calculateExpiryDate(startDate) {
  const expiry = new Date(startDate);
  
  // Add 1 month
  expiry.setMonth(expiry.getMonth() + 1);
  
  // Handle edge case: if day doesn't exist in target month (e.g., Jan 31 -> Feb 31)
  // JavaScript automatically adjusts, but we want to be explicit
  const originalDay = new Date(startDate).getDate();
  
  // If the day changed (e.g., became March 3rd instead of Feb 31st), 
  // set it to the last day of the intended month
  if (expiry.getDate() !== originalDay) {
    expiry.setDate(0); // Sets to last day of previous month
  }
  
  return expiry;
}

/**
 * Check for memberships expiring in 3 days and send reminder emails
 */
async function checkMembershipExpiry() {
  try {
    const now = new Date();
    
    // Get all active members with active memberships
    const members = await Member.find({
      'memberships.status': 'active',
      email: { $exists: true, $ne: '', $ne: null },
      status: 'active'
    });

    let emailsSent = 0;
    let membershipsChecked = 0;

    for (const member of members) {
      // Check each active membership
      const expiringMemberships = member.memberships.filter(membership => {
        if (membership.status !== 'active') return false;
        
        membershipsChecked++;
        
        // Calculate the expiry date based on startDate + 1 month
        const expiryDate = calculateExpiryDate(membership.startDate);
        
        // Check if this expiry date is exactly 3 days from now
        return isThreeDaysFromNow(expiryDate);
      });

      if (expiringMemberships.length === 0) continue;

      // Send email for each expiring membership
      for (const membership of expiringMemberships) {
        try {
          const expiryDate = calculateExpiryDate(membership.startDate);
          const formattedExpiryDate = expiryDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

          const formattedStartDate = new Date(membership.startDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

          const membershipType = membership.type === 'monthly' ? 'Monthly Membership' : 'Combative Training Membership';

          // Email content
          const mailOptions = {
            from: `"Flex-IT-GoalsGym" <${process.env.EMAIL_USER}>`,
            to: member.email,
            subject: '⏰ Membership Expiration Reminder - Flex-IT-GoalsGym',
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <style>
                  body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                  }
                  .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f9f9f9;
                  }
                  .header {
                    background-color: #21808d;
                    color: white;
                    padding: 20px;
                    text-align: center;
                    border-radius: 5px 5px 0 0;
                  }
                  .content {
                    background-color: white;
                    padding: 30px;
                    border-radius: 0 0 5px 5px;
                  }
                  .highlight {
                    background-color: #fff3cd;
                    border-left: 4px solid #ffc107;
                    padding: 15px;
                    margin: 20px 0;
                  }
                  .details {
                    background-color: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                  }
                  .footer {
                    text-align: center;
                    margin-top: 20px;
                    font-size: 12px;
                    color: #666;
                  }
                  .button {
                    display: inline-block;
                    padding: 12px 30px;
                    background-color: #21808d;
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                    margin-top: 15px;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>🏋️ Flex-IT-GoalsGym</h1>
                  </div>
                  <div class="content">
                    <h2>Hi ${member.name},</h2>
                    <p>This is a friendly reminder that your membership is about to expire soon!</p>
                    
                    <div class="highlight">
                      <strong>⚠️ Your membership will expire in 3 days</strong>
                    </div>

                    <div class="details">
                      <h3>Membership Details:</h3>
                      <p><strong>Member ID:</strong> ${member.memberId}</p>
                      <p><strong>Membership Type:</strong> ${membershipType}</p>
                      <p><strong>Start Date:</strong> ${formattedStartDate}</p>
                      <p><strong>Expiration Date:</strong> ${formattedExpiryDate}</p>
                      ${membership.type === 'combative' ? `<p><strong>Remaining Sessions:</strong> ${membership.remainingSessions}</p>` : ''}
                    </div>

                    <p>Don't let your fitness journey stop! Renew your membership today to continue enjoying:</p>
                    <ul>
                      <li>✅ Full access to gym facilities</li>
                      <li>✅ Professional trainer guidance</li>
                      <li>✅ Group fitness classes</li>
                      <li>✅ Personalized workout plans</li>
                    </ul>

                    <p style="text-align: center;">
                      <a href="#" class="button">Renew Membership</a>
                    </p>

                    <p>If you have any questions or need assistance with renewal, please don't hesitate to contact us or visit the gym.</p>

                    <p>Stay strong and keep pushing towards your goals!</p>
                    
                    <p>Best regards,<br>
                    <strong>Flex-IT-GoalsGym Team</strong></p>
                  </div>
                  <div class="footer">
                    <p>This is an automated reminder. Please do not reply to this email.</p>
                    <p>&copy; ${new Date().getFullYear()} Flex-IT-GoalsGym. All rights reserved.</p>
                  </div>
                </div>
              </body>
              </html>
            `
          };

          // Send email
          await transporter.sendMail(mailOptions);
          emailsSent++;
          
          console.log(`✓ Expiry reminder sent to ${member.email} (${member.memberId}) - ${membershipType} expires ${formattedExpiryDate}`);
        } catch (emailError) {
          console.error(`✗ Failed to send email to ${member.email}:`, emailError.message);
        }
      }
    }

    if (emailsSent > 0) {
      console.log(`[${new Date().toISOString()}] Checked ${membershipsChecked} memberships, sent ${emailsSent} expiry reminder(s)`);
    } else {
      console.log(`[${new Date().toISOString()}] Checked ${membershipsChecked} memberships, no memberships expiring in 3 days`);
    }
  } catch (error) {
    console.error('[Membership Expiry Reminder Error]:', error);
  }
}

/**
 * Initialize the cron job
 * Runs every day at 9:00 AM
 */
function initMembershipExpiryReminder() {
  // Schedule: Run every day at 9:00 AM
  // Format: minute hour day month dayOfWeek
  // '0 9 * * *' means: at 9:00 AM every day
  cron.schedule('0 9 * * *', async () => {
    console.log('[Cron] Running membership expiry reminder job...');
    await checkMembershipExpiry();
  });

  console.log('[Cron] Membership expiry reminder job scheduled (runs daily at 9:00 AM)');
  
  // Optional: Run once immediately on server start for testing
  // Uncomment the line below to test immediately:
  // checkMembershipExpiry();
}

module.exports = { initMembershipExpiryReminder, checkMembershipExpiry };
