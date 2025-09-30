const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

const Member = require('../models/Member');
const Enrollment = require('../models/Enrollment');

const router = express.Router();

// POST /api/members - Create a new member
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
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  // Generate username
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

  // Validate memberships
  const validatedMemberships = [];
  for (const membership of memberships) {
    const { type, duration } = membership;
    if (!type || !['monthly', 'combative'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: { memberships: 'Each membership must have a valid type (monthly or combative)' } });
    }
    if (!duration || duration < 1) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: { memberships: 'Each membership must have a valid duration (at least 1)' } });
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

// GET /api/members/search?q=&type=combative - Search members by query
router.get('/search', asyncHandler(async (req, res) => {
  const { query, type } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters long' });
  }

  const db = mongoose.connection.db;
  const filter = {
    $and: [
      {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { memberId: { $regex: query, $options: 'i' } }
        ]
      }
    ]
  };

  // Only combative members if requested
  if (type === 'combative') {
    filter.$and.push({ 'memberships.type': 'combative' });
  }

  const members = await db.collection('members').find(filter).limit(10).toArray();

  res.json({ success: true, count: members.length, data: members });
}));

// GET /api/members/:id/enrollments - Get member enrollments
router.get('/:id/enrollments', asyncHandler(async (req, res) => {
  const member_id = req.params.id;
  const enrollments = await Enrollment.find({ member_id, status: 'active' })
    .populate('class_id', 'class_name schedule trainer_id')
    .sort({ enrollment_date: -1 });

  res.json({ success: true, count: enrollments.length, data: enrollments });
}));

// GET /api/combative-members - Get all combative members
router.get('/combative-members', asyncHandler(async (req, res) => {
  const db = mongoose.connection.db;
  const today = new Date();

  const members = await db.collection('members').find({
    'memberships': {
      $elemMatch: {
        type: 'combative',
        status: 'active',
        endDate: { $gt: today }
      }
    }
  }).toArray();

  res.json({ success: true, count: members.length, data: members });
}));

// GET /api/members?status=active|inactive|suspended - List all members with optional status filter
router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status: { $in: status.split(',') } } : {};
  
  const members = await Member.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, count: members.length, data: members });
}));


// GET /api/members/:id  -> returns single member (by memberId or _id)
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  } else if (typeof id === 'string' && id.includes('@') === false && id.length === 24) {
    // extra guard, but primary check above is fine
  }
  const member = await Member.findOne(query).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  res.json({ success: true, data: member });
}));


// PUT /api/members/:id - Update member details
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, memberships } = req.body;

  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  }

  const updateData = {};
  if (name) updateData.name = name.trim();
  if (phone) updateData.phone = phone.trim();
  if (email) updateData.email = email.trim().toLowerCase();
  if (memberships && Array.isArray(memberships)) {
    const validatedMemberships = memberships.map(m => {
      const membership = {
        type: m.type,
        duration: m.duration,
        startDate: m.startDate ? new Date(m.startDate) : new Date(),
        status: m.status || 'active'
      };
      if (m.type === 'monthly') {
        membership.endDate = new Date(membership.startDate);
        membership.endDate.setMonth(membership.endDate.getMonth() + m.duration);
      } else if (m.type === 'combative') {
        membership.remainingSessions = m.duration;
        membership.endDate = new Date(membership.startDate);
        membership.endDate.setMonth(membership.endDate.getMonth() + 6);
      }
      return membership;
    });
    updateData.memberships = validatedMemberships;
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  const updatedMember = await Member.findOneAndUpdate(
    query,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedMember) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }

  res.json({
    success: true,
    message: 'Member updated successfully',
    data: {
      memberId: updatedMember.memberId,
      name: updatedMember.name,
      phone: updatedMember.phone,
      email: updatedMember.email,
      memberships: updatedMember.memberships,
      status: updatedMember.status
    }
  });
}));

// PATCH /api/members/:id/archive - Archive a member (set status to inactive or suspended)
router.patch('/:id/archive', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['inactive', 'suspended'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be inactive or suspended' });
  }

  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  }

  const updatedMember = await Member.findOneAndUpdate(
    query,
    { $set: { status } },
    { new: true }
  );

  if (!updatedMember) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }

  res.json({
    success: true,
    message: `Member ${status} successfully`,
    data: {
      memberId: updatedMember.memberId,
      name: updatedMember.name,
      status: updatedMember.status
    }
  });
}));

// GET /api/members/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  let query;
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ _id: id }, { memberId: id }, { username: id }] };
  } else {
    query = { $or: [{ memberId: id }, { username: id }] };
  }
  const member = await Member.findOne(query).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, data: member });
}));

// PUT /api/members/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { phone, email } = req.body || {};

  const updates = {};
  if (typeof phone !== 'undefined') updates.phone = phone;
  if (typeof email !== 'undefined') updates.email = email;

  // Validation examples (adjust to your schema rules)
  if (updates.phone && !/^\+63\d{10}$/.test(updates.phone)) {
    return res.status(400).json({ success: false, error: 'Invalid Philippine phone format. Use +63XXXXXXXXXX' });
  }
  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  let member;
  if (mongoose.Types.ObjectId.isValid(id)) {
    member = await Member.findOneAndUpdate({ $or: [{ _id: id }, { memberId: id }] }, { $set: updates }, { new: true }).lean();
  } else {
    member = await Member.findOneAndUpdate({ memberId: id }, { $set: updates }, { new: true }).lean();
  }

  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, data: member });
}));


module.exports = router;