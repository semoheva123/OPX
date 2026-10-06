const Groq = require('groq-sdk');
const dataAccess = require('../services/dataAccess');
const User = dataAccess.user;
const { getWithdrawalSchedule } = require('../services/weeklySchedule');

function localReply(message, userName, userBalance, userTier, platformFacts = {}) {
  const text = message.toLowerCase();
  if (text.includes('رصيد') || text.includes('محفظ')) return `رصيد المحفظة المتاح المسجل لحسابك هو ${Number(userBalance).toFixed(2)} USDT، ومستواك الحالي ${userTier}. راجع تفاصيل الأرصدة وسجل الحركات من صفحة الرئيسية؛ وقد تختلف الأرصدة حسب نوع الرصيد وحالته.`;
  if (text.includes('مهم') || text.includes('مهام')) return 'افتح تبويب المهام ثم اختر مهمة مدفوعة حالتها «متاحة». قد تتطلب المهام تقييمًا قبل الإنهاء، ويحدد النظام إتاحة المهام التالية وفق التسلسل وفترة الانتظار الظاهرة. لا تُحتسب أي مكافأة إلا بعد تأكيد نجاح المهمة.';
  if (text.includes('سحب')) return `موعد السحب يعتمد على مستواك والجدول الحالي: ${platformFacts.withdrawalSchedule || 'تحقق من الموعد الظاهر في صفحة السحب'}. راجع الرسوم والشروط وحالة رصيدك من صفحة المحفظة قبل إرسال الطلب.`;
  if (text.includes('إحال') || text.includes('دع') || text.includes('فريق')) return `راجع تبويب الفريق لمعرفة إحالاتك الفعلية والنشطة. إعداد المنصة الحالي يتطلب ${platformFacts.referralsPerCycle || 6} إحالات نشطة لاكتساب دورة لعبة، وتُعرض الدورات المتاحة في تبويب الألعاب.`;
  if (text.includes('ترقي') || text.includes('مستو')) return `مستواك الحالي ${userTier}. تعرض صفحة المستويات الأسعار وشروط التفعيل والترقية المحدّثة؛ اختر المستوى المطلوب لمراجعة المبلغ النهائي وطرق الدفع المتاحة لحسابك. لا توجد ضرورة لإكمال إحالات للترقية إلا إذا أظهرت شروط الميزة ذلك.`;
  if (text.includes('تواصل') || text.includes('شكوى') || text.includes('دعم') || text.includes('موظف') || text.includes('تذكرة')) return 'لإنشاء تذكرة، افتح «حسابي» من القائمة الرئيسية، ثم قسم «إعدادات المنصة والدعم» واضغط «فتح تذكرة دعم». ستظهر نافذة «مركز الدعم»: أدخل عنوان المشكلة وتفاصيلها ثم اضغط «إرسال التذكرة». وتجد تذاكرك السابقة وردود الفريق في النافذة نفسها أسفل النموذج. لا تشارك كلمة المرور أو رموز التحقق.';
  if (text.includes('استثمار') || text.includes('ابدأ') || text.includes('فوائد') || text.includes('ربح')) return 'يمكنك مراجعة تفاصيل المستوى ومبالغه والمهام وشروط الخدمة في صفحة المستويات قبل اتخاذ قرارك. المكافآت أو العوائد المعروضة تقديرية وليست مضمونة، ولا تودع إلا مبلغًا يمكنك تحمل مخاطر خسارته.';
  return `أهلاً ${userName}، أنا خدمة العملاء الذكية في OPERIX. أساعدك على فهم الحساب والمهام والمستويات والإحالات والسحب اعتمادًا على بيانات المنصة الحالية. للشكوى أو مراجعة حركة مالية، تواصل مع فريق الدعم من داخل الحساب.`;
}

