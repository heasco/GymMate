// models/ActiveSession.js

const mongoose = require('mongoose');

const ActiveSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  role: {
    type: String,
    enum: ['admin', 'member', 'trainer'],
    required: true,
    index: true,
  },
  jti: {
    type: String,
    required: true,
    unique: true,
  },
  userAgent: String,
  ip: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  revokedAt: {
    type: Date,
    default: null,
  },
});

ActiveSessionSchema.index({ userId: 1, role: 1, revokedAt: 1 });

module.exports = mongoose.model('ActiveSession', ActiveSessionSchema);
