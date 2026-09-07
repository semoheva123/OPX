const SocialPost = require('../models/SocialPost');
const AuditLog = require('../models/AuditLog');
const { moderateText } = require('../services/socialSafetyBot');

const topics = [
  'أمان المحافظ الرقمية والمصادقة الثنائية',
  'قراءة شروط السحب والرسوم قبل تنفيذ أي طلب',
  'إدارة السيولة وعدم استخدام أموال لا يستطيع المستخدم تحمل خسارتها',
  'مراجعة سجل المعاملات ومصادر الإعلانات الرسمية داخل المنصة'
];

async function generateOfficialAiPost() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const existing = await SocialPost.exists({ source: 'ai_generated', createdAt: { $gte: dayStart } });
  if (existing) return { skipped: true, reason: 'daily_post_exists' };

  const topic = topics[Math.floor(Math.random() * topics.length)];
  const prompt = `اكتب منشوراً تعليمياً عربياً قصيراً من 2 إلى 4 جمل عن ${topic} لجمهور منصة OPERIX. هذا إعلان رسمي مولد بمساعدة الذكاء الاصطناعي، وليس شهادة مستخدم. لا تعد بأرباح، ولا تذكر عوائد مضمونة، ولا تطلب إيداعاً، ولا تخترع أرقاماً أو أخباراً. اختم بتذكير أن المستخدم يراجع الشروط والمخاطر بنفسه.`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 260 } }) });
  const data = await response.json();
  const generatedText = String(data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  if (!response.ok || !generatedText) throw new Error(data.error?.message || 'Gemini returned no content');
  const moderation = moderateText(generatedText);
  if (!moderation.allowed) {
    await AuditLog.create({ action: 'ai_post_blocked', details: { source: 'ai_generated', matchedWord: moderation.matchedWord, text: generatedText } });
    return { skipped: true, reason: 'banned_word', matchedWord: moderation.matchedWord };
  }
  const post = await SocialPost.create({ authorId: null, authorLabel: '🤖 محتوى رسمي من OPERIX AI', content: generatedText, isOfficialAi: true, source: 'ai_generated', status: 'visible' });
  await AuditLog.create({ action: 'ai_post_published', targetId: String(post._id), details: { source: 'ai_generated', topic } });
  return { skipped: false, postId: post._id };
}

module.exports = { generateOfficialAiPost };