const { supabaseAdmin } = require('../config/supabase');
const dataAccess = require('../services/dataAccess');

const defaultSettings = { platformName: 'OPERIX', supportUrl: '', maintenanceMode: false, maintenanceMessage: 'الخدمة متاحة حاليًا' };

function isTelegramUrl(value) {
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase();
    return ['t.me', 'telegram.me', 'telegram.org', 'telegram.dog', 'tgram.me'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch (error) {
    return false;
  }
}

function sanitizeSettings(settings = {}) {
  const result = { ...defaultSettings, ...settings };
  if (isTelegramUrl(result.supportUrl)) result.supportUrl = '';
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
    const settings = await getSupabaseSettings() || defaultSettings;
    res.json({ success: true, settings: sanitizeSettings(settings) });
  }
  catch (error) {
    if (error?.code === 'PGRST205') return res.json({ success: true, settings: defaultSettings, source: 'defaults' });
    res.status(500).json({ error: 'تعذر تحميل إعدادات المنصة' });
  }
}

async function getAdmin(req, res) {
  try {
    const settings = await saveSupabaseSettings({});
    res.json({ success: true, settings: sanitizeSettings(settings) });
  }
  catch (error) {
    if (error?.code === 'PGRST205') return res.status(503).json({ error: 'جدول إعدادات المنصة غير مهيأ في Supabase' });
    res.status(500).json({ error: 'تعذر تحميل الإعدادات' });
  }
}

async function update(req, res) {
  try {
    const update = {};
    if (req.body.platformName !== undefined) update.platformName = String(req.body.platformName).trim().slice(0, 80);
    if (req.body.supportUrl !== undefined) {
      const supportUrl = String(req.body.supportUrl).trim();
      if (supportUrl && !/^https:\/\//i.test(supportUrl)) return res.status(400).json({ error: 'يجب أن يبدأ رابط الدعم بـ https://' });
      if (supportUrl && isTelegramUrl(supportUrl)) return res.status(400).json({ error: 'روابط Telegram غير متاحة كرابط دعم للمنصة.' });
      update.supportUrl = supportUrl.slice(0, 300);
    }
    if (req.body.maintenanceMode !== undefined) update.maintenanceMode = Boolean(req.body.maintenanceMode);
    if (req.body.maintenanceMessage !== undefined) update.maintenanceMessage = String(req.body.maintenanceMessage).trim().slice(0, 240);
    const settings = await saveSupabaseSettings(update);
    res.json({ success: true, settings, message: 'تم حفظ إعدادات المنصة' });
  } catch (error) {
    if (error?.code === 'PGRST205') return res.status(503).json({ error: 'جدول إعدادات المنصة غير مهيأ في Supabase' });
    res.status(500).json({ error: 'تعذر حفظ الإعدادات' });
  }
}
module.exports = { getPublic, getAdmin, update };
