const GeneralSetting = require('../models/GeneralSetting');

async function getPublic(req, res) {
  try { const settings = await GeneralSetting.findOne({ key: 'default' }).lean() || { platformName: 'OPERIX', supportUrl: '', maintenanceMode: false, maintenanceMessage: 'الخدمة متاحة حاليًا' }; if (settings.supportUrl === 'https://t.me/TRADING_KURD3') settings.supportUrl = ''; res.json({ success: true, settings }); }
  catch (error) { res.status(500).json({ error: 'تعذر تحميل إعدادات المنصة' }); }
}

async function getAdmin(req, res) {
  try { const settings = await GeneralSetting.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { platformName: 'OPERIX', supportUrl: '', maintenanceMode: false, maintenanceMessage: 'الخدمة متاحة حاليًا' } }, { upsert: true, new: true }); if (settings.supportUrl === 'https://t.me/TRADING_KURD3') settings.supportUrl = ''; res.json({ success: true, settings }); }
  catch (error) { res.status(500).json({ error: 'تعذر تحميل الإعدادات' }); }
}

async function update(req, res) {
  try {
    const update = {};
    if (req.body.platformName !== undefined) update.platformName = String(req.body.platformName).trim().slice(0, 80);
    if (req.body.supportUrl !== undefined) {
      const supportUrl = String(req.body.supportUrl).trim();
      if (supportUrl && !/^https:\/\//i.test(supportUrl)) return res.status(400).json({ error: 'يجب أن يبدأ رابط الدعم بـ https://' });
      update.supportUrl = supportUrl.slice(0, 300);
    }
    if (req.body.maintenanceMode !== undefined) update.maintenanceMode = Boolean(req.body.maintenanceMode);
    if (req.body.maintenanceMessage !== undefined) update.maintenanceMessage = String(req.body.maintenanceMessage).trim().slice(0, 240);
    const settings = await GeneralSetting.findOneAndUpdate({ key: 'default' }, { $set: update }, { upsert: true, new: true, runValidators: true });
    res.json({ success: true, settings, message: 'تم حفظ إعدادات المنصة' });
  } catch (error) { res.status(500).json({ error: 'تعذر حفظ الإعدادات' }); }
}
module.exports = { getPublic, getAdmin, update };
