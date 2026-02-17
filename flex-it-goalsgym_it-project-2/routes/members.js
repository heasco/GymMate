const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth'); 
const Member = require('../models/Member');
const transporter = require('../utils/nodemailer');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const upload = multer();
const router = express.Router();

// Middleware for handling multiple image uploads
const faceUploads = upload.fields([
  { name: 'faceImage1', maxCount: 1 },
  { name: 'faceImage2', maxCount: 1 },
  { name: 'faceImage3', maxCount: 1 },
]);



router.get('/', protect, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status && ['active', 'inactive', 'suspended'].includes(status)) {
    filter.status = status;
  }
  const members = await Member.find(filter).lean();
  members.forEach(m => delete m.password);
  res.json({ success: true, count: members.length, data: members });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const { query, type } = req.query;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters long' });
  }
  const filter = {
    $and: [
      {
        $or: [{ name: { $regex: query, $options: 'i' } }, { memberId: { $regex: query, $options: 'i' } }]
      }
    ]
  };
  if (type === 'combative') {
    filter.$and.push({ 'memberships.type': 'combative' });
  }
  const members = await mongoose.connection.db.collection('members').find(filter).limit(25).toArray();
  members.forEach(m => delete m.password);
  res.json({ success: true, count: members.length, data: members });
}));

// Get one member by id/username/memberId/faceId - PROTECTED
router.get('/:id', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  let query = { $or: [{ memberId: id }, { username: id }, { faceId: id }] };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query.$or.push({ _id: new mongoose.Types.ObjectId(id) });
  }
  const member = await Member.findOne(query).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, data: member });
}));

// Create member - PROTECTED (admin-only, e.g., add authorize('admin') if needed)
router.post('/', protect, faceUploads, asyncHandler(async (req, res) => {
  let memberships = req.body.memberships;
  if (typeof memberships === 'string') {
    try {
      memberships = JSON.parse(memberships);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid memberships format' });
    }
  }
  const { name: rawName, joinDate, phone: rawPhone, email: rawEmail, faceEnrolled } = req.body;
  const name = rawName?.trim();
  const phone = rawPhone?.trim();
  const email = rawEmail?.trim()?.toLowerCase();
  if (!name || !memberships || !Array.isArray(memberships) || memberships.length === 0) {
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!memberships || !Array.isArray(memberships) || memberships.length === 0) errors.memberships = 'At least one membership is required';
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }
  // Username and temp password
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0].toLowerCase();
  const lastName = nameParts.slice(1).join('').toLowerCase();
  let username = firstName + lastName;
  let suffix = 0;
  while (await Member.findOne({ username })) {
    suffix++;
    username = firstName + lastName + suffix;
  }
  const tempPassword = firstName + Math.floor(1000 + Math.random() * 9000);
  // Validate and compute membership dates
  const validatedMemberships = [];
  for (const m of memberships) {
    if (!m?.type || !['monthly', 'combative'].includes(m.type)) {
      return res.status(400).json({ success: false, error: 'Each membership must have a valid type (monthly or combative)' });
    }
    if (!m?.duration || Number(m.duration) < 1) {
      return res.status(400).json({ success: false, error: 'Each membership must have a valid duration (at least 1)' });
    }
    const startDate = m.startDate ? new Date(m.startDate) : (joinDate ? new Date(joinDate) : new Date());
    const endDate = new Date(startDate);
    if (m.type === 'monthly') {
      endDate.setMonth(endDate.getMonth() + Number(m.duration));
      validatedMemberships.push({
        type: m.type,
        duration: Number(m.duration),
        startDate,
        endDate,
        status: m.status && ['active', 'inactive', 'suspended', 'expired'].includes(m.status) ? m.status : 'active',
        remainingSessions: 0
      });
    } else {
      // combative: duration = sessions allowance; expiry = 1 month
      endDate.setMonth(endDate.getMonth() + 1);
      validatedMemberships.push({
        type: m.type,
        duration: Number(m.duration),
        startDate,
        endDate,
        status: m.status && ['active', 'inactive', 'suspended', 'expired'].includes(m.status) ? m.status : 'active',
        remainingSessions: Number(m.duration)
      });
    }
  }
  const newMember = new Member({
    name,
    username,
    password: tempPassword,
    memberships: validatedMemberships,
    joinDate: joinDate ? new Date(joinDate) : new Date(),
    phone: phone || undefined,
    email: email || undefined,
    faceEnrolled: faceEnrolled === 'yes'
  });
  const saved = await newMember.save();
  if (saved.email) {
    transporter.sendMail({
      from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
      to: saved.email,
      subject: 'Welcome to GOALS Gym!',
      html: `
        <h2>Your account has been created.</h2>
        <p><strong>Username:</strong> ${saved.username}</p>
        <p><strong>Temporary Password:</strong> ${tempPassword}</p>
        <p>Please change your password on first login.</p>
      `
    }).catch(err => console.error('Welcome email error:', err));
  }

  if (req.files && req.files.faceImage1 && req.files.faceImage2 && req.files.faceImage3) {
    const fd = new FormData();
    fd.append('image1', req.files.faceImage1[0].buffer, { filename: 'face1.jpg', contentType: req.files.faceImage1[0].mimetype });
    fd.append('image2', req.files.faceImage2[0].buffer, { filename: 'face2.jpg', contentType: req.files.faceImage2[0].mimetype });
    fd.append('image3', req.files.faceImage3[0].buffer, { filename: 'face3.jpg', contentType: req.files.faceImage3[0].mimetype });
    fd.append('faceId', saved._id.toString());
    fd.append('name', name);
    axios.post('http://localhost:5001/api/enroll-face', fd, { headers: fd.getHeaders() })
      .then(r => {
        if (r.data?.status === 'success' && r.data.faceId) {
          return Member.findByIdAndUpdate(saved._id, { faceId: r.data.faceId, faceEnrolled: true });
        }
      })
      .catch(err => console.log('Flask enroll error:', err?.message || err));
  }

  res.status(201).json({
    success: true,
    message: 'Member created successfully',
    data: {
      memberId: saved.memberId,
      mongoId: saved._id,
      name: saved.name,
      username: saved.username,
      memberships: saved.memberships,
      faceId: saved.faceId,
      joinDate: saved.joinDate,
      phone: saved.phone,
      email: saved.email,
      status: saved.status
    }
  });
}));

