const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth'); 
const Member = require('../models/Member');
const MembershipHistory = require('../models/MembershipHistory'); 
const transporter = require('../utils/nodemailer');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const upload = multer();
const router = express.Router();

const faceUploads = upload.fields([
  { name: 'faceImage1', maxCount: 1 },
  { name: 'faceImage2', maxCount: 1 },
  { name: 'faceImage3', maxCount: 1 },
]);

router.get('/', protect, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status && ['active', 'inactive', 'suspended'].includes(status)) {
    filter.status = status;
  }
  const members = await Member.find(filter).lean();
  members.forEach(m => delete m.password);
  res.json({ success: true, count: members.length, data: members });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const { query, type } = req.query;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters long' });
  }
  const filter = {
    $and: [
      {
        $or: [{ name: { $regex: query, $options: 'i' } }, { memberId: { $regex: query, $options: 'i' } }]
      }
    ]
  };
  if (type === 'combative') {
    filter.$and.push({ 'memberships.type': 'combative' });
  }
  const members = await mongoose.connection.db.collection('members').find(filter).limit(25).toArray();
  members.forEach(m => delete m.password);
  res.json({ success: true, count: members.length, data: members });
}));

router.get('/:id', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  let query = { $or: [{ memberId: id }, { username: id }, { faceId: id }] };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query.$or.push({ _id: new mongoose.Types.ObjectId(id) });
  }
  const member = await Member.findOne(query).lean();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, data: member });
}));