function buildPlatformKnowledge(levels = [], settings = {}, userTier = '') {
  const currentLevel = levels.find(level => String(level.code).toUpperCase() === String(userTier).toUpperCase());
  const levelFacts = levels.map(level => {
    const taskLimit = Math.max(0, Number(level.tasks || 1) - 1);
    return `${level.code}: اسم=${level.name}، مبلغ المستوى=${Number(level.price || 0)} USDT، حد المهام المدفوعة=${taskLimit}، العائد اليومي المعروض=${Number(level.dailyProfit || 0)} (تقديري)`;
  }).join('؛ ') || 'بيانات المستويات غير متاحة الآن؛ لا تخمّن الأرقام';
  const withdrawalSchedule = getWithdrawalSchedule(userTier, new Date());
  return {
    levelFacts,
    currentLevelTaskLimit: currentLevel ? Math.max(0, Number(currentLevel.tasks || 1) - 1) : null,
    referralsPerCycle: Math.max(1, Number(settings.referralsPerCycle) || 6),
    withdrawalSchedule: withdrawalSchedule.message,
    withdrawalDay: withdrawalSchedule.allowedDayName,
    gameCycleRule: 'الدورات تُمنح وفق رصيد دورات الحساب وعدد الإحالات النشطة وإعداد اللعبة؛ لا تعد بمكافأة محددة قبل ظهورها في الحساب',
    taskRule: 'المهام المجتمعية اختيارية وليست مهامًا مدفوعة؛ المهام المدفوعة تتطلب أن تظهر بحالة متاحة وقد تخضع لتقييم وتسلسل وانتظار',
    upgradeRule: 'السعر وشروط التفعيل والترقية يعرضها النظام في صفحة المستويات وفي تأكيد الدفع؛ لا تفترض شرط إحالات أو إكمال مستوى سابق غير ظاهر في إعدادات الحساب',
    financialRule: 'المكافآت والعوائد تقديرية وغير مضمونة، وطلبات السحب مرتبطة بتوفر الرصيد المستحق وجدول المستوى والتحقق وسياسات الرسوم',
    supportRule: 'لإنشاء تذكرة: من القائمة الرئيسية افتح حسابي، ثم إعدادات المنصة والدعم، ثم فتح تذكرة دعم. تظهر نافذة مركز الدعم وبها حقلا عنوان المشكلة وتفاصيلها وزر إرسال التذكرة، وتعرض التذاكر السابقة أسفل النموذج. لا توجّه المستخدم إلى قسم مستقل لمركز الدعم في القائمة الرئيسية.'
  };
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
    const user = await dataAccess.user.findById(req.user.id);
    const userName = user ? String(user.email || 'المستخدم').split('@')[0] : 'المستخدم';
    const userBalance = user?.wallet?.balance || 0;
    const userTier = user?.tierCode || 'A1';
    const referrals = user?.referralCode ? await dataAccess.user.countDocuments({ referredBy: user.referralCode, isBanned: false }) : 0;
    const activeReferrals = user?.referralCode ? (await dataAccess.user.find({ referredBy: user.referralCode, isBanned: false })).filter(item => Number(item.wallet?.totalDeposits || 0) > 0).length : 0;
    const [levels, gameSettings] = await Promise.all([
      dataAccess.vipLevel.find({}, { sort: { price: 1 } }).catch(() => []),
      dataAccess.gameSetting.findOne({ key: 'default' }).catch(() => null)
    ]);
    const platformFacts = buildPlatformKnowledge(Array.isArray(levels) ? levels : [], gameSettings || req.app.locals.gameSettings || {}, userTier);
    const context = `المهام اليوم: ${user?.todayCompletedTasks || 0}، الإحالات: ${referrals}، الإحالات النشطة: ${activeReferrals}، دورات العجلة: ${user?.wheelCredits || 0}، دورات الصندوق: ${user?.mysteryBoxCredits || 0}، المصادقة الثنائية: ${user?.twoFactorEnabled ? 'مفعلة' : 'غير مفعلة'}، محفظة السحب: ${user?.walletAddress ? 'مثبتة' : 'غير مثبتة'}.`;
    const systemPrompt = `أنت «خدمة العملاء الذكية» لمنصة OPERIX. مهمتك شرح طريقة استخدام المنصة ومعلومات الحساب والخدمات الحالية باللغة العربية الواضحة والمهذبة.
  مصدر الحقيقة عن تحديثات المنصة هو بيانات المستوى والإعدادات الحية والسياق أدناه، لا معلوماتك العامة أو الإصدارات السابقة. إذا كانت معلومة غير موجودة أو متعارضة، صرّح بأنك لا تستطيع تأكيدها ووجّه المستخدم إلى الصفحة المعنية أو مركز الدعم؛ لا تخمّن ولا تعد بأن جميع معلومات المحادثة جرى تحديثها من الإنترنت.
  قواعد ثابتة: لا تضمن الأرباح أو العوائد ولا تحث على الإيداع أو الترقية. لا تدّع تشفيرًا أو ترخيصًا أو شراكة أو مراجعة معاملة ما لم يثبت ذلك في البيانات المعروضة. لا تطلب كلمة مرور أو رمز تحقق أو مفتاح محفظة. لا تعتبر المهام المجتمعية الاختيارية مهامًا مدفوعة. قل إن المهمة المدفوعة قابلة للتنفيذ فقط عندما تظهر متاحة؛ وقد تتطلب تقييمًا أو تسلسلًا وفترة انتظار. اشرح أن شروط الترقية والمبالغ النهائية تظهر في صفحة المستويات وتأكيد الدفع، ولا تخترع شروط إحالات أو إكمال مستوى. إذا طلب المستخدم الدعم، أعطه هذا المسار حرفيًا: «حسابي» في القائمة الرئيسية ← «إعدادات المنصة والدعم» ← «فتح تذكرة دعم»؛ تفتح نافذة «مركز الدعم» وفيها عنوان المشكلة وتفاصيلها وزر «إرسال التذكرة»، والتذاكر السابقة أسفل النموذج. لا تقل إن «مركز الدعم» خيار مستقل في القائمة الرئيسية.
  بيانات المستويات الحية: ${platformFacts.levelFacts}.
  قواعد المنصة الحية: ${JSON.stringify(platformFacts)}.
  بيانات العميل الحالي: الاسم ${userName}، رصيد المحفظة المعروض ${userBalance} USDT، المستوى ${userTier}. ${context}
  نمط الخدمة: ${mode === 'account' ? 'مساعدة الحساب' : mode === 'support' ? 'إرشاد خدمة العملاء وتصعيد الحالات التي تتطلب فريق الدعم' : 'معلومات المنصة'}.
  أجب بالعربية الفصحى وبشكل مباشر، اذكر الأرقام فقط إذا وردت في البيانات الحية أعلاه، ولا توحِ بأنك موظف بشري.`;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const safeHistory = Array.isArray(history) ? history.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-8).map(item => ({ ...item, content: item.content.slice(0, 2000) })) : [];
        const contextualMessage = safeHistory.length ? `سياق آخر المحادثة:\n${safeHistory.map(item => `${item.role === 'user' ? 'المستخدم' : 'المستشار'}: ${item.content}`).join('\n')}\n\nالسؤال الجديد: ${message}` : message;
        const reply = await askGemini(geminiKey.trim(), systemPrompt, contextualMessage);
        if (reply && /[\u0600-\u06ff]/.test(reply)) return res.json({ reply, source: 'assistant', suggestedAction: getSuggestedAction(message) });
      } catch (error) { console.warn('فشل الاتصال بـ Gemini، سيتم تجربة البدائل:', error.message); }
    }
    const apiKey = process.env.GROQ_API_KEY || process.env.Boostai;
    if (!apiKey) return res.json({ reply: localReply(message, userName, userBalance, userTier, platformFacts), source: 'local', suggestedAction: getSuggestedAction(message) });
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
    if (replyText) return res.json({ reply: replyText.trim(), source: 'assistant', suggestedAction: getSuggestedAction(message) });
    console.error('خطأ Groq API:', lastError);
    res.json({ reply: localReply(message, userName, userBalance, userTier, platformFacts), source: 'local', suggestedAction: getSuggestedAction(message) });
  } catch (error) {
    console.error('خطأ في مسار /api/ai/chat:', error);
    res.status(500).json({ reply: 'تعذر إعداد الإجابة الآن. حاول مجددًا، أو تواصل مع فريق الدعم من داخل حسابك.' });
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

module.exports = { chat, localReply, buildPlatformKnowledge };
