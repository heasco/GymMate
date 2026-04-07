// routes/logs.js
const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const Admin = require('../models/Admin');
const Member = require('../models/Member');
const MembershipHistory = require('../models/MembershipHistory'); 
const asyncHandler = require('../middleware/asyncHandler');

// @desc    Get all logs
// @route   GET /api/logs
// @access  Private/Admin
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { role, startDate, endDate, name } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const filter = {};

    if (role) {
      filter.userModel = role.charAt(0).toUpperCase() + role.slice(1);
    }

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

    // Server-side search by name across collections
    if (name) {
      const nameRegex = new RegExp(name, 'i');
      const [admins, members] = await Promise.all([
        Admin.find({ $or: [{ name: nameRegex }, { username: nameRegex }] }).select('_id'),
        Member.find({ name: nameRegex }).select('_id')
      ]);
      const matchedUserIds = [...admins, ...members].map(u => u._id);
      filter.userId = { $in: matchedUserIds };
    }

    const startIndex = (page - 1) * limit;
    const total = await Log.countDocuments(filter);

    const logs = await Log.find(filter)
      .sort({ timestamp: -1 })
      .skip(startIndex)
      .limit(limit)
      .lean();

    const userIdsByModel = logs.reduce((acc, log) => {
      if (!acc[log.userModel]) {
        acc[log.userModel] = new Set();
      }
      acc[log.userModel].add(log.userId?.toString());
      return acc;
    }, {});

    const userMaps = {};
    const models = { Admin, Member };

    for (const modelName in userIdsByModel) {
      const userIds = Array.from(userIdsByModel[modelName]).filter(Boolean);
      if (userIds.length > 0 && models[modelName]) {
        const users = await models[modelName].find({ _id: { $in: userIds } });
        userMaps[modelName] = users.reduce((acc, user) => {
          acc[user._id.toString()] = user;
          return acc;
        }, {});
      }
    }

    const populatedLogs = logs.map((log) => {
      const user = userMaps[log.userModel]?.[log.userId?.toString()];
      return {
        ...log,
        userId: user || null,
      };
    });

    res.json({
      success: true,
      data: populatedLogs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
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
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const filter = {};

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      let end = new Date(startDate);
      end.setHours(23, 59, 59, 999);

      filter.archivedAt = { $gte: start, $lte: end };
    }

    // Search for matching member IDs first
    if (name) {
      const members = await Member.find({ name: new RegExp(name, 'i') }).select('_id');
      filter.member = { $in: members.map(m => m._id) };
    }

    const startIndex = (page - 1) * limit;
    const total = await MembershipHistory.countDocuments(filter);

    const expiredMemberships = await MembershipHistory.find(filter)
      .populate('member', 'name')
      .sort({ archivedAt: -1 })
      .skip(startIndex)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: expiredMemberships,
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