router.post('/', protect, faceUploads, asyncHandler(async (req, res) => {
  let memberships = req.body.memberships;
  if (typeof memberships === 'string') {
    try {
      memberships = JSON.parse(memberships);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid memberships format' });
    }
  }
  
  const { 
    name: rawName, joinDate, phone: rawPhone, email: rawEmail, faceEnrolled,
    birthdate, gender, address, emergencyName, emergencyPhone, emergencyRelation 
  } = req.body;
  
  const name = rawName?.trim();
  const phone = rawPhone?.trim() || "";
  const email = rawEmail?.trim()?.toLowerCase() || "";
  
  if (!name || !memberships || !Array.isArray(memberships) || memberships.length === 0) {
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!memberships || !Array.isArray(memberships) || memberships.length === 0) errors.memberships = 'At least one membership is required';
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  if (!gender || !['Male', 'Female', 'Other'].includes(gender)) {
    return res.status(400).json({ success: false, error: 'Valid gender is required' });
  }
  if (!birthdate) {
    return res.status(400).json({ success: false, error: 'Date of birth is required' });
  }
  
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0].toLowerCase();
  const lastName = nameParts.slice(1).join('').toLowerCase();
  let username = firstName + lastName;
  let suffix = 0;
  while (await Member.findOne({ username })) {
    suffix++;
    username = firstName + lastName + suffix;
  }
  const tempPassword = firstName + Math.floor(1000 + Math.random() * 9000);
  
  const validatedMemberships = [];
  for (const m of memberships) {
    if (!m?.type || !['monthly', 'combative', 'dance'].includes(m.type)) {
      return res.status(400).json({ success: false, error: 'Each membership must have a valid type (monthly or combative)' });
    }
    if (!m?.duration || Number(m.duration) < 1) {
      return res.status(400).json({ success: false, error: 'Each membership must have a valid duration (at least 1)' });
    }
    const startDate = m.startDate ? new Date(m.startDate) : (joinDate ? new Date(joinDate) : new Date());
    const endDate = new Date(startDate);
    
    if (m.type === 'monthly') {
      endDate.setMonth(endDate.getMonth() + Number(m.duration));
      validatedMemberships.push({
        type: m.type,
        duration: Number(m.duration), 
        startDate,
        endDate,
        status: m.status && ['active', 'inactive', 'suspended', 'expired', 'cancelled'].includes(m.status) ? m.status : 'active',
        remainingSessions: 0,
        paymentStatus: m.paymentStatus === 'unpaid' ? 'unpaid' : 'paid' 
      });
    } else {
      endDate.setMonth(endDate.getMonth() + Number(m.duration));
      validatedMemberships.push({
        type: m.type,
        duration: Number(m.duration), 
        startDate,
        endDate,
        status: m.status && ['active', 'inactive', 'suspended', 'expired', 'cancelled'].includes(m.status) ? m.status : 'active',
        remainingSessions: Number(m.duration) * 12,
        paymentStatus: m.paymentStatus === 'unpaid' ? 'unpaid' : 'paid' 
      });
    }
  }
  
  const newMember = new Member({
    name,
    username,
    password: tempPassword,
    memberships: validatedMemberships,
    joinDate: joinDate ? new Date(joinDate) : new Date(),
    phone: phone,
    email: email,
    dob: new Date(birthdate),
    gender,
    address: address || "",
    emergencyContact: {
      name: emergencyName || "",
      phone: emergencyPhone || "",
      relation: emergencyRelation || ""
    },
    faceEnrolled: faceEnrolled === 'yes'
  });

  let saved;
  try {
      saved = await newMember.save();
  } catch (error) {
      // FIX: Automatically resolve MongoDB legacy unique index conflicts for email/phone
      if (error.code === 11000) {
          const field = Object.keys(error.keyValue)[0];
          
          if (field === 'email' || field === 'phone') {
              try {
                  // Drop the problematic index and seamlessly retry the save
                  await mongoose.connection.db.collection('members').dropIndex(`${field}_1`);
                  saved = await newMember.save(); 
              } catch (retryError) {
                  return res.status(400).json({ 
                      success: false, 
                      error: `Could not auto-resolve database index. Please manually drop the unique index for ${field}.` 
                  });
              }
          } else {
              return res.status(400).json({ 
                  success: false, 
                  error: `Database Conflict: ${field} is already in use.` 
              });
          }
      } else {
          throw error; 
      }
  }
  
  if (saved.email) {
    transporter.sendMail({
      from: `"GOALS Gym" <${process.env.EMAIL_USER}>`,
      to: saved.email,
      subject: 'Welcome to GOALS Gym!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Poppins', Helvetica, Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
            .wrapper { max-width: 600px; margin: 30px auto; background-color: #1e1e1e; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
            .header { background: linear-gradient(135deg, #b30000 0%, #ff3333 100%); color: #ffffff; padding: 25px; text-align: center; text-transform: uppercase; letter-spacing: 2px; }
            .header h1 { margin: 0; font-size: 26px; font-weight: 800; }
            .content { padding: 35px; color: #e0e0e0; line-height: 1.6; }
            .content h2 { color: #ffffff; margin-top: 0; font-size: 22px; }
            .credentials-box { background-color: rgba(0, 0, 0, 0.4); border-left: 4px solid #ff3333; padding: 20px; margin: 25px 0; border-radius: 6px; }
            .credentials-box p { margin: 8px 0; font-size: 16px; }
            .highlight { color: #ff3333; font-weight: 700; }
            .footer { background-color: #111111; color: #777777; text-align: center; padding: 20px; font-size: 12px; }
            .note { font-size: 13px; color: #aaaaaa; font-style: italic; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <h1>GOALS Gym</h1>
            </div>
            <div class="content">
              <h2>Welcome to the family, ${saved.name}!</h2>
              <p>Your membership account has been successfully created. We are thrilled to have you join us and can't wait to see you crush your fitness goals!</p>
              <p>Below are your official account credentials to access the member portal:</p>
              
              <div class="credentials-box">
                <p><strong>Username:</strong> <span class="highlight">${saved.username}</span></p>
                <p><strong>Temporary Password:</strong> <span class="highlight">${tempPassword}</span></p>
              </div>
              
              <p class="note">* For your own security, please make sure to change your password immediately after your first login.</p>
              
              <p>See you on the gym floor!</p>
              <p><strong>- The GOALS Gym Team</strong></p>
            </div>
            <div class="footer">
              <p>This is an automated message, please do not reply to this email.</p>
              <p>&copy; ${new Date().getFullYear()} GOALS Gym. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    }).catch(err => console.error('Welcome email error:', err));
  }

  if (req.files && req.files.faceImage1 && req.files.faceImage2 && req.files.faceImage3) {
    const fd = new FormData();
    fd.append('image1', req.files.faceImage1[0].buffer, { filename: 'face1.jpg', contentType: req.files.faceImage1[0].mimetype });
    fd.append('image2', req.files.faceImage2[0].buffer, { filename: 'face2.jpg', contentType: req.files.faceImage2[0].mimetype });
    fd.append('image3', req.files.faceImage3[0].buffer, { filename: 'face3.jpg', contentType: req.files.faceImage3[0].mimetype });
    fd.append('faceId', saved._id.toString());
    fd.append('name', name);
    axios.post('http://localhost:5001/api/enroll-face', fd, { headers: fd.getHeaders() })
      .then(r => {
        if (r.data?.status === 'success' && r.data.faceId) {
          return Member.findByIdAndUpdate(saved._id, { faceId: r.data.faceId, faceEnrolled: true });
        }
      })
      .catch(err => console.log('Flask enroll error:', err?.message || err));
  }

  res.status(201).json({
    success: true,
    message: 'Member created successfully',
    data: {
      memberId: saved.memberId,
      mongoId: saved._id,
      name: saved.name,
      username: saved.username,
      memberships: saved.memberships,
      faceId: saved.faceId,
      joinDate: saved.joinDate,
      phone: saved.phone,
      email: saved.email,
      status: saved.status
    }
  });
}));

router.put('/:id/profile', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { phone, email } = req.body || {};
  const updates = {};
  if (typeof phone !== 'undefined') updates.phone = phone ? phone.trim() : '';
  if (typeof email !== 'undefined') updates.email = email ? email.trim().toLowerCase() : '';

  if (updates.email && updates.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  
  let member;
  try {
      member = await Member.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true }).lean();
  } catch (error) {
      if (error.code === 11000) {
          const field = Object.keys(error.keyValue)[0];
          if (field === 'email' || field === 'phone') {
              await mongoose.connection.db.collection('members').dropIndex(`${field}_1`).catch(() => {});
              member = await Member.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true }).lean();
          } else {
              return res.status(400).json({ success: false, error: `${field} is already in use.` });
          }
      } else {
          throw error;
      }
  }

  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });
  delete member.password;
  res.json({ success: true, message: 'Profile updated successfully', data: member });
}));

router.put('/:id', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, status, memberships, gender, address, emergencyName, emergencyPhone, emergencyRelation } = req.body || {};
  const updates = {};
  
  if (typeof name !== 'undefined') updates.name = name?.trim();
  if (typeof phone !== 'undefined') updates.phone = phone ? phone.trim() : '';
  if (typeof email !== 'undefined') updates.email = email ? email.trim().toLowerCase() : '';
  
  if (typeof gender !== 'undefined') updates.gender = gender;
  if (typeof address !== 'undefined') updates.address = address;
  if (typeof emergencyName !== 'undefined') updates['emergencyContact.name'] = emergencyName;
  if (typeof emergencyPhone !== 'undefined') updates['emergencyContact.phone'] = emergencyPhone;
  if (typeof emergencyRelation !== 'undefined') updates['emergencyContact.relation'] = emergencyRelation;

  if (typeof status !== 'undefined') {
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    updates.status = status;
  }
  
  if (updates.email && updates.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  if (Array.isArray(memberships)) {
    const validated = memberships.map(m => {
      if (!m?.type || !['monthly', 'combative'].includes(m.type)) {
        throw new Error('Each membership must have a valid type (monthly or combative)');
      }
      if (!m?.duration || Number(m.duration) < 1) {
        throw new Error('Each membership must have a valid duration (at least 1)');
      }
      const startDate = m.startDate ? new Date(m.startDate) : new Date();
      const out = {
        type: m.type,
        duration: Number(m.duration), 
        startDate,
        status: m.status && ['active', 'inactive', 'suspended', 'expired', 'cancelled'].includes(m.status) ? m.status : 'active'
      };
      if (m.type === 'combative') out.remainingSessions = Number(m.duration) * 12;
      return out;
    });

    updates.memberships = validated.map(m => {
      const end = new Date(m.startDate);
      end.setMonth(end.getMonth() + m.duration);
      return { ...m, endDate: end };
    });
  }

  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  
  let updated;
  try {
      updated = await Member.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true });
  } catch (error) {
      if (error.code === 11000) {
          const field = Object.keys(error.keyValue)[0];
          if (field === 'email' || field === 'phone') {
              await mongoose.connection.db.collection('members').dropIndex(`${field}_1`).catch(() => {});
              updated = await Member.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true });
          } else {
              return res.status(400).json({ success: false, error: `${field} is already in use.` });
          }
      } else {
          throw error;
      }
  }

  if (!updated) return res.status(404).json({ success: false, error: 'Member not found' });
  
  res.json({
    success: true,
    message: 'Member updated',
    data: {
      memberId: updated.memberId,
      name: updated.name,
      phone: updated.phone,
      email: updated.email,
      status: updated.status,
      memberships: updated.memberships
    }
  });
}));

