const dataAccess = require('../services/dataAccess');
const { syncGameCredits } = require('../services/gameAccess');

function splitHybridReward(amount) {
  const value = Number(amount) || 0;
  const usdtAmount = Number((value * 0.7).toFixed(4));
  const opxAmount = Number((value * 0.3).toFixed(4));
  return { usdtAmount, opxAmount };
}

function syncPlainWallet(user) {
  user.wallet = user.wallet || { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 };
  user.wallet.balance = Number((Number(user.wallet.depositBalance || 0) + Number(user.wallet.profitBalance || 0)).toFixed(2));
  user.USDT_balance = user.wallet.balance;
}

const DAILY_TASK_LIBRARY = {
  A1: [
    { title: 'تأكيد البريد', description: 'أكد بريدك الإلكتروني لتفعيل الاستلام الرسمي.', icon: 'fa-envelope-circle-check', instructions: ['افتح ملفك الشخصي.', 'اضغط على “تأكيد البريد” أو أعد إرسال رمز التأكيد.', 'راجع البريد وتأكد من النتيجة.', 'واصل المهام اليومية بعد التأكيد.'] },
    { title: 'تحقق من الأمان', description: 'فعّل الحماية الأساسية لحسابك.', icon: 'fa-shield-halved', instructions: ['ادخل إعدادات الأمان.', 'فعّل المصادقة الثنائية إذا كانت غير مفعلة.', 'راجع الجلسات الأخيرة.', 'أكد أن الحساب جاهز للعمليات الآمنة.'] },
    { title: 'محفظة السحب', description: 'ثبت عنوان المحفظة ومعلومات السحب.', icon: 'fa-wallet', instructions: ['افتح قسم الملف الشخصي.', 'أدخل عنوان محفظة السحب بشكل صحيح.', 'تأكد من الشبكة المتوافقة.', 'احفظ العنوان ثم تابع الخطة.'] },
    { title: 'توثيق الهوية', description: 'أرسل بيانات KYC لتفعيل الحساب.', icon: 'fa-id-card', instructions: ['انتقل إلى قسم التوثيق.', 'أكمل بياناتك الشخصية.', 'ارفع المستندات المطلوبة.', 'أرسل الطلب وانتظر اعتماد الإدارة.'] },
    { title: 'مراجعة الرصيد', description: 'تحقق من رصيدك وأرصدة المحفظة.', icon: 'fa-chart-line', instructions: ['افتح لوحة الحساب.', 'راجع رصيد USDT وOPX.', 'تأكد من أن المحفظة غير منعدمة.', 'سجل أي فرق في الرصيد.'] },
    { title: 'مراجعة الإشعارات', description: 'تابع الرسائل والتنبيهات الجديدة.', icon: 'fa-bell', instructions: ['افتح قسم الإشعارات.', 'راجع آخر التنبيهات.', 'تأكد من قراءة الرسائل المهمة.', 'استمر في متابعة النشاط اليومي.'] },
    { title: 'مراجعة السجل', description: 'راجع أحدث النشاط في الحساب.', icon: 'fa-clock-rotate-left', instructions: ['فتح سجل النشاط.', 'راجع آخر المعاملات.', 'تأكد من سلامة السجل.', 'إذا وجدت شيء غير مألوف، رتب معه الدعم.'] },
    { title: 'إكمال خطة اليوم', description: 'أكمل آخر خطوة في خطة المستوى اليومي.', icon: 'fa-check-double', instructions: ['راجع ما تم إنجازه اليوم.', 'انتهِ من الخطوات المتبقية.', 'اضغط على إتمام المهمة بعد التحقق.', 'استلم مكافأة اليوم مباشرة في المحفظة.'] }
  ],
  A2: [
    { title: 'مراجعة التقدم', description: 'تابع تقدمك في خطة المستوى A2', icon: 'fa-arrow-trend-up', instructions: ['قم بفتح لوحة المهام.', 'راجع التقدم الحالي.', 'حدد المهمة التالية المناسبة.', 'استمر دون تجاوز مدة المهمة.'] },
    { title: 'تحديث الهوية', description: 'راجع بيانات KYC والملف الشخصي.', icon: 'fa-id-card', instructions: ['افتح الملف الشخصي.', 'تأكد من اسمك الكامل.', 'راجع بيانات التواصل.', 'أرسل أي تحديث ضروري.'] },
    { title: 'تفعيل الدفع', description: 'راقب رصيد الإيداع والزواج في المحفظة.', icon: 'fa-wallet', instructions: ['راجع محفظة السحب.', 'تأكد من وجود USDT صالح.', 'راجع تفاصيل الإيداع.', 'استعد لإجراء الدفع أو السحب.'] },
    { title: 'إنهاء التحقق', description: 'انهِ الحفاظ على أمان الحساب.', icon: 'fa-shield-halved', instructions: ['راجع إعدادات الأمان.', 'تأكد من المصادقة الثنائية.', 'راجع الجلسات النشطة.', 'الرابع سلامة الوصول.'] },
    { title: 'أنشطة المجتمع', description: 'راجع نشاط المجتمع والرسائل.', icon: 'fa-bell', instructions: ['افتح قسم المجتمع.', 'راجع المنشورات والرسائل.', 'تابع آخر تحديثات المنصة.', 'لا تتجاهل المهمات الإعلانية.'] },
    { title: 'مراجعة الأداء', description: 'راجع تنفيذ المهام السابقة.', icon: 'fa-chart-line', instructions: ['أكمل لمحةً سريعة عن الأداء.', 'تأكد من الانجازات.', 'حدد المهمة التالية.', 'سجّل إنجازك لتجميع المكافأة.'] },
    { title: 'المشاركة', description: 'شارك أو قدم تحديثًا مطابقًا للمنصة.', icon: 'fa-share-nodes', instructions: ['افتح الإشعارات أو العمود التفاعلي.', 'تأكد من إكمال الإجراء المطلوب.', 'تحدث عن نشاطك اليومي.', 'احفظ التقدم قبل الإغلاق.'] },
    { title: 'إغلاق يومك', description: 'انتهِ من الخطة اليومية بنجاح.', icon: 'fa-check-double', instructions: ['راجع كل الخطوات.', 'حدّد أي مهمة متبقية.', 'أكملها الآن.', 'اضغط على إتمام المهمة لإغلاق اليوم.'] },
    { title: 'تجديد الرصيد', description: 'راجع نمو حسابك اليومي.', icon: 'fa-wallet', instructions: ['افتح المحفظة.', 'راجع الزيادة الأخيرة.', 'تأكد من أن المكافأة مسجلة.', 'استمر مع خطة اليوم التالية.'] },
    { title: 'تحديث التقارير', description: 'حلّل إنجازك وتقدّمك.', icon: 'fa-list-check', instructions: ['راجع التقرير اليومي.', 'حدد أولوياتك التالية.', 'تأكد من الالتزام بالخطة.', 'علّم نفسك على تقدمك.'] },
    { title: 'التنبيه الأمني', description: 'تأكد من عدم وجود نشاط غير عادي.', icon: 'fa-user-shield', instructions: ['راجِع الجلسات.', 'تأكد من سلامة الوصول.', 'إذا ظهرت أي إشارة غريبة، أبلغ الدعم.', 'اعمل على إغلاق أي ثغرة.'] },
    { title: 'إتمام المستوى', description: 'أكمل المهمة الختامية للمستوى.', icon: 'fa-check-double', instructions: ['راجع جميع المهمة.', 'استعمل آخر فرصة للإنجاز.', 'أكد أن كل الخطوات مكتملة.', 'اضغط على إتمام المهمة النهائي.'] }
  ],
  A3: [
    { title: 'أولويّة التحقق', description: 'أكد بيانات الحساب والهوية.', icon: 'fa-id-card', instructions: ['افتح قسم التوثيق.', 'راجع اسمك الكامل.', 'تأكد من أن كل المستندات صالحة.', 'أرسل الطلب إذا لزم.'] },
    { title: 'تحديث الأمان', description: 'راجع جميع إجراءات الحماية.', icon: 'fa-shield-halved', instructions: ['افتح إعدادات الأمان.', 'تأكد من التفعيل.', 'تحقق من الجلسات الحالية.', 'راجع إعدادات التوجيه.'] },
    { title: 'مراجعة المحفظة', description: 'تابع المدخلات والمخرجات في المحفظة.', icon: 'fa-wallet', instructions: ['راجع رصيدك.', 'تأكد من سحب أو إيداع مناسب.', 'تأكد من تحديث الميزان.', 'سجّل النتائج.'] },
    { title: 'تعزيز التواصل', description: 'زِد من نشاطك داخل المنصة.', icon: 'fa-bell', instructions: ['افتح الإشعارات.', 'راجع الرسائل الجديدة.', 'تابع أي تنبيه مهم.', 'تأكد من الاستجابة في الوقت المناسب.'] },
    { title: 'مراجعة الخطة', description: 'راجع الخطة وتحديد المحور التالي.', icon: 'fa-list-check', instructions: ['افتح خطة المهام.', 'التمس المهمة التالية.', 'ضبط أولوياتك.', 'حدد هدف اليوم.'] },
    { title: 'إنجازات اليوم', description: 'تابع قيمة إنجازك في اليوم.', icon: 'fa-chart-line', instructions: ['راجع رصيدك.', 'تأكد من إنجازك.', 'راقب مستويات الربح.', 'لتخطيطك القادم.'] },
    { title: 'إكمال المهمة التجارية', description: 'أكمل خطوة تشغيلية قيمة.', icon: 'fa-check-double', instructions: ['راجع المتطلبات.', 'نفّذ الخطوة بسلاسة.', 'تأكد من أن كل الشروط مؤكدة.', 'اضغط على إتمام المهمة.'] },
    { title: 'اختتام اليوم', description: 'أكمل جلسة اليوم بنجاح.', icon: 'fa-check-double', instructions: ['راجع كل الخطوات.', 'أكد أن كل شيء مكتمل.', 'اضغط على إتمام المهمة.', 'انتظر استلام المكافأة.'] }
  ],
  A4: [
    { title: 'التوثيق الاحترافي', description: 'استكمال توثيق حسابك وفق المستوى.', icon: 'fa-id-card', instructions: ['راجع المستندات.', 'تأكد من تحديث بياناتك.', 'أكمل أي مجال ناقص.', 'أرسل الملف النهائي للمراجعة.'] },
    { title: 'مراجعة السحب', description: 'تأكد من أن محفظة السحب جاهزة.', icon: 'fa-wallet', instructions: ['افتح محفظة السحب.', 'تأكد من العنوان.', 'راجع شبكة السحب.', 'ضع أي تعديل ضروري.'] },
    { title: 'إدارة الأمان', description: 'راجع أمان الحساب والاعتماد.', icon: 'fa-shield-halved', instructions: ['افتح الأمان.', 'تحقق من التفعيل.', 'تابع أي تنبيه أمني.', 'قم بإغلاق أي تلقين.'] },
    { title: 'تحليل الأداء', description: 'قيّم تقدمك اليومي.', icon: 'fa-chart-line', instructions: ['راجع النشاط.', 'احسب التقدم.', 'حدّد نقاط القوّة.', 'أعد ترتيب الأولويات.'] },
    { title: 'المهام التشغيلية', description: 'أكمل المهمة التشغيلية الرئيسية.', icon: 'fa-list-check', instructions: ['افتح الخطة.', 'اختر المهمة التالية.', 'نفّذ الطلب.', 'تأكد من إتمامه دون تأخير.'] },
    { title: 'التواصل الداخلي', description: 'راجع الإشعارات والرسائل.', icon: 'fa-bell', instructions: ['افتح الإشعارات.', 'تأكد من قراءة الرسائل.', 'راجع التحديثات.', 'أعد تفعيل أي تنبيه مهم.'] },
    { title: 'أداء اليوم', description: 'أكمل فعاليات اليوم.', icon: 'fa-check-double', instructions: ['راجع كل الخطوات.', 'حدّد الإنجاز.', 'أكمل المهمة المعلقة.', 'اضغط على إتمام المهمة.'] },
    { title: 'إغلاق المهمة', description: 'انتهِ من كل ما يلزم للإغلاق.', icon: 'fa-check-double', instructions: ['راجع التقدم.', 'تأكد من أن المهمة مكتملة.', 'أكمل آخر خطوة.', 'استلم المكافأة المخصصة.'] }
  ],
  A5: [
    { title: 'هيكلة الحساب', description: 'راعي أعلى مستويات جاهزية الحساب.', icon: 'fa-user-shield', instructions: ['افتح الملف الشخصي.', 'راجع بيانات الحساب.', 'تأكد من جاهزيتك.', 'استمر في التحديثات.'] },
    { title: 'توزيع الأمان', description: 'راجع جميع طبقات الحماية.', icon: 'fa-shield-halved', instructions: ['افتح إعدادات الأمان.', 'تأكد من التفعيل.', 'راجِع الجلسات.', 'سجّل أي تحديث.'] },
    { title: 'محفظة متقدمة', description: 'تحقق من محفظة السحب والعمليات.', icon: 'fa-wallet', instructions: ['افتح المحفظة.', 'تأكد من إعداد السحب.', 'راجع إدخالات الأموال.', 'بِّن أي متغيرات.'] },
    { title: 'رقابة الأداء', description: 'استعرض الإنجازات اليومية.', icon: 'fa-chart-line', instructions: ['راجع التقرير.', 'حدد الاكتشافات المهمة.', 'راقب التقدم.', 'استمر في الخطة.'] },
    { title: 'مهمة VIP', description: 'أكمل المهمة الهرمية المهمة.', icon: 'fa-crown', instructions: ['افتح الخطة.', 'اختَر المهمة الفعلية.', 'نفذها كاملة.', 'تأكد من صحة النتيجة.'] },
    { title: 'تنبيهات قوية', description: 'راجع التنبيهات عالية الأهمية.', icon: 'fa-bell', instructions: ['افتح الإشعارات.', 'راجع كل التنبيهات.', 'تعامل مع رسائل الدعم.', 'تأكد من المتابعة.'] },
    { title: 'إنجاز VIP', description: 'أنهِ مهمتك الفاخرة اليوم.', icon: 'fa-check-double', instructions: ['راجع all the required actions.', 'تأكد من كل الخطوة.', 'اضغط على إتمام المهمة.', 'استلم مكافأة اليوم.'] },
    { title: 'اختتام اليوم', description: 'نهاية اليوم مع مكافأة المستوى.', icon: 'fa-check-double', instructions: ['راجع ترتيب الإنجاز.', 'تأكد من اكتمال الخطة.', 'استخدم زر الإتمام.', 'تابع نقطة التقدم التالية.'] }
  ]
};

