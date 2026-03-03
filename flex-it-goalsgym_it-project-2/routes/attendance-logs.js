// routes/attendance-logs.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Attendance = require('../models/Attendance');
const Member = require('../models/Member');

// @desc    Get all attendance logs
// @route   GET /api/attendance-logs
// @access  Private/Admin
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { name, startDate, endDate, logType } = req.query;
    const filter = {};

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0); // Start of day
      
      let end = new Date(startDate);
      if (endDate) {
        end = new Date(endDate);
      }
      end.setHours(23, 59, 59, 999); // End of day

      filter.timestamp = { $gte: start, $lte: end };
    }

    if (name) {
      const members = await Member.find({ name: new RegExp(name, 'i') });
      const memberIds = members.map((member) => member._id);
      filter.memberId = { $in: memberIds };
    }

    if (logType) {
      filter.logType = logType;
    }

    const attendanceLogs = await Attendance.find(filter)
      .populate('memberId', 'name')
      .sort({ timestamp: -1 });

    res.json({
      success: true,
      data: attendanceLogs,
    });
  })
);

module.exports = router;