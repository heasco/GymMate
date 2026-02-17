const Admin = require('../models/Admin');
const EmailTemplate = require('../models/EmailTemplate');

const seedTemplates = async () => {
  const templateCount = await EmailTemplate.countDocuments();
  if (templateCount === 0) {
    const templates = [
      {
        name: 'Event Announcement',
        subject: "📢 Get Ready! [Event Name] is Coming to Goal's Gym!",
        body: `Hi [Member Name],\n\nIt’s time to level up! We are thrilled to invite you to our upcoming event: [Event Name]. Whether you’re looking to break a personal record or just meet the community, this is the place to be.\n\n📅 Date: [Date]\n\n⏰ Time: [Time]\n\n📍 Location: Goal's Gym Main Floor\n\n🔥 What to expect: [Brief description, e.g., High-intensity workshop, guest trainer session, or fitness challenge].\n\nHow to Join:\nYou can register directly through your GymMate Member Dashboard or simply check in with your facial ID at the front desk to confirm your spot.\n\nWe can’t wait to see you there!\n\nStay Strong,\nThe Goal's Gym Team`,
      },
      {
        name: 'Freebie Announcement',
        subject: '🎁 A little something for your hard work!',
        body: `Hi [Member Name],\n\nYou’ve been crushing your workouts lately, and we noticed! As a token of our appreciation, we have a little gift for you.\n\nYour Freebie: [Name of Freebie, e.g., A Goal’s Gym Shaker / Free Protein Shake / Guest Pass]\n\nHow to Claim:\nNext time you swing by, just head to the front desk. Our GymMate system will recognize your check-in, and our staff will have your gift ready for you!\n\nNote: This offer is available until [Expiry Date] or while supplies last.\n\nKeep up the incredible momentum!\n\nBest,\nThe Goal's Gym Team`,
      },
      {
        name: 'Special Promotion',
        subject: '⚡ Limited Time: Exclusive Promotion for [Member Name]!',
        body: `Hi [Member Name],\n\nWe want to help you reach your goals even faster. For a limited time, we’re offering an exclusive promotion for our loyal members:\n\nThe Offer: [Promotion Details, e.g., 20% off Annual Renewals / Buy 10 Personal Training Sessions, Get 2 Free]\n\nWhy now?\nWith our new GymMate tracking features, there’s never been a better time to stay consistent and monitor your progress in real-time.\n\nClaim this deal:\nClick the button below to upgrade your plan in your dashboard, or chat with us during your next visit.\n\n[Claim My Promotion]\n\nOffer expires on [Date].\n\nSee you at the gym!\n\nThe Goal's Gym Team`,
      },
    ];
    await EmailTemplate.insertMany(templates);
    console.log('Default email templates created.');
  } else {
    console.log('Email templates exist, skipping seeding.');
  }
};

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

  await seedTemplates();
};

