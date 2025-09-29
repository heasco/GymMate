const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

const Member = require('../models/Member');
const Enrollment = require('../models/Enrollment');

const router = express.Router();
//
// POST /api/members  create
router.post('/', asyncHandler(async (req, res) => {
  console.log('[Member] Creation request received:', req.body);

  const { name: rawName, memberships, joinDate, phone: rawPhone, email: rawEmail } = req.body;

  const name = rawName?.trim();
  const phone = rawPhone?.trim();
  const email = rawEmail?.trim().toLowerCase();

  if (!name || !memberships || !Array.isArray(memberships) || memberships.length === 0) {
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!memberships || !Array.isArray(memberships) || memberships.length === 0) errors.memberships = 'At least one membership is required';
    return res.status(400).json({ success:false, error:'Validation failed', details: errors });
  }

  // generate username
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0].toLowerCase();
  const lastName = nameParts.slice(1).join('').toLowerCase();
  let username = firstName + lastName;
  let usernameSuffix = 0;
  while (await Member.findOne({ username })) {
    usernameSuffix++;
    username = firstName + lastName + usernameSuffix;
  }

  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  const tempPassword = firstName + randomDigits;

  // validate memberships
  const validatedMemberships = [];
  for (const membership of memberships) {
    const { type, duration } = membership;
    if (!type || !['monthly', 'combative'].includes(type)) {
      return res.status(400).json({ success:false, error:'Validation failed', details: { memberships: 'Each membership must have a valid type (monthly or combative)'}});
    }
    if (!duration || duration < 1) {
      return res.status(400).json({ success:false, error:'Validation failed', details: { memberships: 'Each membership must have a valid duration (at least 1)'}});
    }
    const startDate = joinDate ? new Date(joinDate) : new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + duration);
    validatedMemberships.push({ type, duration, startDate, endDate, status: 'active' });
  }

  const newMember = new Member({
    name,
    username,
    password: tempPassword,
    memberships: validatedMemberships,
    joinDate: joinDate ? new Date(joinDate) : new Date(),
    phone: phone || undefined,
    email: email || undefined
  });

  const savedMember = await newMember.save();
  console.log(`[Member] Successfully created (MongoID: ${savedMember._id}, MemberID: ${savedMember.memberId})`);

  return res.status(201).json({
    success: true,
    message: 'Member created successfully',
    data: {
      memberId: savedMember.memberId,
      mongoId: savedMember._id,
      name: savedMember.name,
      username: savedMember.username,
      tempPassword,
      memberships: savedMember.memberships,
      joinDate: savedMember.joinDate,
      phone: savedMember.phone,
      email: savedMember.email
    }
  });
}));

// GET /api/members/search?q=...
router.get('/search', asyncHandler(async (req, res) => {
  const { query } = req.query;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success:false, error: 'Search query must be at least 2 characters long' });
  }
  const db = mongoose.connection.db;
  const members = await db.collection('members').find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { memberId: { $regex: query, $options: 'i' } }
    ]
  }).limit(10).toArray();
  res.json({ success:true, count: members.length, data: members });
}));

// GET /api/members/:id/enrollments
router.get('/:id/enrollments', asyncHandler(async (req, res) => {
  const member_id = req.params.id;
  const enrollments = await Enrollment.find({ member_id, status: 'active' })
    .populate('class_id', 'class_name schedule trainer_id')
    .sort({ enrollment_date: -1 });

  res.json({ success: true, count: enrollments.length, data: enrollments });
}));

module.exports = router;
