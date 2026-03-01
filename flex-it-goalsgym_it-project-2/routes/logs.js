// routes/logs.js
const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const Admin = require('../models/Admin');
const Trainer = require('../models/Trainer');
const Member = require('../models/Member');
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

    const logs = await Log.find(filter).sort({ timestamp: -1 }).lean();

    const userIdsByModel = logs.reduce((acc, log) => {
      if (!acc[log.userModel]) {
        acc[log.userModel] = new Set();
      }
      acc[log.userModel].add(log.userId.toString());
      return acc;
    }, {});

    const userMaps = {};
    const models = { Admin, Trainer, Member };

    for (const modelName in userIdsByModel) {
      const userIds = Array.from(userIdsByModel[modelName]);
      const users = await models[modelName].find({ _id: { $in: userIds } });
      userMaps[modelName] = users.reduce((acc, user) => {
        acc[user._id.toString()] = user;
        return acc;
      }, {});
    }

    const populatedLogs = logs.map((log) => {
      const user = userMaps[log.userModel]?.[log.userId.toString()];
      return {
        ...log,
        userId: user || null,
      };
    });

    res.json({
      success: true,
      data: populatedLogs,
    });
  })
);

module.exports = router;
