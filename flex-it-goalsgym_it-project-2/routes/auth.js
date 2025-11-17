// routes/auth.js

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const Admin = require('../models/Admin');
const Member = require('../models/Member');
const Trainer = require('../models/Trainer');
const ActiveSession = require('../models/ActiveSession');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '2h', // adjust as needed
  });
}

// Helper to find user by role
async function findUserByRole(role, username) {
  if (role === 'admin') {
    return Admin.findOne({ username }).lean();
  }
  if (role === 'trainer') {
    return Trainer.findOne({ username }).lean();
  }
  if (role === 'member') {
    // Or use email/memberId depending on your schema
    return Member.findOne({ username }).lean();
  }
  return null;
}

// POST /api/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and role are required.',
      });
    }

    const user = await findUserByRole(role, username);
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
    // Check if user already has an active session
    const existingSession = await ActiveSession.findOne({
      userId: user._id,
      role,
      revokedAt: null,
    });

    if (existingSession) {
      // Instead of blocking, revoke the old session and allow this login
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
      role,
      jti,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip,
    });

    const token = signToken({
      id: user._id.toString(),
      role,
      jti,
    });

    // Strip password from response
    const { password: pw, ...safeUser } = user;

    return res.json({
      success: true,
      token,
      user: safeUser,
      sessionId: jti,
    });
  })
);

// POST /api/logout
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

module.exports = router;
