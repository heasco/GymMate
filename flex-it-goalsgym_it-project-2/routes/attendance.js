const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Member = require('../models/Member');
const Enrollment = require('../models/Enrollment');

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


module.exports = router;
