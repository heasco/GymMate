// routes/transactions.js

const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const Transaction = require('../models/Transaction');
const Member = require('../models/Member');

const router = express.Router();

// POST /api/transactions
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { member_id, amount, payment_method, payment_date, description } = req.body;

    if (!member_id || !amount || !payment_method || !payment_date) {
      return res
        .status(400)
        .json({
          success: false,
          error: 'Member ID, amount, payment method, and payment date are required',
        });
    }

    if (!['cash', 'e-wallet', 'bank'].includes(payment_method)) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid payment method' });
    }

    if (amount <= 0) {
      return res
        .status(400)
        .json({ success: false, error: 'Amount must be positive' });
    }

    const parsedDate = new Date(payment_date);
    if (isNaN(parsedDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid payment date format' });
    }

    let memberQuery = { memberId: member_id };

    if (mongoose.Types.ObjectId.isValid(member_id)) {
      memberQuery = {
        $or: [
          { memberId: member_id },
          { _id: new mongoose.Types.ObjectId(member_id) },
        ],
      };
    }

    const member = await Member.findOne(memberQuery);
    if (!member) {
      return res
        .status(404)
        .json({ success: false, error: 'Member not found' });
    }

    const newTransaction = new Transaction({
      member_id: member.memberId || member._id.toString(),
      amount,
      payment_method,
      payment_date: parsedDate,
      description: description?.trim(),
    });

    const savedTransaction = await newTransaction.save();

    await Member.findByIdAndUpdate(member._id, {
      $push: { transactions: savedTransaction.transaction_id },
    });

    res.status(201).json({
      success: true,
      message: 'Transaction added successfully',
      data: {
        transaction_id: savedTransaction.transaction_id,
        member_id: savedTransaction.member_id,
        amount: savedTransaction.amount,
        payment_method: savedTransaction.payment_method,
        payment_date: savedTransaction.payment_date,
        description: savedTransaction.description,
        createdAt: savedTransaction.createdAt,
      },
    });
  })
);

// GET /api/transactions/member/:id
// Returns all transactions for a given member (by mongoId or memberId)
router.get(
  '/member/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Find member by either ObjectId or memberId string
    let memberQuery = { memberId: id };

    if (mongoose.Types.ObjectId.isValid(id)) {
      memberQuery = {
        $or: [{ _id: new mongoose.Types.ObjectId(id) }, { memberId: id }],
      };
    }

    const member = await Member.findOne(memberQuery).lean();
    if (!member) {
      return res
        .status(404)
        .json({ success: false, error: 'Member not found' });
    }

    // Transactions store member_id as member.memberId (or fallback _id)
    const memberKey = member.memberId || member._id.toString();

    const transactions = await Transaction.find({ member_id: memberKey })
      .sort({ payment_date: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: transactions.length,
      data: transactions.map((t) => ({
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        amount: t.amount,
        payment_method: t.payment_method,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      })),
    });
  })
);

// ===============================
// ADMIN VIEW / SEARCH ENDPOINTS
// ===============================

// GET /api/transactions
// Latest 10 transactions (with member name/id populated)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const transactions = await Transaction.find({})
      .sort({ payment_date: -1, createdAt: -1 })
      .limit(10)
      .lean();

    // Attach member name by joining on member_id -> Member.memberId
    const memberIds = [...new Set(transactions.map((t) => t.member_id))];

    const members = await Member.find({ memberId: { $in: memberIds } })
      .select('memberId name')
      .lean();

    const memberMap = new Map(
      members.map((m) => [m.memberId, { name: m.name, memberId: m.memberId }])
    );

    const data = transactions.map((t) => {
      const m = memberMap.get(t.member_id) || {};
      return {
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        member_name: m.name || 'Unknown',
        amount: t.amount,
        payment_method: t.payment_method,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      };
    });

    res.json({ success: true, count: data.length, data });
  })
);

