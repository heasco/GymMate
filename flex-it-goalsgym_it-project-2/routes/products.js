const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth'); 
const Product = require('../models/Product');
const router = express.Router();

// Get all products (with optional status filter)
router.get('/', protect, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const products = await Product.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, count: products.length, data: products });
}));

// Add a new product
router.post('/', protect, asyncHandler(async (req, res) => {
  // Added sessions to the destructured body
  const { product_name, description, membership_type, price, schedule, sessions } = req.body;

  if (!product_name || !membership_type || price === undefined) {
    return res.status(400).json({ success: false, error: 'Product name, membership type, and price are required.' });
  }

  const newProduct = await Product.create({
    product_name,
    description,
    membership_type,
    price,
    schedule,
    sessions // Save the sessions to the database
  });

  res.status(201).json({ success: true, data: newProduct });
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