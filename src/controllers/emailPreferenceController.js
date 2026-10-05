const dataAccess = require('../services/dataAccess');
const { verifyUnsubscribeToken } = require('../services/adminEmailBroadcastService');

async function unsubscribeFromUpdates(req, res) {
  const token = String(req.body?.token || req.query?.token || '').trim();
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return res.status(400).json({ success: false, error: 'رابط إلغاء الاشتراك غير صالح أو منتهي.' });
  try {
    const user = await dataAccess.user.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'تعذر العثور على الحساب.' });
    if (!user.emailUpdatesOptOut) {
      await dataAccess.user.updateOne({ id: userId }, { $set: { emailUpdatesOptOut: true } });
    }
    const message = 'تم إلغاء الاشتراك من رسائل تحديثات المنصة. ستستمر الرسائل الأمنية والضرورية للحساب.';
    if (req.get('List-Unsubscribe') || String(req.body?.['List-Unsubscribe'] || '').includes('One-Click')) return res.status(200).type('text/plain').send(message);
    return res.json({ success: true, message });
  } catch (error) {
    console.error('Email updates unsubscribe failed:', error.message);
    return res.status(503).json({ success: false, error: 'تعذر حفظ التفضيل الآن. حاول مجددًا لاحقًا.' });
  }
}

module.exports = { unsubscribeFromUpdates };
