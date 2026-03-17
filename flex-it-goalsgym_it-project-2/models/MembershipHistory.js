const mongoose = require('mongoose');

const MembershipHistorySchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberIdString: { type: String, required: true },
    type: { type: String, required: true, enum: ['monthly', 'combative'] },
    duration: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    remainingSessions: { type: Number, default: 0 },
    status: { type: String, default: 'expired' },
    archivedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('MembershipHistory', MembershipHistorySchema);