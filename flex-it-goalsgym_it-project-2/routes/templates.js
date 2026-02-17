const express = require('express');
const router = express.Router();
const EmailTemplate = require('../models/EmailTemplate');


// @desc    Get all email templates
// @route   GET /api/v1/templates
// @access  Private/Admin
router.get('/', async (req, res) => {
    try {
        const templates = await EmailTemplate.find().sort({ createdAt: -1 });
        res.json(templates);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});

// @desc    Create an email template
// @route   POST /api/v1/templates
// @access  Private/Admin
router.post('/', async (req, res) => {
    try {
        const newTemplate = await EmailTemplate.create(req.body);
        res.status(201).json({ success: true, data: newTemplate });
    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'A template with that name already exists.' });
        }
        res.status(400).json({ success: false, error: 'Please provide all required fields.' });
    }
});

// @desc    Update an email template
// @route   PUT /api/v1/templates/:id
// @access  Private/Admin
router.put('/:id', async (req, res) => {
    try {
        let template = await EmailTemplate.findById(req.params.id);

        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }

        template = await EmailTemplate.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.status(200).json({ success: true, data: template });
    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'A template with that name already exists.' });
        }
        res.status(400).json({ success: false, error: 'Error updating template.' });
    }
});

// @desc    Delete an email template
// @route   DELETE /api/v1/templates/:id
// @access  Private/Admin
router.delete('/:id', async (req, res) => {
    try {
        const template = await EmailTemplate.findById(req.params.id);

        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }

        await template.remove();

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});

module.exports = router;
