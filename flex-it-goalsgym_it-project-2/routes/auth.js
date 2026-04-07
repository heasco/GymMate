// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const axios = require('axios');

const Admin = require('../models/Admin');
const Member = require('../models/Member');
const ActiveSession = require('../models/ActiveSession');
const Log = require('../models/Log');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '2h', // adjust as needed
  });
}

// POST /api/login - Unified login without requiring role upfront
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required.',
      });
    }

    // Search across collections to find user and determine role
    let user = await Admin.findOne({ username }).lean();
    let userRole = 'admin';
    if (!user) {
      user = await Member.findOne({ username }).lean();
      userRole = 'member';
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // Check if user already has an active session
    const existingSession = await ActiveSession.findOne({
      userId: user._id,
      role: userRole,
      revokedAt: null,
    });

    if (existingSession) {
      // Revoke the old session and allow this login
      await ActiveSession.updateOne(
        { _id: existingSession._id },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason: 'replaced by new login',
          },
        }
      );
    }

    // Create a new session
    const jti = randomUUID();
    await ActiveSession.create({
      userId: user._id,
      role: userRole,
      jti,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip,
    });

    const token = signToken({
      id: user._id.toString(),
      role: userRole,
      jti,
    });

    // Strip password and add role
    const { password: pw, ...safeUser } = user;
    const userWithRole = { ...safeUser, role: userRole };

    try {
      const ip = req.ip;
      let location = 'Unknown';

      if (ip === '127.0.0.1' || ip === '::1') {
        location = 'Local';
      } else {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        if (response.data.country) {
          location = `${response.data.city}, ${response.data.regionName}, ${response.data.country}`;
        }
      }

      await Log.create({
        userId: user._id,
        userModel: userRole.charAt(0).toUpperCase() + userRole.slice(1),
        ipAddress: ip,
        device: req.headers['user-agent'] || '',
        location,
      });
    } catch (error) {
      console.error('Error logging user login:', error);
    }

    return res.json({
      success: true,
      token,
      user: userWithRole,
      role: userRole,
      sessionId: jti,
    });
  })
);

// POST /api/logout (unchanged)
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    // Token is sent as Bearer, same as for protected routes
    const authHeader = req.headers.authorization || '';
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(400).json({
        success: false,
        message: 'Missing or invalid Authorization header.',
      });
    }

    const token = parts[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }

    const { jti, id, role } = decoded;

    // Mark session as revoked
    await ActiveSession.findOneAndUpdate(
      { jti, userId: id, role, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    return res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  })
);


// @desc    Update Admin Settings
// @route   PUT /api/admin/settings
// @access  Private/Admin
router.put(
  '/admin/settings',
  asyncHandler(async (req, res) => {
    // ensure we parse user ID from token middleware here (e.g., req.user._id)
    // As a placeholder, we use the token parsing method you're using.
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { name, twoFactorEnabled, theme } = req.body;
    
    const admin = await Admin.findByIdAndUpdate(
      decoded.id, 
      { $set: { name, twoFactorEnabled, theme } }, 
      { new: true, runValidators: true }
    );

    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

    res.json({ success: true, message: 'Settings updated' });
  })
);
module.exports = router;

// @desc    Update Admin Password
// @route   PUT /api/admin/password
// @access  Private/Admin
router.put(
  '/admin/password',
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { currentPassword, newPassword } = req.body;
    
    // Fetch user securely
    const admin = await Admin.findById(decoded.id);
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

    // Verify existing password
    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect current password' });
    }

    // Update password (your Admin.js pre-save hook will hash it automatically)
    admin.password = newPassword;
    await admin.save();

    res.json({ success: true, message: 'Password updated successfully' });
  })
);