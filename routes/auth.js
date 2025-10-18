// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../middleware/asyncHandler'); // if you have one
const Admin = require('../models/Admin');
const Member = require('../models/Member');
const Trainer = require('../models/Trainer');

const router = express.Router();

/**
 * Admin login
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

  // remove sensitive fields
  delete admin.password;
  res.json({ success: true, data: admin });
}));

/**
 * Member login
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
  res.json({ success: true, data: member });
}));

/**
 * Trainer login
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
  res.json({ success: true, data: trainer });
}));

module.exports = router;
