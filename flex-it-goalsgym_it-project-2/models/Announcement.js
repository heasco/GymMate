const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: [true, 'Please add a subject'],
      trim: true,
    },
    body: {
      type: String,
      required: [true, 'Please add a body'],
    },
    recipients: {
      type: [String],
      required: true,
    },
    sentBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'Admin',
    },
  },
  {
    timestamps: true,
    collection: 'announcements',
  }
);

if (mongoose.models.Announcement) {
  mongoose.deleteModel('Announcement');
}
module.exports = mongoose.model('Announcement', AnnouncementSchema);
