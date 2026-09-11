const Groq = require('groq-sdk');
const dataAccess = require('../services/dataAccess');
const User = dataAccess.user;

function localReply(message, userName, userBalance, userTier) {
  const text = message.toLowerCase();
  if (text.includes('رصيد') || text.includes('محفظ')) return `رصيدك الحالي هو ${Number(userBalance).toFixed(2)} USDT، ومستواك الحالي ${userTier}. يمكنك مراجعة تفاصيل المحفظة من الرئيسية.`;
  if (text.includes('مهم')) return 'افتح تبويب المهام وأنجز المهام المتاحة اليوم، وسيُضاف العائد المعتمد إلى رصيد أرباحك.';
  if (text.includes('إحال') || text.includes('دع') || text.includes('فريق')) return 'راجع قسم الفريق لمتابعة الإحالات النشطة. كل 25 إحالة نشطة تفتح دورة للعجلة ودورة للصندوق.';
  if (text.includes('ترقي') || text.includes('مستو')) return `مستواك الحالي ${userTier}. الترقية التالية تتطلب إكمال المستوى السابق وتوفر الإحالات النشطة والرصيد المطلوب.`;
  if (text.includes('استثمار') || text.includes('ابدأ') || text.includes('فوائد')) return 'تستطيع استكشاف مستويات OPERIX ومقارنة السعر وعدد المهام والعائد التقديري قبل اتخاذ القرار. اختر المستوى المناسب لميزانيتك، وراجع شروط الإيداع والسحب لأن العوائد ليست مضمونة.';
  return `أهلاً ${userName}، أنا مستشارك الرسمي في منصة OPERIX. أستطيع شرح الرصيد والمهام والإحالات والمستويات ومساعدتك على اختيار الخطوة المناسبة داخل المنصة دون ضغط؛ اكتب سؤالك بشكل محدد.`;
}

async function askGemini(apiKey, systemPrompt, message) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: `${systemPrompt}\nإلزامي: أجب باللغة العربية فقط، وأجب عن السؤال كاملًا. لا تتوقف في منتصف فكرة أو جملة، وأنهِ الرد بعلامة ترقيم واضحة.` }] }, contents: [{ role: 'user', parts: [{ text: `أجب بالعربية الفصحى فقط عن السؤال التالي بإجابة مكتملة ومفيدة، ولا تتجاوز 5 جمل: ${message}` }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } }),
    signal: AbortSignal.timeout(60000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
  const candidate = data.candidates?.[0];
  const reply = candidate?.content?.parts?.map(part => part.text || '').join('').trim();
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('تم قطع الرد بسبب تجاوز الحد المسموح');
  return reply;
}

