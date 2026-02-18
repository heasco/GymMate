const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'userModel',
  },
  userModel: {
    type: String,
    required: true,
    enum: ['Admin', 'Trainer', 'Member'],
  },
  ipAddress: {
    type: String,
    required: true,
  },
  device: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Log', LogSchema);
