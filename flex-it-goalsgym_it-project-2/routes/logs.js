// routes/logs.js
const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const Admin = require('../models/Admin');
const Trainer = require('../models/Trainer');
const Member = require('../models/Member');
const MembershipHistory = require('../models/MembershipHistory'); // ADDED: Import MembershipHistory model
const asyncHandler = require('../middleware/asyncHandler');

// @desc    Get all logs
// @route   GET /api/logs
// @access  Private/Admin
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { role, startDate, endDate, name } = req.query;
    const filter = {};

    if (role) {
      filter.userModel = role.charAt(0).toUpperCase() + role.slice(1);
    }

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

    let populatedLogs = logs.map((log) => {
      const user = userMaps[log.userModel]?.[log.userId.toString()];
      return {
        ...log,
        userId: user || null,
      };
    });

    // Filter by name in-memory after populating the users
    if (name) {
      const nameRegex = new RegExp(name, 'i');
      populatedLogs = populatedLogs.filter((log) => {
        const userName = log.userId ? (log.userId.name || log.userId.username || '') : '';
        return nameRegex.test(userName);
      });
    }

    res.json({
      success: true,
      data: populatedLogs,
    });
  })
);

// @desc    Get expired memberships
// @route   GET /api/logs/expired
// @access  Private/Admin
router.get(
  '/expired',
  asyncHandler(async (req, res) => {
    const { name, startDate } = req.query;
    const filter = {};

    // Filter by the date the membership was archived (expired)
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      let end = new Date(startDate);
      end.setHours(23, 59, 59, 999);

      filter.archivedAt = { $gte: start, $lte: end };
    }

    // Fetch and populate member details
    let expiredMemberships = await MembershipHistory.find(filter)
      .populate('member', 'name') // Populate member to get the name
      .sort({ archivedAt: -1 })
      .lean();

    // Filter by member name in-memory
    if (name) {
      const nameRegex = new RegExp(name, 'i');
      expiredMemberships = expiredMemberships.filter((record) => {
        const memberName = record.member ? record.member.name : '';
        return nameRegex.test(memberName);
      });
    }

    res.json({
      success: true,
      data: expiredMemberships,
    });
  })
);

module.exports = router;