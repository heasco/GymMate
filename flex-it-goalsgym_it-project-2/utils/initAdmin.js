const Admin = require('../models/Admin');

module.exports = async function initAdmin() {
  const count = await Admin.countDocuments();
  if (count === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'password123';
    const name = process.env.ADMIN_NAME || 'Super Admin';

    const admin = new Admin({ username, password, name, role: 'admin' });
    await admin.save();
    console.log('Default admin created:', username);
  } else {
    console.log('Admin exists, skipping initAdmin');
  }
};
