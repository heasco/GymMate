// routes/logs.js
const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const asyncHandler = require('../middleware/asyncHandler');

// @desc    Get all logs
// @route   GET /api/logs
// @access  Private/Admin
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { role, date } = req.query;
    const filter = {};

    if (role) {
      filter.userModel = role.charAt(0).toUpperCase() + role.slice(1);
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      filter.timestamp = { $gte: startDate, $lt: endDate };
    }

    const logs = await Log.find(filter)
      .populate('userId')
      .sort({ timestamp: -1 });

    res.json({
      success: true,
      data: logs,
    });
  })
);

module.exports = router;

