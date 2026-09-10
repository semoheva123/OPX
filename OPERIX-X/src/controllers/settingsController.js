const GeneralSetting = require('../models/GeneralSetting');
const { supabaseAdmin } = require('../config/supabase');

const defaultSettings = { platformName: 'OPERIX', supportUrl: '', maintenanceMode: false, maintenanceMessage: 'الخدمة متاحة حاليًا' };

function sanitizeSettings(settings = {}) {
  const result = { ...defaultSettings, ...settings };
  if (result.supportUrl === 'https://t.me/TRADING_KURD3') result.supportUrl = '';
  return result;
}

async function getSupabaseSettings() {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from('general_settings').select('value').eq('key', 'default').maybeSingle();
  if (error) throw error;
  return sanitizeSettings(data?.value || {});
}

async function saveSupabaseSettings(update) {
  const current = await getSupabaseSettings() || defaultSettings;
  const value = sanitizeSettings({ ...current, ...update });
  const { data, error } = await supabaseAdmin
    .from('general_settings')
    .upsert({ key: 'default', value }, { onConflict: 'key' })
    .select('value')
    .single();
  if (error) throw error;
  return sanitizeSettings(data?.value || value);
}

async function getPublic(req, res) {
  try {
    const settings = (process.env.DATABASE_MODE || '').toLowerCase() === 'supabase'
      ? await getSupabaseSettings() || defaultSettings
      : await GeneralSetting.findOne({ key: 'default' }).lean() || defaultSettings;
    res.json({ success: true, settings: sanitizeSettings(settings) });
  }
  catch (error) { res.status(500).json({ error: 'تعذر تحميل إعدادات المنصة' }); }
}

async function getAdmin(req, res) {
  try {
    const settings = (process.env.DATABASE_MODE || '').toLowerCase() === 'supabase'
      ? await saveSupabaseSettings({})
      : await GeneralSetting.findOneAndUpdate({ key: 'default' }, { $setOnInsert: defaultSettings }, { upsert: true, new: true });
    res.json({ success: true, settings: sanitizeSettings(settings) });
  }
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
    const settings = (process.env.DATABASE_MODE || '').toLowerCase() === 'supabase'
      ? await saveSupabaseSettings(update)
      : await GeneralSetting.findOneAndUpdate({ key: 'default' }, { $set: update }, { upsert: true, new: true, runValidators: true });
    res.json({ success: true, settings, message: 'تم حفظ إعدادات المنصة' });
  } catch (error) { res.status(500).json({ error: 'تعذر حفظ الإعدادات' }); }
}
module.exports = { getPublic, getAdmin, update };
