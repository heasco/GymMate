const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MembershipSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['monthly', 'combative'] },
  duration: { type: Number, required: true, min: [1, 'Duration must be at least 1'] },
  startDate: { type: Date, required: true, default: Date.now },
  endDate: { type: Date, required: true },
  remainingSessions: { type: Number, default: 0 },
  status: { type: String, default: 'active', enum: ['active', 'inactive', 'suspended', 'expired'] }
});

const MemberSchema = new mongoose.Schema(
  {
    memberId: { type: String, unique: true, index: true },
    name: { type: String, required: [true, 'Please add a name'], trim: true },
    username: { type: String, unique: true, required: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: [6, 'Password must be at least 6 characters'] },
    memberships: [MembershipSchema],
    joinDate: { type: Date, required: true, default: Date.now },
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: v => !v || /^\+63\d{10}$/.test(v),
        message: props => `${props.value} is not a valid Philippine phone number!`
      }
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: props => `${props.value} is not a valid email!`
      }
    },
    faceId: { type: String },
    faceEnrolled: { type: Boolean, default: false },
    transactions: { type: [String], default: [] },
    status: { type: String, default: 'active', enum: ['active', 'inactive', 'suspended'] }
  },
  { timestamps: true, collection: 'members' }
);

// Hash password before saving
MemberSchema.pre('save', async function (next) {
  try {
    if (this.isModified('password')) {
      this.password = await bcrypt.hash(this.password, 10);
    }
    next();
  } catch (e) {
    next(e);
  }
});

// Calculate membership fields before validation
MemberSchema.pre('validate', function (next) {
  try {
    if (this.isModified('memberships') || this.isNew) {
      this.memberships.forEach((membership) => {
        const needsCalc =
          membership.isNew ||
          membership.isModified?.('startDate') ||
          membership.isModified?.('type') ||
          membership.isModified?.('duration') ||
          !membership.endDate;

        if (!needsCalc) return;

        const start = membership.startDate ? new Date(membership.startDate) : new Date();

        if (membership.type === 'monthly') {
          const end = new Date(start);
          end.setMonth(end.getMonth() + Number(membership.duration || 1));
          membership.startDate = start;
          membership.endDate = end;
          membership.remainingSessions = 0;
        } else if (membership.type === 'combative') {
          // duration = sessions allowance, expiry = 1 month window
          const end = new Date(start);
          end.setMonth(end.getMonth() + 1);
          membership.startDate = start;
          membership.endDate = end;
          membership.remainingSessions = Number(membership.duration || 1);
        }
      });
    }
    next();
  } catch (e) {
    next(e);
  }
});

// Auto-generate memberId before saving
MemberSchema.pre('save', async function (next) {
  if (!this.isNew || this.memberId) return next();
  try {
    const last = await this.constructor.findOne({ memberId: { $exists: true } }, { memberId: 1 }, { sort: { memberId: -1 } });
    const lastNum = last ? parseInt(last.memberId.split('-')[1], 10) : 0;
    this.memberId = `MEM-${String(lastNum + 1).padStart(4, '0')}`;
    next();
  } catch (e) {
    next(e);
  }
});

if (mongoose.models.Member) {
  mongoose.deleteModel('Member');
}
module.exports = mongoose.model('Member', MemberSchema, 'members');
