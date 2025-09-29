const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  transaction_id: {
    type: String,
    unique: true,
    index: true
  },
  member_id: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  payment_method: {
    type: String,
    enum: ['cash', 'e-wallet', 'bank'],
    required: true
  },
  description: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  collection: 'transactions'
});

// Auto-generate transaction_id before saving
TransactionSchema.pre('save', async function(next) {
  if (!this.isNew || this.transaction_id) return next();
  
  try {
    const lastTransaction = await this.constructor.findOne(
      { transaction_id: { $exists: true } },
      { transaction_id: 1 },
      { sort: { transaction_id: -1 } }
    );
    
    const lastNumber = lastTransaction ? 
      parseInt(lastTransaction.transaction_id.split('-')[1], 10) : 0;
    const nextNumber = lastNumber + 1;
    
    this.transaction_id = `TRX-${String(nextNumber).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Transaction', TransactionSchema, 'transactions');