router.put('/:id/renew', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { memberships, status } = req.body;
  
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  }

  const currentMember = await Member.findOne(query);
  if (!currentMember) return res.status(404).json({ success: false, error: 'Member not found' });

  if (Array.isArray(memberships)) {
    const incomingIds = memberships.filter(m => m._id).map(m => m._id.toString());
    const archivedMemberships = currentMember.memberships.filter(m => !incomingIds.includes(m._id.toString()));

    if (archivedMemberships.length > 0) {
      try {
        const historyDocs = archivedMemberships.map(m => {
          const now = new Date();
          let dur = m.duration;
          if (!dur && m.startDate && m.endDate) {
            dur = (new Date(m.endDate).getFullYear() - new Date(m.startDate).getFullYear()) * 12 + 
                  (new Date(m.endDate).getMonth() - new Date(m.startDate).getMonth());
          }
          return {
            member: currentMember._id,
            memberIdString: currentMember.memberId,
            type: m.type,
            duration: dur || 1, 
            startDate: m.startDate,
            endDate: now, 
            remainingSessions: m.remainingSessions,
            archivedAt: now
          };
        });
        await MembershipHistory.insertMany(historyDocs);
      } catch (err) {
        console.error("Error archiving membership history:", err);
      }
    }

    const validated = memberships.map(m => {
      if (!m?.type || !['monthly', 'combative'].includes(m.type)) {
        throw new Error('Each membership must have a valid type');
      }
      
      const startDate = m.startDate ? new Date(m.startDate) : new Date();
      let endDate;
      
      if (m.endDate) {
        endDate = new Date(m.endDate);
      } else {
        endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + Number(m.duration));
      }

      const out = {
        type: m.type,
        duration: Number(m.duration),
        startDate,
        endDate,
        status: m.status || 'active',
        paymentStatus: 'paid'
      };
      
      if (m._id) out._id = m._id; 
      if (m.type === 'combative') {
         out.remainingSessions = m.remainingSessions !== undefined ? Number(m.remainingSessions) : Number(m.duration) * 12;
      } else {
         out.remainingSessions = 0;
      }
      return out;
    });

    currentMember.memberships = validated;
  }

  if (status) currentMember.status = status;
  const updated = await currentMember.save();

  res.json({
    success: true,
    message: 'Membership renewed successfully',
    data: updated
  });
}));

