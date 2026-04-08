const mongoose = require('mongoose');

const MembershipHistorySchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberIdString: { type: String, required: true },
    type: { type: String, required: true, enum: ['monthly', 'combative', 'dance', 'dropsin', 'student'] },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String },
    transactionId: { type: String }, // NEW
    duration: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    remainingSessions: { type: Number, default: 0 },
    archivedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('MembershipHistory', MembershipHistorySchema);