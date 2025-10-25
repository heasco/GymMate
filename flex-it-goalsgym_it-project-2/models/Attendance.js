const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true },
  logType: { type: String, enum: ["login", "logout"], required: true },
  timestamp: { type: Date, default: Date.now },
  attendedType: { type: String, enum: ["combative", "gym", "both"], default: "gym" },
  classId: { type: String, default: null }
});

module.exports = mongoose.model('Attendance', AttendanceSchema);
