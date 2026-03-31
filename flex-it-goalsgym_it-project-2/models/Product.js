const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  product_name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  membership_type: {
    type: String,
    required: true // Removed the strict enum so custom types like "Merchandise" or "Dance" can be saved
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  sessions: {
    type: Number,
    default: null // Added to handle the new consumable sessions feature
  },
  schedule: {
    type: String,
    default: '' 
  },
  feedback: [{
    member_id: String,
    member_name: String,
    rating: Number,
    comment: String,
    date_submitted: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true,
  collection: 'products'
});

module.exports = mongoose.model('Product', ProductSchema);