// Legacy: profile update - PROTECTED
router.put('/:id/profile', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { phone, email } = req.body || {};
  const updates = {};
  if (typeof phone !== 'undefined') updates.phone = phone ? phone.trim() : '';
  if (typeof email !== 'undefined') updates.email = email ? email.trim().toLowerCase() : '';
  if (updates.phone && updates.phone !== '' && !/^\+63\d{10}$/.test(updates.phone)) {
    return res.status(400).json({ success: false, error: 'Invalid Philippine phone format. Use +63XXXXXXXXXX' });
  }
  if (updates.email && updates.email !== '' && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(updates.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  const member = await Member.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true }).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, message: 'Profile updated successfully', data: member });
}));

// General update (name, phone, email, status, memberships) - PROTECTED
router.put('/:id', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, status, memberships } = req.body || {};
  const updates = {};
  if (typeof name !== 'undefined') updates.name = name?.trim();
  if (typeof phone !== 'undefined') updates.phone = phone ? phone.trim() : '';
  if (typeof email !== 'undefined') updates.email = email ? email.trim().toLowerCase() : '';
  if (typeof status !== 'undefined') {
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    updates.status = status;
  }
  if (updates.phone && updates.phone !== '' && !/^\+63\d{10}$/.test(updates.phone)) {
    return res.status(400).json({ success: false, error: 'Invalid Philippine phone format. Use +63XXXXXXXXXX' });
  }
  if (updates.email && updates.email !== '' && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(updates.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  if (Array.isArray(memberships)) {
    const validated = memberships.map(m => {
      if (!m?.type || !['monthly', 'combative'].includes(m.type)) {
        throw new Error('Each membership must have a valid type (monthly or combative)');
      }
      if (!m?.duration || Number(m.duration) < 1) {
        throw new Error('Each membership must have a valid duration (at least 1)');
      }
      const startDate = m.startDate ? new Date(m.startDate) : new Date();
      const out = {
        type: m.type,
        duration: Number(m.duration),
        startDate,
        status: m.status && ['active', 'inactive', 'suspended', 'expired'].includes(m.status) ? m.status : 'active'
      };
      if (m.type === 'combative') out.remainingSessions = Number(m.duration);
      return out;
    });
    // Recompute endDate on save via pre('validate'), but set a hint for combative expiry window
    updates.memberships = validated.map(m => {
      if (m.type === 'monthly') {
        const end = new Date(m.startDate);
        end.setMonth(end.getMonth() + m.duration);
        return { ...m, endDate: end };
      } else {
        const end = new Date(m.startDate);
        end.setMonth(end.getMonth() + 1);
        return { ...m, endDate: end };
      }
    });
  }
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  const updated = await Member.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true });
  if (!updated) return res.status(404).json({ success: false, error: 'Member not found' });
  res.json({
    success: true,
    message: 'Member updated',
    data: {
      memberId: updated.memberId,
      name: updated.name,
      phone: updated.phone,
      email: updated.email,
      status: updated.status,
      memberships: updated.memberships
    }
  });
}));

// Archive limited to inactive/suspended - PROTECTED
router.patch('/:id/archive', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['inactive', 'suspended'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be inactive or suspended' });
  }
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  const updated = await Member.findOneAndUpdate(query, { $set: { status } }, { new: true });
  if (!updated) return res.status(404).json({ success: false, error: 'Member not found' });
  res.json({
    success: true,
    message: `Member ${status} successfully`,
    data: { memberId: updated.memberId, name: updated.name, status: updated.status }
  });
}));

// Set status including active - PROTECTED
router.patch('/:id/status', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['active', 'inactive', 'suspended'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be active, inactive or suspended' });
  }
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  const updated = await Member.findOneAndUpdate(query, { $set: { status } }, { new: true });
  if (!updated) return res.status(404).json({ success: false, error: 'Member not found' });
  res.json({
    success: true,
    message: `Member status set to ${status}`,
    data: { memberId: updated.memberId, name: updated.name, status: updated.status }
  });
}));

module.exports = router;
