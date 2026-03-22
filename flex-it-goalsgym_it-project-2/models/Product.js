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
    enum: ['monthly', 'combative'],
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  schedule: {
    type: String,
    default: '' // Optional, mostly used for combative classes
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