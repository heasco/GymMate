const cron = require('node-cron');
const mongoose = require('mongoose');
const Member = require('../models/Member');

/**
 * Initialize membership status update job
 * Runs daily at midnight to check and deactivate expired memberships
 */
function initMembershipStatusUpdate() {
  cron.schedule('0 0 * * *', async () => {
    try {
      // Check if mongoose is connected before running
      if (mongoose.connection.readyState !== 1) {
        console.log('[Cron] Skipping membership status update - database not connected');
        return;
      }

      console.log('[Cron] Running membership status update job...');
      
      const now = new Date();
      
      // Find members with expired memberships
      const members = await Member.find({
        'memberships.endDate': { $lt: now },
        'memberships.status': 'active'
      });

      let updatedCount = 0;

      for (const member of members) {
        let memberUpdated = false;
        
        member.memberships.forEach(membership => {
          if (membership.endDate < now && membership.status === 'active') {
            membership.status = 'expired';
            memberUpdated = true;
          }
        });

        if (memberUpdated) {
          await member.save();
          updatedCount++;
        }
      }

      console.log(`[Cron] Membership status update completed: ${updatedCount} members updated`);
    } catch (error) {
      console.error('[Cron] Error in membership status update job:', error);
    }
  });

  console.log('[Cron] Membership status update job scheduled (runs daily at midnight)');
}

module.exports = { initMembershipStatusUpdate };
