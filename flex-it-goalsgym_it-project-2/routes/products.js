const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth'); 
const Product = require('../models/Product');
const router = express.Router();

// Get all products (with optional status filter)
router.get('/', asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const filter = {};

  if (status && status !== 'all') {
    filter.status = status;
  }

  // Server-side search by product name or membership type
  if (search) {
    filter.$or = [
      { product_name: { $regex: search, $options: 'i' } },
      { membership_type: { $regex: search, $options: 'i' } }
    ];
  }

  const startIndex = (page - 1) * limit;
  const total = await Product.countDocuments(filter);

  // Get all unique categories for the frontend dropdowns
  const categories = await Product.distinct('membership_type');

  // Fetch paginated products, newest first
  const products = await Product.find(filter)
    .sort({ _id: -1 })
    .skip(startIndex)
    .limit(limit)
    .lean();

  res.json({
    success: true,
    data: products,
    categories: categories, // Send unique categories back
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
  });
}));

// Create a new product (NEW ROUTE ADDED HERE)
router.post('/', protect, asyncHandler(async (req, res) => {
  const { product_name, membership_type, price, sessions, schedule, description } = req.body;
  
  if (!product_name || !membership_type || price === undefined) {
    return res.status(400).json({ 
      success: false, 
      error: 'Product name, membership type, and price are required.' 
    });
  }

  const product = await Product.create({
    product_name,
    membership_type,
    price,
    sessions,
    schedule,
    description
  });

  res.status(201).json({ success: true, data: product });
}));

// Update a product
router.put('/:id', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const product = await Product.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
  
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, data: product });
}));

// Change product status (e.g., archive)
router.patch('/:id/status', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'archived'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  const product = await Product.findByIdAndUpdate(id, { status }, { new: true });
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  
  res.json({ success: true, data: product });
}));

module.exports = router;