function buildDailyTasks(tierCode, taskLimit, completedKeys = new Set(), locked = false, dailyProfit = 0) {
  const library = DAILY_TASK_LIBRARY[tierCode] || DAILY_TASK_LIBRARY.A1 || [];
  const perTaskReward = Number(dailyProfit > 0 && taskLimit > 0 ? dailyProfit / taskLimit : 0);
  return Array.from({ length: taskLimit }, (_, index) => {
    const number = index + 1;
    const template = library[index] || library[Math.min(index, library.length - 1)] || {
      title: `مهمة المستوى ${tierCode}`,
      description: 'أكمل هذه المهمة المخصصة اليوم.',
      icon: 'fa-check-double',
      instructions: ['افتح المهمة.', 'راجع التعليمات.', 'انفذها بدقة.', 'اضغط على إتمام المهمة.']
    };
    const taskKey = `${tierCode}-task-${String(number).padStart(2, '0')}`;
    return {
      taskKey,
      number,
      icon: template.icon || 'fa-check-double',
      title: template.title || `مهمة ${number}`,
      description: template.description || 'أكمل هذه المهمة اليوم.',
      instructions: Array.isArray(template.instructions) ? template.instructions : ['افتح المهمة.', 'راجع التعليمات.', 'انفذها بدقة.', 'اضغط على إتمام المهمة.'],
      reward: Number(perTaskReward.toFixed(4)),
      completed: completedKeys.has(taskKey),
      locked
    };
  });
}

