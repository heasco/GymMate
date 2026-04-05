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
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const filter = {};

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0); 
      
      let end = new Date(startDate);
      if (endDate) {
        end = new Date(endDate);
      }
      end.setHours(23, 59, 59, 999); 

      filter.timestamp = { $gte: start, $lte: end };
    }

    if (name) {
      const members = await Member.find({ name: new RegExp(name, 'i') }).select('_id');
      filter.memberId = { $in: members.map(m => m._id) };
    }

    if (logType) {
      filter.logType = logType;
    }

    const startIndex = (page - 1) * limit;
    const total = await Attendance.countDocuments(filter);

    const attendanceLogs = await Attendance.find(filter)
      .populate('memberId', 'name')
      .sort({ timestamp: -1 })
      .skip(startIndex)
      .limit(limit);

    res.json({
      success: true,
      data: attendanceLogs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });
  })
);

module.exports = router;