router.patch('/:id/archive', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['inactive'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be inactive' });
  }
  
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  }

  const member = await Member.findOne(query);
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

  if (member.memberships && member.memberships.length > 0) {
    try {
      const now = new Date();
      const historyDocs = member.memberships.map(m => {
        let dur = m.duration;
        if (!dur && m.startDate && m.endDate) {
          dur = (new Date(m.endDate).getFullYear() - new Date(m.startDate).getFullYear()) * 12 + 
                (new Date(m.endDate).getMonth() - new Date(m.startDate).getMonth());
        }
        return {
          member: member._id,
          memberIdString: member.memberId,
          type: m.type,
          duration: dur || 1, 
          startDate: m.startDate,
          endDate: now, 
          remainingSessions: m.remainingSessions,
          archivedAt: now
        };
      });
      
      await MembershipHistory.insertMany(historyDocs);
      member.memberships = [];
    } catch (err) {
      console.error("Error archiving membership history:", err);
      return res.status(500).json({ success: false, error: 'Failed to save membership history' });
    }
  }

  member.status = status;
  await member.save();

  res.json({
    success: true,
    message: `Member archived successfully`,
    data: { memberId: member.memberId, name: member.name, status: member.status }
  });
}));

router.patch('/:id/status', protect, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be active or inactive' });
  }
  let query = { memberId: id };
  if (mongoose.Types.ObjectId.isValid(id)) query = { $or: [{ memberId: id }, { _id: new mongoose.Types.ObjectId(id) }] };
  const updated = await Member.findOneAndUpdate(query, { $set: { status } }, { new: true });
  if (!updated) return res.status(404).json({ success: false, error: 'Member not found' });
  res.json({
    success: true,
    message: `Member status set to ${status}`,
    data: { memberId: updated.memberId, name: updated.name, status: updated.status }
  });
}));

module.exports = router;