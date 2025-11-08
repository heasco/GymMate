const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

// --- File upload support ---
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const upload = multer();


const Member = require('../models/Member');
const Enrollment = require('../models/Enrollment');

// --- Email transporter ---
const transporter = require('../utils/nodemailer');

const router = express.Router();

// Return ALL members, not paginated!
router.get('/', asyncHandler(async (req, res) => {
    const members = await Member.find(); // ← ensure no .limit()/.skip()
    res.json({
        success: true,
        count: members.length,
        data: members
    });
}));

// POST /api/members - Create a new member (With image support)
router.post('/', upload.single('faceImage'), asyncHandler(async (req, res) => {
  console.log('[Member] Creation request received:', req.body);

  // Fix for frontend FormData: memberships must be parsed from string
  let memberships = req.body.memberships;
  if (typeof memberships === "string") {
    try {
      memberships = JSON.parse(memberships);
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Invalid memberships format' });
    }
  }

  const { name: rawName, joinDate, phone: rawPhone, email: rawEmail, faceEnrolled } = req.body;
  const name = rawName?.trim();
  const phone = rawPhone?.trim();
  const email = rawEmail?.trim().toLowerCase();

  if (!name || !memberships || !Array.isArray(memberships) || memberships.length === 0) {
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!memberships || !Array.isArray(memberships) || memberships.length === 0)
      errors.memberships = 'At least one membership is required';
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  // --- Username and temp password logic  ---
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

  // --- Memberships validation logic---
  const validatedMemberships = [];
  for (const membership of memberships) {
    const { type, duration } = membership;
    if (!type || !['monthly', 'combative'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: { memberships: 'Each membership must have a valid type (monthly or combative)' }
      });
    }
    if (!duration || duration < 1) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: { memberships: 'Each membership must have a valid duration (at least 1)' }
      });
    }
    const startDate = joinDate ? new Date(joinDate) : new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + duration);
    validatedMemberships.push({ type, duration, startDate, endDate, status: 'active' });
  }

  // --- Save new member to MongoDB ---
  const newMember = new Member({
    name,
    username,
    password: tempPassword,
    memberships: validatedMemberships,
    joinDate: joinDate ? new Date(joinDate) : new Date(),
    phone: phone || undefined,
    email: email || undefined,
    faceEnrolled: (faceEnrolled === 'yes')
  });

  const savedMember = await newMember.save();
  console.log(`[Member] Successfully created (MongoID: ${savedMember._id}, MemberID: ${savedMember.memberId})`);

  // --- EMAIL SEND ON MEMBER CREATION ---
  if (savedMember.email) {
    try {
      await transporter.sendMail({
        from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
        to: savedMember.email,
        subject: 'Welcome to GOALS Gym!',
        html: `<h2>Welcome, ${savedMember.name}!</h2>
        <p>Your account at <b>GOALS Gym</b> has been created.</p>
        <ul>
          <li><b>Username:</b> ${savedMember.username}</li>
          <li><b>Temporary Password:</b> ${tempPassword}</li>
        </ul>
        <p>Please change your password upon first login.</p>
        <p><b>Membership details:</b></p>
        <pre>${JSON.stringify(savedMember.memberships, null, 2)}</pre>
        <p>If you did not sign up, please contact our staff immediately.</p>
        <hr>
        <p>Thank you for joining GOALS Gym!</p>`
      });
      console.log('[Member] Welcome email sent to:', savedMember.email);
    } catch (emailErr) {
      console.error('[Member] Error sending welcome email:', emailErr);
    }
  }
  // --- END EMAIL SECTION ---

  // --- Forward face image to Flask (if provided) ---
// --- Forward face image to Flask (if provided) ---
const memberMongoId = savedMember._id.toString();

if (req.file) {
  const fd = new FormData();
  fd.append('image', req.file.buffer, { filename: 'face.jpg', contentType: req.file.mimetype });
  fd.append('faceId', memberMongoId);  // Pass faceId to Flask!
  fd.append('name', name);
  try {
    const flaskResp = await axios.post('http://localhost:5001/api/enroll-face', fd, {
      headers: fd.getHeaders()
    });
    if (flaskResp.data && flaskResp.data.status === 'success' && flaskResp.data.faceId) {
      // Save returned faceId to member (only if not already set)
      await Member.findByIdAndUpdate(savedMember._id, { faceId: flaskResp.data.faceId, faceEnrolled: true });
      console.log('Facial enrollment succeeded, faceId:', flaskResp.data.faceId);
    } else {
      console.warn('Facial enrollment failed for', name, flaskResp.data);
    }
  } catch (flaskErr) {
    console.log('Flask error:', flaskErr);
  }
}

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
      faceId: savedMember.faceId,
      joinDate: savedMember.joinDate,
      phone: savedMember.phone,
      email: savedMember.email
    }
  });
}));

// Search for members
router.get('/search', asyncHandler(async (req, res) => {
  console.log('SEARCH ROUTE REACHED');
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

  if (type === 'combative') {
    filter.$and.push({ 'memberships.type': 'combative' });
  }

  const members = await db.collection('members').find(filter).limit(10).toArray();
  res.json({ success: true, count: members.length, data: members });
}));

// GET /api/members/:id - Get single member by memberId, username, faceId, or Mongo _id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  let query = {
    $or: [
      { memberId: id },
      { username: id },
      { faceId: id }
    ]
  };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query.$or.push({ _id: new mongoose.Types.ObjectId(id) });
  }
  const member = await Member.findOne(query).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, data: member });
}));


// PUT /api/members/:id/profile - Update member profile (phone and email only, member use)
router.put('/:id/profile', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { phone, email } = req.body || {};

  const updates = {};
  if (typeof phone !== 'undefined') updates.phone = phone ? phone.trim() : '';
  if (typeof email !== 'undefined') updates.email = email ? email.trim().toLowerCase() : '';

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  if (updates.phone && updates.phone !== '' && !/^\+63\d{10}$/.test(updates.phone)) {
    return res.status(400).json({ success: false, error: 'Invalid Philippine phone format. Use +63XXXXXXXXXX' });
  }
  if (updates.email && updates.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  }

  const member = await Member.findOneAndUpdate(
    query,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();

  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

  delete member.password;
  res.json({ success: true, message: 'Profile updated successfully', data: member });
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

module.exports = router;
