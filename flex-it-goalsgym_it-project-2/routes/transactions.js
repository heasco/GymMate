// routes/transactions.js

const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const Transaction = require('../models/Transaction');
const Member = require('../models/Member');

const router = express.Router();

// POST /api/transactions
router.post('/', asyncHandler(async (req, res) => {
    const { member_id, amount, payment_method, payment_date, description, status } = req.body;

    if (!member_id || amount === undefined || !payment_method || !payment_date) {
      return res.status(400).json({
          success: false,
          error: 'Member ID, amount, payment method, and payment date are required',
      });
    }

    if (!['cash', 'e-wallet', 'bank', 'others', 'none'].includes(payment_method)) {
      return res.status(400).json({ success: false, error: 'Invalid payment method' });
    }

    const parsedDate = new Date(payment_date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid payment date format' });
    }

    const isWalkIn = typeof member_id === 'string' && member_id.startsWith('Walk-in:');
    let member = null;

    if (!isWalkIn) {
      let memberQuery = { memberId: member_id };

      if (mongoose.Types.ObjectId.isValid(member_id)) {
        memberQuery = {
          $or: [{ memberId: member_id }, { _id: new mongoose.Types.ObjectId(member_id) }],
        };
      }

      member = await Member.findOne(memberQuery);
      if (!member) {
        return res.status(404).json({ success: false, error: 'Member not found' });
      }
    }

    const newTransaction = new Transaction({
      member_id: isWalkIn ? member_id : (member.memberId || member._id.toString()),
      amount,
      payment_method,
      status: status || 'paid',
      payment_date: parsedDate,
      description: description?.trim(),
    });

    const savedTransaction = await newTransaction.save();

    if (!isWalkIn && member) {
      await Member.findByIdAndUpdate(member._id, {
        $push: { transactions: savedTransaction.transaction_id },
      });
    }

    res.status(201).json({
      success: true,
      message: 'Transaction added successfully',
      data: savedTransaction,
    });
}));

// GET /api/transactions/member/:id
router.get('/member/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    let memberQuery = { memberId: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
      memberQuery = { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { memberId: id }] };
    }

    const member = await Member.findOne(memberQuery).lean();
    if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

    const memberKey = member.memberId || member._id.toString();
    const transactions = await Transaction.find({ member_id: memberKey })
      .sort({ payment_date: -1, createdAt: -1 })
      .lean();

    return res.json({ success: true, count: transactions.length, data: transactions });
}));

// GET /api/transactions
router.get('/', asyncHandler(async (req, res) => {
    const { status } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    
    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const total = await Transaction.countDocuments(query);
    const startIndex = (page - 1) * limit;

    const transactions = await Transaction.find(query)
      .sort({ payment_date: -1, createdAt: -1 })
      .skip(startIndex)
      .limit(limit)
      .lean();

    const memberIds = [...new Set(transactions.map((t) => t.member_id))];
    const members = await Member.find({ memberId: { $in: memberIds } }).select('memberId name').lean();
    const memberMap = new Map(members.map((m) => [m.memberId, { name: m.name, memberId: m.memberId }]));

    const data = transactions.map((t) => {
      let mName = 'Unknown';
      if (t.member_id && t.member_id.startsWith('Walk-in:')) {
        mName = t.member_id.replace('Walk-in:', '').trim() + ' (Walk-in)';
      } else {
        const m = memberMap.get(t.member_id) || {};
        mName = m.name || 'Unknown';
      }

      return {
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        member_name: mName,
        amount: t.amount,
        payment_method: t.payment_method,
        status: t.status,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      };
    });

    res.json({ 
      success: true, 
      count: data.length, 
      data,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });
}));

// GET /api/transactions/search
router.get('/search', asyncHandler(async (req, res) => {
    const { q, status } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const query = (q || '').trim();

    if (!query) return res.status(400).json({ success: false, error: 'Search query is required' });

    const memberFilter = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { memberId: { $regex: query, $options: 'i' } },
      ],
    };

    const members = await Member.find(memberFilter).select('memberId name').lean();
    const memberIds = members.map((m) => m.memberId);

    const txFilter = { $and: [] };
    const orFilter = [];
    
    if (memberIds.length) orFilter.push({ member_id: { $in: memberIds } });
    orFilter.push({ transaction_id: { $regex: query, $options: 'i' } });
    orFilter.push({ member_id: { $regex: query, $options: 'i' } }); // Search Walk-in names too
    
    txFilter.$and.push({ $or: orFilter });

    if (status && status !== 'all') {
      txFilter.$and.push({ status });
    }

    const total = await Transaction.countDocuments(txFilter);
    const startIndex = (page - 1) * limit;

    const transactions = await Transaction.find(txFilter)
      .sort({ payment_date: -1, createdAt: -1 })
      .skip(startIndex)
      .limit(limit)
      .lean();

    const memberMap = new Map(members.map((m) => [m.memberId, { name: m.name, memberId: m.memberId }]));

    const data = transactions.map((t) => {
      let mName = 'Unknown';
      if (t.member_id && t.member_id.startsWith('Walk-in:')) {
        mName = t.member_id.replace('Walk-in:', '').trim() + ' (Walk-in)';
      } else {
        const m = memberMap.get(t.member_id) || {};
        mName = m.name || 'Unknown';
      }

      return {
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        member_name: mName,
        amount: t.amount,
        payment_method: t.payment_method,
        status: t.status,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      };
    });

    res.json({ 
      success: true, 
      count: data.length, 
      data,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });
}));

