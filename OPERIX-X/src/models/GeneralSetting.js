const mongoose = require('mongoose');
const generalSettingSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'default' },
  platformName: { type: String, default: 'OPERIX', trim: true, maxlength: 80 },
  supportUrl: { type: String, default: '', trim: true, maxlength: 300 },
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: { type: String, default: 'الخدمة متاحة حاليًا', trim: true, maxlength: 240 }
}, { timestamps: true });
module.exports = mongoose.model('GeneralSetting', generalSettingSchema);
