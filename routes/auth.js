const express = require('express');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../middleware/asyncHandler');

const Admin = require('../models/Admin');
const Member = require('../models/Member');
const Trainer = require('../models/Trainer');

const router = express.Router();

// Handles admin, member, trainer login. Mount at /api so endpoints stay /api/admin/login, /api/member/login, /api/trainer/login.
// Admin login -> POST /api/admin/login
router.post('/admin/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success:false, error: 'Username and password required'});
  const admin = await Admin.findOne({ username: username.trim() });
  if (!admin) return res.status(401).json({ success:false, error: 'Invalid admin credentials' });
  const isPasswordValid = await bcrypt.compare(password, admin.password);
  if (!isPasswordValid) return res.status(401).json({ success:false, error: 'Invalid admin credentials' });
  res.json({ success:true, user: { id: admin._id, username: admin.username, name: admin.name, role: admin.role }});
}));

// Member login -> POST /api/member/login
router.post('/member/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success:false, error: 'Username and password required'});
  const member = await Member.findOne({ username: username.trim() });
  if (!member) return res.status(401).json({ success:false, error: 'Invalid member credentials' });
  const isPasswordValid = await bcrypt.compare(password, member.password);
  if (!isPasswordValid) return res.status(401).json({ success:false, error: 'Invalid member credentials' });
  res.json({ success:true, data: {
    id: member._id, memberId: member.memberId, username: member.username, name: member.name, role: 'member'
  }});
}));

// Trainer login -> POST /api/trainer/login
router.post('/trainer/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success:false, error: 'Username and password required'});
  const trainer = await Trainer.findOne({ username: username.trim() });
  if (!trainer) return res.status(401).json({ success:false, error: 'Invalid trainer credentials' });
  const isPasswordValid = await bcrypt.compare(password, trainer.password);
  if (!isPasswordValid) return res.status(401).json({ success:false, error: 'Invalid trainer credentials' });
  res.json({ success:true, user: { id: trainer._id, username: trainer.username, name: trainer.name, role: 'trainer' }});
}));

module.exports = router;