function getGameConfig(req, res) {
  const settings = req.app.locals.gameSettings;
  res.json({ success: true, settings: { spinMin: settings.spinMin, spinMax: settings.spinMax, boxMin: settings.boxMin, boxMax: settings.boxMax, dailyGameRewardCap: settings.dailyGameRewardCap, referralsPerCycle: settings.referralsPerCycle || 25 } });
}

async function getGameHistory(req, res) {
  try {
    const query = { userId: req.user.id, walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: { $in: ['approved', 'completed'] } };
    const history = await dataAccess.transaction.find(query, { sort: { createdAt: -1 }, limit: 20, select: 'walletAddress amount createdAt' });
    res.json({ success: true, history });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل سجل الألعاب' }); }
}

async function getGameStats(req, res) {
  try {
    const query = { userId: req.user.id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved' };
    let stats;
    const transactions = await dataAccess.transaction.find(query);
    const grouped = new Map();
    transactions.forEach(transaction => {
      const current = grouped.get(transaction.walletAddress) || { _id: transaction.walletAddress, plays: 0, total: 0, lastPlayed: null };
      current.plays += 1;
      current.total += Number(transaction.amount || 0);
      if (!current.lastPlayed || new Date(transaction.createdAt) > new Date(current.lastPlayed)) current.lastPlayed = transaction.createdAt;
      grouped.set(transaction.walletAddress, current);
    });
    stats = [...grouped.values()];
    res.json({ success: true, stats });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل إحصاءات الألعاب' }); }
}

async function getDailyTasks(req, res) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const tier = await dataAccess.vipLevel.findOne({ code: user.tierCode });
    if (!tier) return res.status(503).json({ error: 'إعدادات المستوى غير متاحة حاليًا' });
    const taskLimit = Math.max(1, Number(tier.tasks || 1));
    const today = new Date().toISOString().slice(0, 10);
    const completions = await dataAccess.dailyTaskCompletion.find({ userId: user.id, taskDate: today }, { sort: { createdAt: 1 } });
    const completedKeys = new Set(completions.map(item => item.taskKey));
    const active = Number(user.wallet?.totalDeposits || 0) > 0;
    const dailyProfit = Number(tier.dailyProfit || 0);
    return res.json({ success: true, tier: { code: tier.code, name: tier.name, taskLimit, dailyProfit }, active, completedCount: completedKeys.size, tasks: buildDailyTasks(tier.code, taskLimit, completedKeys, !active, dailyProfit) });
  } catch (error) {
    console.error('Daily task list error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل مهام اليوم' });
  }
}

