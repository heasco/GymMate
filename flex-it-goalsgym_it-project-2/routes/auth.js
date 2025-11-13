// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');
const Admin = require('../models/Admin');
const Member = require('../models/Member');
const Trainer = require('../models/Trainer');
const router = express.Router();

/**
 * UNIFIED LOGIN ENDPOINT (handles all 3 roles)
 * POST /api/login
 * body: { username, password, role }
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({
      success: false,
      message: 'Username, password, and role are required'
    });
  }

  let user;
  let Model;

  // Select the correct model based on role
  if (role === 'admin') {
    Model = Admin;
  } else if (role === 'member') {
    Model = Member;
  } else if (role === 'trainer') {
    Model = Trainer;
  } else {
    return res.status(400).json({
      success: false,
      message: 'Invalid role specified'
    });
  }

  // Find user in the appropriate collection
  user = await Model.findOne({ username: username.trim() }).lean();
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  // Remove password from response
  delete user.password;
  // Add role to user object for frontend
  user.role = role;

  // Generate JWT token
  const token = jwt.sign(
    { id: user._id, username: user.username, role: role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );

  res.json({
    success: true,
    token,
    user,
    message: 'Login successful'
  });
}));

/**
 * Admin login (LEGACY - kept for backward compatibility)
 * POST /api/admin/login
 * body: { username, password }
 */
router.post('/admin/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
  const admin = await Admin.findOne({ username: username.trim() }).lean();
  if (!admin) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, admin.password);
  if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  delete admin.password;

  // Generate JWT token
  const token = jwt.sign(
    { id: admin._id, username: admin.username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );

  res.json({ success: true, token, data: admin });
}));

/**
 * Member login (LEGACY - kept for backward compatibility)
 * POST /api/member/login
 * body: { username, password }
 */
router.post('/member/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
  const member = await Member.findOne({ username: username.trim() }).lean();
  if (!member) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, member.password);
  if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  delete member.password;

  // Generate JWT token
  const token = jwt.sign(
    { id: member._id, username: member.username, role: 'member' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );

  res.json({ success: true, token, data: member });
}));

/**
 * Trainer login (LEGACY - kept for backward compatibility)
 * POST /api/trainer/login
 * body: { username, password }
 */
router.post('/trainer/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
  const trainer = await Trainer.findOne({ username: username.trim() }).lean();
  if (!trainer) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, trainer.password);
  if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  delete trainer.password;

  // Generate JWT token
  const token = jwt.sign(
    { id: trainer._id, username: trainer.username, role: 'trainer' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );

  res.json({ success: true, token, data: trainer });
}));

module.exports = router;
