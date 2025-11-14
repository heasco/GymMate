const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

const Transaction = require('../models/Transaction');
const Member = require('../models/Member');

const router = express.Router();

// POST /api/transactions
router.post('/', asyncHandler(async (req, res) => {
  const { member_id, amount, payment_method, payment_date, description } = req.body;
  if (!member_id || !amount || !payment_method || !payment_date) {
    return res.status(400).json({ success:false, error:'Member ID, amount, payment method, and payment date are required' });
  }
  if (!['cash', 'e-wallet', 'bank'].includes(payment_method)) {
    return res.status(400).json({ success:false, error:'Invalid payment method' });
  }
  if (amount <= 0) {
    return res.status(400).json({ success:false, error:'Amount must be positive' });
  }
  const parsedDate = new Date(payment_date);
  if (isNaN(parsedDate.getTime())) return res.status(400).json({ success:false, error:'Invalid payment date format' });

  let memberQuery = { memberId: member_id };
  if (mongoose.Types.ObjectId.isValid(member_id)) {
    memberQuery = { $or: [ { memberId: member_id }, { _id: new mongoose.Types.ObjectId(member_id) } ] };
  }
  const member = await Member.findOne(memberQuery);
  if (!member) return res.status(404).json({ success:false, error:'Member not found' });

  const newTransaction = new Transaction({
    member_id: member.memberId || member._id.toString(),
    amount,
    payment_method,
    payment_date: parsedDate,
    description: description?.trim()
  });

  const savedTransaction = await newTransaction.save();

  await Member.findByIdAndUpdate(member._id, { $push: { transactions: savedTransaction.transaction_id } });

  res.status(201).json({
    success:true, message:'Transaction added successfully',
    data: {
      transaction_id: savedTransaction.transaction_id,
      member_id: savedTransaction.member_id,
      amount: savedTransaction.amount,
      payment_method: savedTransaction.payment_method,
      payment_date: savedTransaction.payment_date,
      description: savedTransaction.description,
      createdAt: savedTransaction.createdAt
    }
  });
}));

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

module.exports = router;
