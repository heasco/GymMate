// models/Class.js
const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  class_id: {
    type: String,
    unique: true,
    index: true,
  },
  class_name: {
    type: String,
    required: [true, 'Class name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  schedule: {
    type: String,
    required: [true, 'Schedule is required'],
    trim: true
  },
  trainer_id: {
    type: String,
    required: [true, 'Trainer ID is required'],
    trim: true
  },
  capacity: {
    type: Number,
    required: [true, 'Capacity is required'],
    min: [1, 'Capacity must be at least 1']
  }
}, {
  timestamps: true
});

// Auto-generate class_id before saving
ClassSchema.pre('save', async function (next) {
  if (!this.isNew || this.class_id) return next();

  try {
    const lastClass = await this.constructor.findOne(
      { class_id: { $exists: true } },
      { class_id: 1 },
      { sort: { class_id: -1 } }
    );

    const lastNumber = lastClass ?
      parseInt(lastClass.class_id.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;

    this.class_id = `CLS-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Handle duplicate model definitions
if (mongoose.models.Class) {
  mongoose.deleteModel('Class');
}

module.exports = mongoose.model('Class', ClassSchema);