async function completeTask(req, res) {
  return completeTaskSupabase(req, res);
}

async function completeTaskSupabase(req, res) {
  try {
    const taskKey = String(req.body?.taskKey || '').trim();
    if (!taskKey) return res.status(400).json({ error: 'اختر مهمة من خطة اليوم أولًا' });
    const result = await dataAccess.callSupabaseRpc('operix_daily_task_complete_atomic', { p_user_id: req.user.id, p_task_key: taskKey });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Supabase task reward error:', error.message);
    const message = String(error?.message || '');
    if (message.includes('USER_NOT_FOUND')) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (message.includes('USER_WALLET_NOT_FOUND')) return res.status(503).json({ error: 'محفظة الحساب غير جاهزة حاليًا، حاول لاحقًا' });
    if (message.includes('TIER_NOT_ACTIVE')) return res.status(400).json({ error: 'يجب إيداع قيمة المستوى وتفعيله قبل إنجاز المهام' });
    if (message.includes('VIP_LEVEL_NOT_FOUND')) return res.status(503).json({ error: 'إعدادات المستوى غير متاحة حاليًا، حاول لاحقًا' });
    if (message.includes('INVALID_TASK_KEY')) return res.status(400).json({ error: 'هذه المهمة غير صالحة لخطة مستواك الحالية' });
    if (message.includes('TASK_ALREADY_COMPLETED')) return res.status(400).json({ error: 'تم إنجاز هذه المهمة مسبقًا اليوم' });
    if (error?.code === 'PGRST202' || /operix_daily_task_complete_atomic.*does not exist/i.test(message)) return res.status(503).json({ error: 'نظام المهام يحتاج إلى تحديث قاعدة البيانات قبل الاستخدام' });
    res.status(500).json({ error: 'حدث خطأ في معالجة المهمة والمكافأة' });
  }
}

