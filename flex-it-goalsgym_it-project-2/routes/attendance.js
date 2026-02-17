const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Member = require('../models/Member');
const Enrollment = require('../models/Enrollment');

// Add these for the new route (matches your other files like enrollments.js)
const asyncHandler = require('../middleware/asyncHandler');

const mongoose = require('mongoose');  // For ObjectId.isValid (standard in Mongoose projects)

router.post('/log', async (req, res) => {
  const { faceId, attendedType, classId } = req.body;
  try {
    const member = await Member.findOne({ faceId });
    if (!member) {
      return res.json({ success: false, error: "Member not found" });
    }

    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    // Membership logic
    const activeMemberships = member.memberships.filter(m =>
      m.status === "active" &&
      now >= new Date(m.startDate) &&
      now <= new Date(m.endDate)
    );
    const hasCombative = activeMemberships.some(m => m.type === "combative");
    const hasMonthly = activeMemberships.some(m => m.type === "monthly");

    // Only enrollments not already attended
    const enrollmentsToday = await Enrollment.find({
      member_id: member.memberId,
      session_date: { $gte: todayStart, $lte: todayEnd },
      attendance_status: { $ne: "attended" }
    });

    // Only show panel if NOT attended yet this day
    if (!attendedType && hasMonthly && hasCombative && enrollmentsToday.length) {
      return res.json({
        success: true,
        requiresSelection: true,
        data: {
          options: ["gym", "combative", "both"],
          classOptions: enrollmentsToday.map(e => e.class_id) // use correct field
        }
      });
    }

    let finalAttendedType = attendedType || "gym";
    let finalClassId = classId || null;
    if (!attendedType && hasCombative && enrollmentsToday.length) {
      finalAttendedType = "combative";
      finalClassId = enrollmentsToday[0].class_id;
    }

    const loginToday = await Attendance.findOne({
      memberId: member._id,
      logType: 'login',
      timestamp: { $gte: todayStart, $lte: todayEnd }
    }).sort({ timestamp: 1 });

    const logoutToday = await Attendance.findOne({
      memberId: member._id,
      logType: 'logout',
      timestamp: { $gte: todayStart, $lte: todayEnd }
    }).sort({ timestamp: 1 });

    if (!loginToday) {
      // No login today, allow login
      const attendance = new Attendance({
        memberId: member._id,
        logType: 'login',
        timestamp: now,
        attendedType: finalAttendedType,
        classId: finalClassId
      });
      await attendance.save();

      // MARK ENROLLMENT ATTENDED
      if (["combative", "both"].includes(finalAttendedType) && finalClassId) {
        await Enrollment.updateMany(
          {
            member_id: member.memberId,
            class_id: finalClassId,
            session_date: { $gte: todayStart, $lte: todayEnd },
            attendance_status: { $ne: "attended" }
          },
          { $set: { attendance_status: "attended", attended_at: now } }
        );
      }
      return res.json({
        success: true,
        data: { memberName: member.name },
        logged: finalAttendedType
      });

    } else if (!logoutToday) {
      // Already logged in, not yet logged out
      const minsSinceLogin = ((now - loginToday.timestamp) / 60000);
      if (minsSinceLogin < 30) {
        return res.json({
          success: true,
          alreadyLoggedIn: true,
          data: { memberName: member.name },
          minsSinceLogin: minsSinceLogin.toFixed(1)
        });
      } else {
        // Allow logout
        const attendance = new Attendance({
          memberId: member._id,
          logType: 'logout',
          timestamp: now,
          attendedType: finalAttendedType,
          classId: finalClassId
        });
        await attendance.save();

        return res.json({
          success: true,
          data: { memberName: member.name },
          logged: "logout",
          minsSinceLogin: minsSinceLogin.toFixed(1)
        });
      }
    } else {
      let lastEvent = loginToday.timestamp;
      if (logoutToday && logoutToday.timestamp > lastEvent) lastEvent = logoutToday.timestamp;
      const minsSinceLast = ((now - lastEvent) / 60000).toFixed(1);

      return res.json({
        success: true,
        alreadyLoggedIn: true,
        data: { memberName: member.name },
        minsSinceLast
      });
    }

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ✅ ADD THIS NEW ROUTE - Dashboard statistics
router.get('/today', async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Get all logs from today with member info
        const logs = await Attendance.find({
            timestamp: { $gte: todayStart, $lte: todayEnd }
        })
        .sort({ timestamp: -1 })
        .populate('memberId', 'name');

        // Calculate stats
        const totalCheckins = logs.filter(l => l.logType === 'login').length;
        
        // Determine who's currently in gym
        const memberStatus = {};
        for (const log of logs) {
            const mId = log.memberId?._id?.toString();
            if (!mId) continue;
            
            if (!memberStatus[mId] || log.timestamp > memberStatus[mId].timestamp) {
                memberStatus[mId] = log;
            }
        }
        
        const currentlyInGym = Object.values(memberStatus)
            .filter(log => log.logType === 'login').length;
        
        // Get last check-in
        const lastCheckin = logs.find(l => l.logType === 'login');
        
        // Format recent activity
        const recentActivity = logs.slice(0, 10).map(log => ({
            memberName: log.memberId?.name || 'Unknown',
            type: log.logType === 'login' ? 'check-in' : 'check-out',
            timestamp: log.timestamp,
            attendedType: log.attendedType
        }));

        res.json({
            success: true,
            data: {
                totalCheckins,
                currentlyInGym,
                lastCheckin: lastCheckin ? {
                    timestamp: lastCheckin.timestamp,
                    memberName: lastCheckin.memberId?.name || 'Unknown'
                } : null,
                recentActivity
            }
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.get('/logs/today', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Populate with member name (assuming Attendance Schema ref: 'Member')
    const logs = await Attendance.find({
      timestamp: { $gte: todayStart, $lte: todayEnd }
    })
    .sort({ timestamp: -1 })
    .populate('memberId', 'name'); // 'name' field in Member

    res.json({ success: true, logs });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// NEW: GET /member/:id?start&end - Fetch member-specific logs by date range (for calendar)
router.get('/member/:id', asyncHandler(async (req, res) => {
  const { start, end } = req.query;
  const memberId = req.params.id;

  // Optional: Self-access check (members view only own; admins/trainers can view all)
  const userRole = req.user.role;
  if (userRole === 'member' && req.user.id !== memberId) {
    return res.status(403).json({ success: false, error: 'Access denied: Cannot view other member\'s attendance' });
  }

  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    return res.status(400).json({ success: false, error: 'Invalid member ID' });
  }

  const filter = { memberId: new mongoose.Types.ObjectId(memberId) };

  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) {
      return res.status(400).json({ success: false, error: 'Invalid date range' });
    }
    filter.timestamp = { $gte: startDate, $lte: endDate };
  }

  // Fetch all logs (login/logout pairs) sorted by timestamp for frontend aggregation
  const logs = await Attendance.find(filter)
    .sort({ timestamp: 1 })  // Ascending for first/last per day
    .select('logType timestamp attendedType classId')  // Relevant fields only
    .lean();

  res.json({
    success: true,
    data: logs,
    count: logs.length
  });
}));

module.exports = router;
