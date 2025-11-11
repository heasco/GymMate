const cron = require('node-cron');
const mongoose = require('mongoose');
const Member = require('../models/Member');

/**
 * Initialize membership status update job
 * Runs daily at midnight to check and deactivate expired memberships
 * 
 * Logic:
 * - If 1 membership expires: mark that membership as 'inactive'
 * - If ALL memberships expire: mark member status as 'inactive'
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
      
      // Find members with at least one expired membership that is still marked as active
      const members = await Member.find({
        'memberships.endDate': { $lt: now },
        'memberships.status': 'active'
      });

      let updatedCount = 0;
      let memberStatusChangedCount = 0;

      for (const member of members) {
        let memberUpdated = false;
        let expiredCount = 0;
        let totalMemberships = member.memberships.length;
        
        // Update expired memberships
        member.memberships.forEach(membership => {
          if (membership.endDate < now && membership.status === 'active') {
            membership.status = 'inactive';
            memberUpdated = true;
            expiredCount++;
          } else if (membership.status === 'inactive' || membership.status === 'expired') {
            expiredCount++;
          }
        });

        // If ALL memberships are expired/inactive, mark member as inactive
        if (expiredCount === totalMemberships && totalMemberships > 0) {
          if (member.status !== 'inactive') {
            member.status = 'inactive';
            memberStatusChangedCount++;
            console.log(`[Cron] Member ${member.memberId} - All memberships expired, setting member status to inactive`);
          }
        }

        if (memberUpdated) {
          await member.save();
          updatedCount++;
        }
      }

      console.log(`[Cron] Membership status update completed:`);
      console.log(`  - ${updatedCount} members with expired memberships updated`);
      console.log(`  - ${memberStatusChangedCount} members marked as inactive (all memberships expired)`);
    } catch (error) {
      console.error('[Cron] Error in membership status update job:', error);
    }
  });

  console.log('[Cron] Membership status update job scheduled (runs daily at midnight)');
}

module.exports = { initMembershipStatusUpdate };