// GET /api/transactions/search
// Query by member name OR memberId OR transaction_id
// ?q=string
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    const query = (q || '').trim();

    if (!query) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query is required' });
    }

    // Look up members whose name or memberId matches
    const memberFilter = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { memberId: { $regex: query, $options: 'i' } },
      ],
    };

    const members = await Member.find(memberFilter)
      .select('memberId name')
      .lean();

    const memberIds = members.map((m) => m.memberId);

    // Base transaction filter
    const txFilter = {
      $or: [],
    };

    if (memberIds.length) {
      txFilter.$or.push({ member_id: { $in: memberIds } });
    }

    // Also allow direct transaction_id search by exact match or partial
    txFilter.$or.push({ transaction_id: { $regex: query, $options: 'i' } });

    const transactions = await Transaction.find(txFilter)
      .sort({ payment_date: -1, createdAt: -1 })
      .limit(50)
      .lean();

    const memberMap = new Map(
      members.map((m) => [m.memberId, { name: m.name, memberId: m.memberId }])
    );

    const data = transactions.map((t) => {
      const m = memberMap.get(t.member_id) || {};
      return {
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        member_name: m.name || 'Unknown',
        amount: t.amount,
        payment_method: t.payment_method,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      };
    });

    res.json({ success: true, count: data.length, data });
  })
);

// GET /api/transactions/date?date=YYYY-MM-DD
// Returns transactions on that payment_date
router.get(
  '/date',
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!date) {
      return res
        .status(400)
        .json({ success: false, error: 'date query param is required' });
    }

    const target = new Date(date);
    if (isNaN(target.getTime())) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid date format' });
    }

    const start = new Date(target);
    start.setHours(0, 0, 0, 0);
    const end = new Date(target);
    end.setHours(23, 59, 59, 999);

    const transactions = await Transaction.find({
      payment_date: { $gte: start, $lte: end },
    })
      .sort({ payment_date: -1, createdAt: -1 })
      .lean();

    const memberIds = [...new Set(transactions.map((t) => t.member_id))];

    const members = await Member.find({ memberId: { $in: memberIds } })
      .select('memberId name')
      .lean();

    const memberMap = new Map(
      members.map((m) => [m.memberId, { name: m.name, memberId: m.memberId }])
    );

    const data = transactions.map((t) => {
      const m = memberMap.get(t.member_id) || {};
      return {
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        member_name: m.name || 'Unknown',
        amount: t.amount,
        payment_method: t.payment_method,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      };
    });

    res.json({ success: true, count: data.length, data });
  })
);

// ===================================
// EDIT & DELETE TRANSACTION (ADMIN)
// ===================================

// PUT /api/transactions/:transaction_id
router.put(
  '/:transaction_id',
  asyncHandler(async (req, res) => {
    const { transaction_id } = req.params;
    const { amount, payment_method, payment_date, description } = req.body;

    const update = {};

    if (amount !== undefined) {
      if (amount <= 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Amount must be positive' });
      }
      update.amount = amount;
    }

    if (payment_method) {
      if (!['cash', 'e-wallet', 'bank'].includes(payment_method)) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid payment method' });
      }
      update.payment_method = payment_method;
    }

    if (payment_date) {
      const parsed = new Date(payment_date);
      if (isNaN(parsed.getTime())) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid payment date format' });
      }
      update.payment_date = parsed;
    }

    if (description !== undefined) {
      update.description = description?.trim();
    }

    const updated = await Transaction.findOneAndUpdate(
      { transaction_id },
      { $set: update },
      { new: true }
    ).lean();

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, error: 'Transaction not found' });
    }

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: updated,
    });
  })
);

// DELETE /api/transactions/:transaction_id
router.delete(
  '/:transaction_id',
  asyncHandler(async (req, res) => {
    const { transaction_id } = req.params;

    const deleted = await Transaction.findOneAndDelete({ transaction_id }).lean();

    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, error: 'Transaction not found' });
    }

    // Remove reference from any Member.transactions array if you keep that
    await Member.updateMany(
      { transactions: transaction_id },
      { $pull: { transactions: transaction_id } }
    );

    res.json({
      success: true,
      message: 'Transaction deleted successfully',
    });
  })
);

module.exports = router;
