const cron = require('node-cron');
const mongoose = require('mongoose');
const Member = require('../models/Member');
const MembershipHistory = require('../models/MembershipHistory'); // Import the History model

/**
 * Initialize membership status update job
 * Runs daily at midnight to check for ended memberships.
 * * Logic:
 * - If a membership has reached its endDate, move it to MembershipHistory.
 * - Set the history's endDate to the exact date/time it was archived.
 * - Remove the ended membership from the Member's profile.
 * - If the Member has NO active memberships left, change their profile status to 'inactive'.
 */
function initMembershipStatusUpdate() {
  cron.schedule('0 0 * * *', async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.log('[Cron] Skipping membership status update - database not connected');
        return;
      }

      console.log('[Cron] Running membership status update job...');
      
      const now = new Date();
      
      // Find members who have at least one membership where the endDate has passed
      const members = await Member.find({
        'memberships.endDate': { $lt: now }
      });

      let updatedCount = 0;
      let memberStatusChangedCount = 0;
      let archivedMembershipsCount = 0;

      for (const member of members) {
        let memberUpdated = false;
        const activeMemberships = [];
        const historyDocs = [];
        
        // Sort memberships into "still active" and "ended"
        member.memberships.forEach(membership => {
          if (membership.endDate < now) {
            // Membership has ended -> Archive it
            let dur = membership.duration;
            // Fallback calculation for older records missing duration
            if (!dur && membership.startDate && membership.endDate) {
              dur = (new Date(membership.endDate).getFullYear() - new Date(membership.startDate).getFullYear()) * 12 + 
                    (new Date(membership.endDate).getMonth() - new Date(membership.startDate).getMonth());
            }
            
            historyDocs.push({
              member: member._id,
              memberIdString: member.memberId,
              type: membership.type,
              duration: dur || 1,
              startDate: membership.startDate,
              endDate: now, // Set the end date to the exact time of archiving
              remainingSessions: membership.remainingSessions,
              archivedAt: now
            });
            
            archivedMembershipsCount++;
            memberUpdated = true;
          } else {
            // Membership is still active
            activeMemberships.push(membership);
          }
        });

        if (memberUpdated) {
          // Save the archived memberships to the History collection
          if (historyDocs.length > 0) {
            await MembershipHistory.insertMany(historyDocs);
          }
          
          // Overwrite the member's memberships with only the active ones left
          member.memberships = activeMemberships;

          // If ALL memberships are now gone, mark member as inactive
          if (activeMemberships.length === 0 && member.status !== 'inactive') {
            member.status = 'inactive';
            memberStatusChangedCount++;
            console.log(`[Cron] Member ${member.memberId} - All memberships ended, setting member status to inactive`);
          }

          await member.save();
          updatedCount++;
        }
      }

      console.log(`[Cron] Membership status update completed:`);
      console.log(`  - ${archivedMembershipsCount} ended memberships archived to history`);
      console.log(`  - ${updatedCount} members updated`);
      console.log(`  - ${memberStatusChangedCount} members marked as inactive (no memberships left)`);
    } catch (error) {
      console.error('[Cron] Error in membership status update job:', error);
    }
  });

  console.log('[Cron] Membership status update job scheduled (runs daily at midnight)');
}

module.exports = { initMembershipStatusUpdate };