// GET /api/transactions/range
router.get('/range', asyncHandler(async (req, res) => {
    const { startDate, endDate, status } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    let query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (isNaN(start.getTime())) return res.status(400).json({ success: false, error: 'Invalid start date format' });

        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            if (isNaN(end.getTime())) return res.status(400).json({ success: false, error: 'Invalid end date format' });
            query.payment_date = { $gte: start, $lte: end };
        } else {
            // If no end date, filter ONLY that specific start date
            const end = new Date(start);
            end.setHours(23, 59, 59, 999);
            query.payment_date = { $gte: start, $lte: end };
        }
    } else if (endDate) {
        return res.status(400).json({ success: false, error: 'Start date is required if end date is provided' });
    }

    const total = await Transaction.countDocuments(query);
    const startIndex = (page - 1) * limit;

    // Calculate total revenue of "paid" items for the filtered range globally
    const revenueQuery = { ...query, status: 'paid' };
    const totalSalesAgg = await Transaction.aggregate([
      { $match: revenueQuery },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalRevenue = totalSalesAgg.length > 0 ? totalSalesAgg[0].total : 0;

    const transactions = await Transaction.find(query)
      .sort({ payment_date: -1, createdAt: -1 })
      .skip(startIndex)
      .limit(limit)
      .lean();

    const memberIds = [...new Set(transactions.map((t) => t.member_id))];
    const members = await Member.find({ memberId: { $in: memberIds } }).select('memberId name').lean();
    const memberMap = new Map(members.map((m) => [m.memberId, { name: m.name, memberId: m.memberId }]));

    const data = transactions.map((t) => {
      let mName = 'Unknown';
      if (t.member_id && t.member_id.startsWith('Walk-in:')) {
        mName = t.member_id.replace('Walk-in:', '').trim() + ' (Walk-in)';
      } else {
        const m = memberMap.get(t.member_id) || {};
        mName = m.name || 'Unknown';
      }

      return {
        transaction_id: t.transaction_id,
        member_id: t.member_id,
        member_name: mName,
        amount: t.amount,
        payment_method: t.payment_method,
        status: t.status,
        payment_date: t.payment_date,
        description: t.description,
        createdAt: t.createdAt,
      };
    });

    res.json({ 
      success: true, 
      count: data.length, 
      data,
      totalRevenue,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });
}));

// PUT /api/transactions/:transaction_id
router.put('/:transaction_id', asyncHandler(async (req, res) => {
    const { transaction_id } = req.params;
    const { amount, payment_method, payment_date, description, status } = req.body;

    const update = {};

    if (amount !== undefined) {
      if (amount < 0) return res.status(400).json({ success: false, error: 'Amount must be positive' });
      update.amount = amount;
    }

    if (payment_method) {
      if (!['cash', 'e-wallet', 'bank', 'others', 'none'].includes(payment_method)) {
        return res.status(400).json({ success: false, error: 'Invalid payment method' });
      }
      update.payment_method = payment_method;
    }
    
    if (status) {
      if (!['paid', 'unpaid'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
      update.status = status;
    }

    if (payment_date) {
      const parsed = new Date(payment_date);
      if (isNaN(parsed.getTime())) return res.status(400).json({ success: false, error: 'Invalid payment date format' });
      update.payment_date = parsed;
    }

    if (description !== undefined) update.description = description?.trim();

    const updated = await Transaction.findOneAndUpdate({ transaction_id }, { $set: update }, { new: true }).lean();
    if (!updated) return res.status(404).json({ success: false, error: 'Transaction not found' });

    res.json({ success: true, message: 'Transaction updated successfully', data: updated });
}));

// DELETE /api/transactions/:transaction_id
router.delete('/:transaction_id', asyncHandler(async (req, res) => {
    const { transaction_id } = req.params;
    const deleted = await Transaction.findOneAndDelete({ transaction_id }).lean();

    if (!deleted) return res.status(404).json({ success: false, error: 'Transaction not found' });

    await Member.updateMany(
      { transactions: transaction_id },
      { $pull: { transactions: transaction_id } }
    );

    res.json({ success: true, message: 'Transaction deleted successfully' });
}));

module.exports = router;