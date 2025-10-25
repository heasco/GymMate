const cron = require('node-cron');
const Enrollment = require('../models/Enrollment');

/**
 * Auto-update enrollments:
 * - Mark as 'missed' if session_date has passed and attendance_status is still 'scheduled'
 * - Set status to 'cancelled'
 */
async function updatePastEnrollments() {
  try {
    const now = new Date();
    
    // 1. session_date is in the past
    // 2. attendance_status is still 'scheduled'
    // 3. status is 'active'
    const result = await Enrollment.updateMany(
      {
        session_date: { $lt: now },
        attendance_status: 'scheduled',
        status: 'active'
      },
      {
        $set: {
          attendance_status: 'missed',
          status: 'cancelled',
          cancelled_at: now
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[${new Date().toISOString()}] Auto-updated ${result.modifiedCount} past enrollments to 'missed' and 'cancelled'`);
    }
  } catch (error) {
    console.error('[Enrollment Auto-Update Error]:', error);
  }
}

/**
 * Initialize the cron job
 */
function initEnrollmentAutoUpdate() {
  // Schedule: Run every hour
  // Format: minute hour day month dayOfWeek
  // '0 * * * *' means: at minute 0 of every hour
  // use '*/1 * * * *' for testing runs every minute:
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Running enrollment auto-update job...');
    await updatePastEnrollments();
  });

  console.log('[Cron] Enrollment auto-update job scheduled (runs every hour)');
  
  // Run once immediately on server start
  updatePastEnrollments();
}

module.exports = { initEnrollmentAutoUpdate, updatePastEnrollments };
