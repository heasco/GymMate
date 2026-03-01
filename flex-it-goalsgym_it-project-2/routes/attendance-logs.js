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
    const { name, date, logType } = req.query;
    const filter = {};

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      filter.timestamp = { $gte: startDate, $lt: endDate };
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