async function reward(req, res, min, max, label) {
  return rewardSupabase(req, res, min, max, label);
}

async function rewardSupabase(req, res, min, max, label) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    if (!user || !user.tierCode || !user.wallet || !(user.wallet.totalDeposits > 0)) return res.status(400).json({ error: 'تحتاج إلى 25 إحالة نشطة لفتح دورة العجلة والصندوق، مع إيداع وتفعيل مستوى الحساب' });
    const creditField = label === 'Lucky Spin Wheel' ? 'wheelCredits' : 'mysteryBoxCredits';
    if (Number(user[creditField] || 0) < 1) return res.status(400).json({ error: 'تحتاج إلى 25 إحالة نشطة لفتح دورة العجلة والصندوق، مع إيداع وتفعيل مستوى الحساب' });
    const rewardAmount = Number((Math.random() * (max - min) + min).toFixed(2));
    const split = splitHybridReward(rewardAmount);
    const history = await dataAccess.transaction.find({ userId: user.id || user._id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved', createdAt: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } });
    const dailyTotal = history.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (dailyTotal + rewardAmount > (req.app.locals.gameSettings.dailyGameRewardCap || 100)) return res.status(400).json({ error: 'تم بلوغ الحد اليومي لمكافآت الألعاب، حاول غدًا' });
    user[creditField] = Number(user[creditField]) - 1;
    user.wallet.profitBalance = Number((Number(user.wallet.profitBalance || 0) + split.usdtAmount).toFixed(4));
    user.USDT_balance = Number((Number(user.USDT_balance || 0) + split.usdtAmount).toFixed(4));
    user.OPX_balance = Number((Number(user.OPX_balance || 0) + split.opxAmount).toFixed(4));
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { [creditField]: user[creditField], wallet: user.wallet, USDT_balance: user.USDT_balance, OPX_balance: user.OPX_balance } });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'reward', amount: rewardAmount, grossAmount: rewardAmount, usdtAmount: split.usdtAmount, opxAmount: split.opxAmount, walletAddress: label, status: 'approved' });
    res.json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (error) {
    console.error('Supabase game reward error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

const spinWheel = (req, res) => reward(req, res, req.app.locals.gameSettings.spinMin ?? 1, req.app.locals.gameSettings.spinMax ?? 10, 'Lucky Spin Wheel');
const mysteryBox = (req, res) => reward(req, res, req.app.locals.gameSettings.boxMin ?? 5, req.app.locals.gameSettings.boxMax ?? 25, 'Mystery Box');

async function createStaking(req, res) {
  return createStakingSupabase(req, res);
}

async function createStakingSupabase(req, res) {
  try {
    const stakeAmount = Number(req.body.amount); const duration = Number(req.body.durationDays);
    if (!stakeAmount || stakeAmount <= 0) return res.status(400).json({ error: 'مبلغ التخزين غير صالح' });
    if (![7, 15, 30].includes(duration)) return res.status(400).json({ error: 'مدة التخزين المتاحة هي 7، 15، أو 30 يوماً فقط' });
    const profitRate = duration === 7 ? 0.05 : duration === 15 ? 0.12 : 0.30;
    const user = await dataAccess.user.findById(req.user.id);
    if (!user || Number(user.wallet?.balance || 0) < stakeAmount) return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ لإنشاء حزمة التخزين' });
    let remaining = stakeAmount;
    if (Number(user.wallet.depositBalance || 0) >= remaining) user.wallet.depositBalance -= remaining;
    else { remaining -= Number(user.wallet.depositBalance || 0); user.wallet.depositBalance = 0; user.wallet.profitBalance = Number(user.wallet.profitBalance || 0) - remaining; }
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance } });
    const staking = await dataAccess.staking.create({ userId: updatedUser.id || updatedUser._id, amount: stakeAmount, durationDays: duration, profitRate, expectedProfit: Number((stakeAmount * profitRate).toFixed(2)), endDate: new Date(Date.now() + duration * 86400000), status: 'active' });
    res.json({ success: true, message: 'تم تفعيل حزمة التخزين بنجاح', staking });
  } catch (error) {
    console.error('Supabase staking error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

async function getStakings(req, res) {
  try { res.json({ success: true, stakings: await dataAccess.staking.find({ userId: req.user.id }, { sort: { createdAt: -1 } }) }); }
  catch (err) { res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' }); }
}

async function claimStaking(req, res) {
  return claimStakingSupabase(req, res);
}

async function claimStakingSupabase(req, res) {
  try {
    const staking = await dataAccess.staking.findOne({ id: req.body.stakingId, userId: req.user.id });
    if (!staking) return res.status(404).json({ error: 'حزمة التخزين غير موجودة' });
    if (staking.status !== 'active') return res.status(400).json({ error: 'هذه الحزمة منتهية أو تم استلام أرباحها مسبقاً' });
    if (new Date() < new Date(staking.endDate)) return res.status(400).json({ error: 'لم تنتهِ مدة التخزين المحددة بعد' });
    const user = await dataAccess.user.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const release = Number(staking.amount || 0) + Number(staking.expectedProfit || 0);
    user.wallet.depositBalance = Number(user.wallet.depositBalance || 0) + Number(staking.amount || 0);
    user.wallet.profitBalance = Number(user.wallet.profitBalance || 0) + Number(staking.expectedProfit || 0);
    syncPlainWallet(user);
    const updatedUser = await dataAccess.user.updateOne({ id: user.id || user._id }, { $set: { wallet: user.wallet, USDT_balance: user.USDT_balance } });
    await dataAccess.staking.updateOne({ id: staking.id || staking._id }, { $set: { status: 'claimed' } });
    await dataAccess.transaction.create({ userId: updatedUser.id || updatedUser._id, type: 'staking_reward', amount: release, walletAddress: 'Staking Pool Reward', status: 'approved' });
    res.json({ success: true, message: 'تم استلام رأس المال والأرباح بنجاح', wallet: updatedUser.wallet });
  } catch (error) {
    console.error('Supabase staking claim error:', error.message);
    res.status(500).json({ error: 'حدث خطأ في معالجة الطلب' });
  }
}

module.exports = {
  buildDailyTasks,
  completeTask,
  getDailyTasks,
  spinWheel,
  mysteryBox,
  getGameConfig,
  getGameHistory,
  getGameStats,
  createStaking,
  getStakings,
  claimStaking
};
