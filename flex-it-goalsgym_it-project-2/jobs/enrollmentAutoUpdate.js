const cron = require('node-cron');
const Enrollment = require('../models/Enrollment');
const Member = require('../models/Member');

// Run at 23:59 (11:59 PM) every day
const initEnrollmentAutoUpdate = () => {
    cron.schedule('59 23 * * *', async () => {
        try {
            console.log('[CRON] Running End-of-Day Enrollment Check...');

            // Get the start and end of the current day
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            // Find all enrollments for today that are still 'scheduled'
            const pastEnrollments = await Enrollment.find({
                attendance_status: 'scheduled',
                status: 'active',
                session_date: { $gte: todayStart, $lte: todayEnd }
            });

            if (pastEnrollments.length === 0) {
                console.log('[CRON] No un-attended enrollments found for today.');
                return;
            }

            console.log(`[CRON] Found ${pastEnrollments.length} un-attended enrollments. Processing...`);

            for (const enrollment of pastEnrollments) {
                // Mark as missed
                enrollment.attendance_status = 'missed';
                // Note: We do NOT set status to 'completed' so it's clear it was missed

                // Refund the combative session since they didn't show up
                const member = await Member.findOne({ memberId: enrollment.member_id });
                if (member) {
                    const activeCombative = member.memberships?.find(m => m.type === 'combative' && m.status === 'active');
                    if (activeCombative) {
                        activeCombative.remainingSessions = (activeCombative.remainingSessions || 0) + 1;
                        await member.save();
                        console.log(`[CRON] Refunded 1 session to ${member.memberId}`);
                    }
                }

                enrollment.refund_processed = true;
                await enrollment.save();
            }

            console.log(`[CRON] Successfully processed ${pastEnrollments.length} missed enrollments.`);

        } catch (error) {
            console.error('[CRON] Error in End-of-Day Enrollment Check:', error);
        }
    });
};

module.exports = { initEnrollmentAutoUpdate };