async function chat(req, res) {
  try {
    const { message, history, mode } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ reply: 'يرجى كتابة سؤالك أولاً.' });
    const user = dataAccess.isSupabaseRuntime() ? await dataAccess.user.findById(req.user.id) : await User.findById(req.user.id).select('-password');
    const userName = user ? user.email.split('@')[0] : 'المستخدم';
    const userBalance = user?.wallet?.balance || 0;
    const userTier = user?.tierCode || 'A1';
    const referrals = user?.referralCode ? (dataAccess.isSupabaseRuntime() ? await dataAccess.user.countDocuments({ referredBy: user.referralCode, isBanned: false }) : await User.countDocuments({ referredBy: user.referralCode, isBanned: false })) : 0;
    const activeReferrals = user?.referralCode ? (dataAccess.isSupabaseRuntime() ? (await dataAccess.user.find({ referredBy: user.referralCode, isBanned: false })).filter(item => Number(item.wallet?.totalDeposits || 0) > 0).length : await User.countDocuments({ referredBy: user.referralCode, isBanned: false, 'wallet.totalDeposits': { $gt: 0 } })) : 0;
    const context = `المهام اليوم: ${user?.todayCompletedTasks || 0}، الإحالات: ${referrals}، الإحالات النشطة: ${activeReferrals}، دورات العجلة: ${user?.wheelCredits || 0}، دورات الصندوق: ${user?.mysteryBoxCredits || 0}، المصادقة الثنائية: ${user?.twoFactorEnabled ? 'مفعلة' : 'غير مفعلة'}، محفظة السحب: ${user?.walletAddress ? 'مثبتة' : 'غير مثبتة'}.`;
    const cleanMessage = message.trim().toLowerCase();
    const flagKeywords = ['نصب', 'احتيال', 'سرقة', 'وهمي', 'فاشل', 'كذب', 'تزوير', 'حرام'];
    if (flagKeywords.some(word => cleanMessage.includes(word))) return res.json({ reply: `أهلاً بك يا ${userName}! جميع المعاملات في المنصة تشفر وتدار بتبعية عالية لضمان الأمان. نهدف دائماً لتوفير بيئة استثمارية آمنة ومربحة لجميع أعضائنا.` });
    const systemPrompt = `أنت "OPERIX AI Advisor"، المستشار الرسمي الذي يعمل لصالح منصة OPERIX.
  هدفك شرح المنصة ومزاياها ومساعدة المستخدم على الاستفادة من المهام والمستويات والإحالات والخدمات المتاحة داخلها، مع ترشيح خيارات المنصة عندما تكون مناسبة لسؤال المستخدم.
  تحدث بأسلوب مهني وإيجابي ومقنع وودود، لكن لا تضغط على المستخدم ولا تطلب منه استثمار مبلغ لا يستطيع تحمل خسارته.
  كن واضحًا بأن العوائد تقديرية وليست مضمونة، واذكر شروط الإيداع والسحب والترقية والمخاطر عندما تكون مرتبطة بالسؤال. لا تختلق أرقامًا أو معاملات أو شهادات مستخدمين.
  معلومات العميل الحالي: الاسم: ${userName}، الرصيد: ${userBalance}$، المستوى: ${userTier}. ${context}
  نمط المساعدة الحالي: ${mode === 'account' ? 'مساعد الحساب' : mode === 'support' ? 'الدعم الفني' : 'مساعد المنصة'}.
  أجب بإجابة مكتملة ومفيدة باللغة العربية الفصحى البسيطة، وبعدد مناسب من الجمل حسب السؤال. وجّه المستخدم إلى الخطوة المناسبة داخل المنصة دون وعود ربح مؤكدة.`;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const safeHistory = Array.isArray(history) ? history.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-8) : [];
        const contextualMessage = safeHistory.length ? `سياق آخر المحادثة:\n${safeHistory.map(item => `${item.role === 'user' ? 'المستخدم' : 'المستشار'}: ${item.content}`).join('\n')}\n\nالسؤال الجديد: ${message}` : message;
        const reply = await askGemini(geminiKey.trim(), systemPrompt, contextualMessage);
        if (reply && /[\u0600-\u06ff]/.test(reply)) return res.json({ reply, source: 'Gemini', suggestedAction: getSuggestedAction(message) });
      } catch (error) { console.warn('فشل الاتصال بـ Gemini، سيتم تجربة البدائل:', error.message); }
    }
    const apiKey = process.env.GROQ_API_KEY || process.env.Boostai;
    if (!apiKey) return res.json({ reply: `${localReply(message, userName, userBalance, userTier)} (الوضع المحلي مفعل حاليًا)`, source: 'local', suggestedAction: getSuggestedAction(message) });
    const groq = new Groq({ apiKey: apiKey.trim() });
    let replyText;
    let lastError;
    for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
      try {
        const completion = await groq.chat.completions.create({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }], model, temperature: 0.7, max_tokens: 1024, top_p: 1 });
        replyText = completion.choices[0]?.message?.content;
        if (replyText && /[\u0600-\u06ff]/.test(replyText)) break;
        replyText = null;
      } catch (error) { lastError = error; console.warn(`فشل الاتصال بالنموذج ${model}:`, error.message); }
    }
    if (replyText) return res.json({ reply: replyText.trim(), source: 'Groq', suggestedAction: getSuggestedAction(message) });
    console.error('خطأ Groq API:', lastError);
    res.json({ reply: `${localReply(message, userName, userBalance, userTier)} (تعذر الاتصال بالنموذج الخارجي)`, source: 'local', suggestedAction: getSuggestedAction(message) });
  } catch (error) {
    console.error('خطأ في مسار /api/ai/chat:', error);
    res.status(500).json({ reply: 'حدث خطأ غير متوقع أثناء الاتصال بالمستشار الذكي.' });
  }
}

function getSuggestedAction(message) {
  const text = message.toLowerCase();
  if (text.includes('مستو') || text.includes('ترقي')) return { label: 'فتح المستويات', tab: 'tiers' };
  if (text.includes('فريق') || text.includes('إحال') || text.includes('دع')) return { label: 'فتح الفريق', tab: 'team' };
  if (text.includes('مهم')) return { label: 'فتح المهام', tab: 'travel' };
  if (text.includes('رصيد') || text.includes('سحب') || text.includes('إيداع')) return { label: 'فتح المحفظة', tab: 'home' };
  return null;
}

module.exports = { chat };
