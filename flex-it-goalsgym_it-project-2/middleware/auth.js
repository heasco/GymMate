// middleware/auth.js

const jwt = require('jsonwebtoken');
const asyncHandler = require('./asyncHandler');
const ActiveSession = require('../models/ActiveSession');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded should have { id, role, jti }

    const session = await ActiveSession.findOne({
      jti: decoded.jti,
      userId: decoded.id,
      role: decoded.role,
      revokedAt: null,
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message:
          'Session is no longer active. You may have logged out or logged in from another browser.',
      });
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
      sessionId: decoded.jti,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, invalid token',
    });
  }
});

// Optional: Role-based authorization middleware
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user.role} is not authorized to access this resource`,
      });
    }
    next();
  };
};

exports.admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(401).json({ message: 'Not authorized as an admin' });
    }
};
