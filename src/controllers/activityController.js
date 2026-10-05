const dataAccess = require('../services/dataAccess');
const { syncGameCredits } = require('../services/gameAccess');
const { hasPaidFeatureAccess, hasFullFeatureAccess } = require('../services/paidFeatureAccess');
const { calculateDailyTaskRewardSplit } = require('../services/opxPricing');
const { assignDailyEvaluationEntities, getEvaluationTags, getCategoryLabel, getOfficialBrandLogoUrl, utcDateString } = require('../services/dailyTaskAutomation');

const DAILY_TASK_COOLDOWN_MS = 3 * 60 * 60 * 1000;

function getDailyTaskProgress(tierCode, taskLimit, completions = [], now = Date.now()) {
  const completedByKey = new Map((Array.isArray(completions) ? completions : []).map(item => [String(item.taskKey || ''), item]));
  const getTaskKey = number => number === 1 ? `${tierCode}-community` : `${tierCode}-task-${String(number).padStart(2, '0')}`;
  let nextTaskNumber = 1;
  while (nextTaskNumber <= taskLimit && completedByKey.has(getTaskKey(nextTaskNumber))) nextTaskNumber++;
  if (nextTaskNumber > taskLimit) return { nextTaskNumber: null, availableAt: null, remainingMs: 0, remainingSeconds: 0 };

  const previousCompletion = nextTaskNumber > 1 ? completedByKey.get(getTaskKey(nextTaskNumber - 1)) : null;
  const previousCompletedAt = previousCompletion ? new Date(previousCompletion.createdAt).getTime() : Number(now);
  const availableAtMs = previousCompletion
    ? (Number.isFinite(previousCompletedAt) ? previousCompletedAt : Number(now)) + DAILY_TASK_COOLDOWN_MS
    : Number(now);
  const remainingMs = Math.max(0, availableAtMs - Number(now));
  return {
    nextTaskNumber,
    availableAt: new Date(availableAtMs).toISOString(),
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000)
  };
}

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
    { title: 'مراجعة الجلسات', description: 'تحقق من الأجهزة المسجلة في حسابك.', icon: 'fa-shield-halved', instructions: ['افتح إعدادات الأمان.', 'راجع الجلسات النشطة.', 'أنه الجلسات التي لا تعرفها.', 'أبلغ الدعم عن أي نشاط غير مألوف.'] },
    { title: 'مراجعة الرصيد', description: 'تحقق من رصيدك وأرصدة المحفظة.', icon: 'fa-chart-line', instructions: ['افتح لوحة الحساب.', 'راجع رصيد USDT وOPX.', 'تأكد من أن المحفظة غير منعدمة.', 'سجل أي فرق في الرصيد.'] },
    { title: 'مراجعة الإشعارات', description: 'تابع الرسائل والتنبيهات الجديدة.', icon: 'fa-bell', instructions: ['افتح قسم الإشعارات.', 'راجع آخر التنبيهات.', 'تأكد من قراءة الرسائل المهمة.', 'استمر في متابعة النشاط اليومي.'] },
    { title: 'مراجعة السجل', description: 'راجع أحدث النشاط في الحساب.', icon: 'fa-clock-rotate-left', instructions: ['فتح سجل النشاط.', 'راجع آخر المعاملات.', 'تأكد من سلامة السجل.', 'إذا وجدت شيء غير مألوف، رتب معه الدعم.'] },
    { title: 'إكمال خطة اليوم', description: 'أكمل آخر خطوة في خطة المستوى اليومي.', icon: 'fa-check-double', instructions: ['راجع ما تم إنجازه اليوم.', 'انتهِ من الخطوات المتبقية.', 'اضغط على إتمام المهمة بعد التحقق.', 'استلم مكافأة اليوم مباشرة في المحفظة.'] }
  ],
  A2: [
    { title: 'مراجعة التقدم', description: 'تابع تقدمك في خطة المستوى A2', icon: 'fa-arrow-trend-up', instructions: ['قم بفتح لوحة المهام.', 'راجع التقدم الحالي.', 'حدد المهمة التالية المناسبة.', 'استمر دون تجاوز مدة المهمة.'] },
    { title: 'مراجعة إعدادات الحساب', description: 'تأكد من دقة إعدادات حسابك الأساسية.', icon: 'fa-user-gear', instructions: ['افتح الملف الشخصي.', 'راجع البريد وإعدادات الأمان.', 'تحقق من عنوان محفظة السحب.', 'احفظ أي تعديل مطلوب.'] },
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
    { title: 'أولوية الأمان', description: 'راجع وسائل حماية الحساب.', icon: 'fa-user-shield', instructions: ['افتح إعدادات الأمان.', 'تحقق من المصادقة الثنائية.', 'راجع الجلسات النشطة.', 'حدّث كلمة المرور عند الحاجة.'] },
    { title: 'تحديث الأمان', description: 'راجع جميع إجراءات الحماية.', icon: 'fa-shield-halved', instructions: ['افتح إعدادات الأمان.', 'تأكد من التفعيل.', 'تحقق من الجلسات الحالية.', 'راجع إعدادات التوجيه.'] },
    { title: 'مراجعة المحفظة', description: 'تابع المدخلات والمخرجات في المحفظة.', icon: 'fa-wallet', instructions: ['راجع رصيدك.', 'تأكد من سحب أو إيداع مناسب.', 'تأكد من تحديث الميزان.', 'سجّل النتائج.'] },
    { title: 'تعزيز التواصل', description: 'زِد من نشاطك داخل المنصة.', icon: 'fa-bell', instructions: ['افتح الإشعارات.', 'راجع الرسائل الجديدة.', 'تابع أي تنبيه مهم.', 'تأكد من الاستجابة في الوقت المناسب.'] },
    { title: 'مراجعة الخطة', description: 'راجع الخطة وتحديد المحور التالي.', icon: 'fa-list-check', instructions: ['افتح خطة المهام.', 'التمس المهمة التالية.', 'ضبط أولوياتك.', 'حدد هدف اليوم.'] },
    { title: 'إنجازات اليوم', description: 'تابع قيمة إنجازك في اليوم.', icon: 'fa-chart-line', instructions: ['راجع رصيدك.', 'تأكد من إنجازك.', 'راقب مستويات الربح.', 'لتخطيطك القادم.'] },
    { title: 'إكمال المهمة التجارية', description: 'أكمل خطوة تشغيلية قيمة.', icon: 'fa-check-double', instructions: ['راجع المتطلبات.', 'نفّذ الخطوة بسلاسة.', 'تأكد من أن كل الشروط مؤكدة.', 'اضغط على إتمام المهمة.'] },
    { title: 'اختتام اليوم', description: 'أكمل جلسة اليوم بنجاح.', icon: 'fa-check-double', instructions: ['راجع كل الخطوات.', 'أكد أن كل شيء مكتمل.', 'اضغط على إتمام المهمة.', 'انتظر استلام المكافأة.'] }
  ],
  A4: [
    { title: 'مراجعة تقدمك', description: 'راجع مستوى إنجازك وخطتك اليومية.', icon: 'fa-chart-line', instructions: ['افتح لوحة المهام.', 'راجع المهام المكتملة.', 'تحقق من سجل المكافآت.', 'حدد أولوياتك لليوم التالي.'] },
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

const SUPPLEMENTAL_TASK_FOCUS = {
  A1: ['إعداد الملف الشخصي', 'توثيق البريد', 'المصادقة الثنائية', 'محفظة السحب', 'الشبكة المختارة', 'الجلسات النشطة', 'الإشعارات الجديدة', 'سجل العمليات', 'خطة اليوم', 'حالة الحساب'],
  A2: ['تقرير التقدم', 'رصيد المحفظة', 'سجل الإيداعات', 'عنوان السحب', 'مراجعة الأمان', 'المهام المكتملة', 'الإحالات المباشرة', 'الإشعارات', 'سجل المكافآت', 'خطة المستوى'],
  A3: ['تحليل الأداء', 'حركة المحفظة', 'سجل المعاملات', 'حماية الحساب', 'نشاط الفريق', 'تقدم المهام', 'مكافآت الإحالات', 'التنبيهات الأمنية', 'العمليات الأخيرة', 'أهداف اليوم'],
  A4: ['مؤشرات الأداء', 'تدقيق المحفظة', 'مراجعة السحب', 'أمان الجلسات', 'تحليل الفريق', 'جودة إنجاز المهام', 'سجل المكافآت', 'طلبات الدعم', 'التقارير اليومية', 'أولويات المستوى'],
  A5: ['مؤشرات VIP', 'تحليل الأداء المتقدم', 'تدقيق الأرصدة', 'مراجعة العمليات', 'أمان الحساب المتقدم', 'تقدم شبكة الفريق', 'جودة خطة المهام', 'التقارير المالية', 'التنبيهات المهمة', 'خطة التطوير']
};

const SUPPLEMENTAL_TASK_ACTIONS = [
  { label: 'تحقق', description: 'تحقق من البيانات والحالة الحالية.', instructions: ['افتح القسم المرتبط بالمحور.', 'راجع البيانات والحالة الظاهرة.', 'تحقق من وجود أي عنصر يحتاج متابعة.', 'سجّل النتيجة وأكمل الخطوة.'] },
  { label: 'راجع', description: 'راجع آخر التحديثات والعناصر المعلقة.', instructions: ['افتح القسم المرتبط بالمحور.', 'راجع أحدث التحديثات.', 'حدّد العناصر التي تتطلب إجراءً.', 'أكمل المراجعة وسجّل النتيجة.'] },
  { label: 'حلل', description: 'حلل النتائج الأخيرة وحدد خطوة متابعة مناسبة.', instructions: ['افتح بيانات المحور.', 'قارن النتائج المتاحة.', 'حدّد ملاحظة أو نمطًا مهمًا.', 'اختر خطوة متابعة مناسبة.'] },
  { label: 'تابع', description: 'تابع الحالة الحالية وتأكد من عدم وجود إجراء متأخر.', instructions: ['افتح القسم المرتبط بالمحور.', 'تحقق من الحالة وآخر نشاط.', 'عالج الإجراء المعلق إن وجد.', 'تأكد من اكتمال المتابعة.'] },
  { label: 'حدّث', description: 'تأكد من حداثة المعلومات والإعدادات المرتبطة.', instructions: ['افتح الإعداد أو السجل المناسب.', 'راجع المعلومات الحالية.', 'حدّث ما يحتاج إلى تصحيح فقط.', 'تحقق من حفظ التغييرات.'] }
];

const COMMUNITY_DAILY_TASK = {
  taskKeySuffix: 'community',
  requirement: 'community_engagement',
  title: 'شارك وتفاعل في مجتمع OPERIX',
  description: 'انشر منشورًا أصليًا عن OPERIX، ثم أضف تعليقًا مفيدًا إلى منشور ظاهر لعضو آخر.',
  icon: 'fa-users',
  instructions: ['افتح تبويب المجتمع.', 'انشر منشورًا أصليًا يذكر OPERIX أو أوبيريكس.', 'أضف تعليقًا مفيدًا إلى منشور ظاهر لعضو آخر اليوم.', 'ارجع إلى المهام وأكملها بعد تنفيذ الإجراءين.']
};

function hasDailyPlatformPost(posts, userId, dayStart) {
  const startTime = new Date(dayStart).getTime();
  return (Array.isArray(posts) ? posts : []).some(post =>
    String(post.authorId || '') === String(userId) &&
    post.status === 'visible' &&
    new Date(post.createdAt).getTime() >= startTime &&
    /operix|أوبيريكس/i.test(String(post.content || ''))
  );
}

function hasDailyCommunityInteraction(posts, userId, dayStart) {
  const startTime = new Date(dayStart).getTime();
  return (Array.isArray(posts) ? posts : []).some(post =>
    post.status === 'visible' && String(post.authorId || '') !== String(userId) &&
    (Array.isArray(post.comments) ? post.comments : []).some(comment =>
      String(comment.authorId || '') === String(userId) &&
      comment.status === 'visible' &&
      new Date(comment.createdAt).getTime() >= startTime
    )
  );
}

function buildSupplementalTask(tierCode, number, supplementalIndex) {
  const focusAreas = SUPPLEMENTAL_TASK_FOCUS[tierCode] || SUPPLEMENTAL_TASK_FOCUS.A1;
  const focus = focusAreas[supplementalIndex % focusAreas.length];
  const action = SUPPLEMENTAL_TASK_ACTIONS[Math.floor(supplementalIndex / focusAreas.length) % SUPPLEMENTAL_TASK_ACTIONS.length];
  return {
    title: `${action.label} ${focus} · ${number}`,
    description: `${action.description} محور ${focus} ضمن خطة المستوى ${tierCode}.`,
    icon: 'fa-list-check',
    instructions: action.instructions.map(instruction => `${instruction} (${focus})`)
  };
}

function buildDailyTasks(tierCode, adminTasks = [], completedKeys = new Set(), locked = false, dailyProfit = 0, communityTaskStatus = {}) {
  const taskLimit = 1 + (Array.isArray(adminTasks) ? adminTasks.length : 0);
  const categoryWeights = {
    technology: 0.95,
    ai: 1.35,
    crypto: 1.45,
    trading: 1.55,
    finance: 1.25,
    community: 1.00
  };
  const weights = Array.from({ length: taskLimit }, (_, index) => {
    const number = index + 1;
    const isCommunityTask = number === 1;
    const configuredTask = isCommunityTask ? COMMUNITY_DAILY_TASK : adminTasks[index - 1];
    const categoryKey = String((configuredTask && configuredTask.category) || 'technology').toLowerCase();
    const categoryWeight = isCommunityTask ? 1.0 : (categoryWeights[categoryKey] || 1.0);
    const seedText = isCommunityTask ? `${tierCode}-community` : String(configuredTask.entityName || configuredTask.entityKey || `${tierCode}-${number}`);
    let seedValue = 0;
    for (let i = 0; i < seedText.length; i++) seedValue += seedText.charCodeAt(i) * (i + 1);
    const companyBoost = (seedValue % 7) * 0.08;
    return Math.max(0.35, categoryWeight + companyBoost);
  });

  const totalWeight = weights.reduce((sum, weight) => sum + Number(weight || 0), 0) || taskLimit;
  let rewardTotal = 0;
  const rewards = weights.map((weight, index) => {
    const taskReward = Number(((Number(dailyProfit || 0) * (Number(weight || 0) / totalWeight))).toFixed(4));
    rewardTotal += taskReward;
    return taskReward;
  });
  const adjustment = Number((Number(dailyProfit || 0) - rewardTotal).toFixed(4));
  if (rewards.length) rewards[rewards.length - 1] = Number((rewards[rewards.length - 1] + adjustment).toFixed(4));

  return Array.from({ length: taskLimit }, (_, index) => {
    const number = index + 1;
    const isCommunityTask = number === 1;
    const configuredTask = isCommunityTask ? COMMUNITY_DAILY_TASK : adminTasks[index - 1];
    const template = configuredTask || {};
    const taskKey = isCommunityTask ? `${tierCode}-${COMMUNITY_DAILY_TASK.taskKeySuffix}` : `${tierCode}-task-${String(number).padStart(2, '0')}`;
    return {
      taskKey,
      number,
      icon: isCommunityTask ? COMMUNITY_DAILY_TASK.icon : 'fa-magnifying-glass-chart',
      title: isCommunityTask ? COMMUNITY_DAILY_TASK.title : `قيّم ${String(template.entityName || 'الجهة المحددة')}`,
      description: isCommunityTask ? COMMUNITY_DAILY_TASK.description : String(template.summary || 'قدّم تقييمًا متوازنًا استنادًا إلى المعلومات المعروضة داخل المنصة.'),
      instructions: isCommunityTask ? COMMUNITY_DAILY_TASK.instructions : (Array.isArray(template.instructions) ? template.instructions : []),
      requirement: isCommunityTask ? COMMUNITY_DAILY_TASK.requirement : 'evaluation',
      targetCategory: isCommunityTask ? null : String(template.category || 'technology'),
      targetCategoryLabel: isCommunityTask ? null : getCategoryLabel(template.category),
      targetName: isCommunityTask ? null : String(template.entityName || ''),
      targetSummary: isCommunityTask ? null : String(template.summary || ''),
      targetImageUrl: isCommunityTask ? '' : getOfficialBrandLogoUrl(template.entityName) || String(template.imageUrl || ''),
      entityKey: isCommunityTask ? null : String(template.entityKey || ''),
      tags: isCommunityTask ? [] : getEvaluationTags(template.category),
      requirementMet: isCommunityTask ? Boolean(communityTaskStatus.communityEngagement) : Boolean(template.submissionComplete),
      reward: Number((rewards[index] ?? 0).toFixed(4)),
      completed: completedKeys.has(taskKey),
      locked
    };
  });
}

function getGameConfig(req, res) {
  const settings = req.app.locals.gameSettings;
  res.json({ success: true, settings: { spinMin: settings.spinMin, spinMax: settings.spinMax, boxMin: settings.boxMin, boxMax: settings.boxMax, dailyGameRewardCap: settings.dailyGameRewardCap, referralsPerCycle: settings.referralsPerCycle || 6 } });
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
    const today = utcDateString();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const taskLimit = Math.max(1, Math.min(50, Number(tier.tasks || 1)));
    const evaluationAssignments = await assignDailyEvaluationEntities({
      userId: user.id || user._id,
      tierCode: tier.code,
      totalTaskCount: taskLimit,
      date: today
    });
    const [todayUserPosts, otherMembersPosts] = await Promise.all([
      dataAccess.socialPost.find({ authorId: user.id, status: 'visible', createdAt: { $gte: todayStart } }, { select: 'authorId content status createdAt', limit: 100 }),
      dataAccess.socialPost.find({ authorId: { $ne: user.id }, status: 'visible' }, { select: 'authorId comments likedBy status', sort: { createdAt: -1 }, limit: 1000 })
    ]);
    const communityTaskStatus = {
      communityPost: hasDailyPlatformPost(todayUserPosts, user.id, todayStart),
      communityInteraction: hasDailyCommunityInteraction(otherMembersPosts, user.id, todayStart)
    };
    const [evaluationSubmissions, completions] = await Promise.all([
      dataAccess.dailyTaskSubmission.find({ userId: user.id, taskDate: today }, { select: 'taskKey' }),
      dataAccess.dailyTaskCompletion.find({ userId: user.id, taskDate: today }, { sort: { createdAt: 1 } })
    ]);
    const submittedTaskKeys = new Set(evaluationSubmissions.map(submission => submission.taskKey));
    evaluationAssignments.forEach(assignment => { assignment.submissionComplete = submittedTaskKeys.has(`${tier.code}-task-${String(assignment.taskNumber).padStart(2, '0')}`); });
    const completedKeys = new Set(completions.map(item => item.taskKey));
    const active = hasPaidFeatureAccess(user) || Number(user.wallet?.totalDeposits || 0) > 0;
    const dailyProfit = Number(tier.dailyProfit || 0);
    const progress = getDailyTaskProgress(tier.code, taskLimit, completions, Date.now());
    const allTasks = buildDailyTasks(tier.code, evaluationAssignments, completedKeys, !active, dailyProfit, { communityEngagement: communityTaskStatus.communityPost && communityTaskStatus.communityInteraction });
    const nextTask = allTasks.find(task => task.number === progress.nextTaskNumber);
    const tasks = nextTask ? [{
      ...nextTask,
      availableAt: progress.availableAt,
      cooldownRemainingSeconds: progress.remainingSeconds,
      locked: !active || progress.remainingMs > 0,
      lockReason: !active ? 'tier_inactive' : progress.remainingMs > 0 ? 'cooldown' : null
    }] : [];
    return res.json({ success: true, tier: { code: tier.code, name: tier.name, taskLimit, dailyProfit }, active, completedCount: completedKeys.size, tasks });
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
    if (message.includes('TASK_SEQUENCE_REQUIRED')) return res.status(409).json({ error: 'أكمل المهمة السابقة أولًا لفتح المهمة التالية.' });
    if (message.includes('TASK_COOLDOWN_ACTIVE')) return res.status(429).json({ error: 'ستُفتح المهمة التالية بعد مرور 3 ساعات على إكمال المهمة السابقة.' });
    if (message.includes('DAILY_CAP_REACHED')) return res.status(400).json({ error: 'تم بلوغ الحد اليومي للربح، ولا يمكن جمع أكثر من الربح اليومي الثابت.' });
    if (message.includes('COMMUNITY_TASK_REQUIRED')) return res.status(400).json({ error: 'أكمل أولًا نشر منشور عن OPERIX والتفاعل مع منشور عضو آخر في المجتمع اليوم.' });
    if (message.includes('EVALUATION_REQUIRED')) return res.status(400).json({ error: 'اختر التقييم بالنجوم وحدد جانب التقييم قبل إنهاء المهمة.' });
    if (error?.code === 'PGRST202' || /operix_daily_task_complete_atomic.*does not exist/i.test(message)) return res.status(503).json({ error: 'نظام المهام يحتاج إلى تحديث قاعدة البيانات قبل الاستخدام' });
    res.status(500).json({ error: 'حدث خطأ في معالجة المهمة والمكافأة' });
  }
}

async function submitDailyEvaluation(req, res) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    if (!user || !user.tierCode) return res.status(404).json({ error: 'المستخدم أو المستوى غير موجود' });
    const tier = await dataAccess.vipLevel.findOne({ code: user.tierCode });
    if (!tier) return res.status(503).json({ error: 'إعدادات المستوى غير متاحة حاليًا' });
    if (!hasPaidFeatureAccess(user) && Number(user.wallet?.totalDeposits || 0) <= 0) return res.status(400).json({ error: 'يجب تفعيل المستوى أولًا' });

    const taskKey = String(req.body?.taskKey || '').trim();
    const match = taskKey.match(new RegExp(`^${String(tier.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-task-(\\d+)$`));
    const taskNumber = match ? Number(match[1]) : 0;
    const today = utcDateString();
    const assignment = taskNumber >= 2 ? await dataAccess.dailyTaskAssignment.findOne({ userId: user.id || user._id, tierCode: tier.code, taskDate: today, taskNumber }) : null;
    if (!assignment) return res.status(400).json({ error: 'مهمة التقييم غير موجودة ضمن خطة اليوم الحالية' });

    const completions = await dataAccess.dailyTaskCompletion.find({ userId: user.id || user._id, taskDate: today }, { sort: { createdAt: 1 } });
    const progress = getDailyTaskProgress(tier.code, Math.max(1, Number(tier.tasks || 1)), completions, Date.now());
    if (taskNumber !== progress.nextTaskNumber) return res.status(409).json({ error: 'أكمل المهمة السابقة أولًا لفتح هذه المهمة.' });
    if (progress.remainingMs > 0) return res.status(429).json({ error: 'ستُفتح المهمة التالية بعد مرور 3 ساعات على إكمال المهمة السابقة.', unlockAt: progress.availableAt });

    const rating = Number(req.body?.rating);
    const selectedTag = String(req.body?.selectedTag || '').trim();
    const allowedTags = getEvaluationTags(assignment.category);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !allowedTags.includes(selectedTag)) {
      return res.status(400).json({ error: 'اختر تقييمًا من نجمة إلى خمس نجوم وحدد جانب التقييم.' });
    }

    const completion = await dataAccess.dailyTaskCompletion.findOne({ userId: user.id, taskKey, taskDate: today });
    if (completion) return res.status(409).json({ error: 'تم إنهاء هذه المهمة اليوم مسبقًا' });
    const submission = {
      userId: user.id || user._id,
      taskKey,
      taskDate: today,
      assignmentId: assignment.id || assignment._id,
      entityKey: assignment.entityKey,
      targetCategory: assignment.category,
      targetName: assignment.entityName,
      rating,
      selectedTag,
      feedback: '',
      strengths: '',
      concerns: '',
      evidenceUrl: 'in-app-daily-entity-review'
    };
    const existingSubmission = await dataAccess.dailyTaskSubmission.findOne({ userId: user.id, taskKey, taskDate: today });
    if (existingSubmission) await dataAccess.dailyTaskSubmission.updateOne({ id: existingSubmission.id || existingSubmission._id }, submission);
    else await dataAccess.dailyTaskSubmission.create(submission);

    const result = await dataAccess.callSupabaseRpc('operix_daily_task_complete_atomic', { p_user_id: req.user.id, p_task_key: taskKey });
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = String(error?.message || '');
    console.error('Daily evaluation submission error:', message);
    if (message.includes('EVALUATION_REQUIRED')) return res.status(400).json({ error: 'اختر التقييم بالنجوم وحدد جانب التقييم قبل إنهاء المهمة.' });
    if (message.includes('TASK_ALREADY_COMPLETED')) return res.status(409).json({ error: 'تم إنهاء هذه المهمة اليوم مسبقًا' });
    if (message.includes('TASK_SEQUENCE_REQUIRED')) return res.status(409).json({ error: 'أكمل المهمة السابقة أولًا لفتح المهمة التالية.' });
    if (message.includes('TASK_COOLDOWN_ACTIVE')) return res.status(429).json({ error: 'ستُفتح المهمة التالية بعد مرور 3 ساعات على إكمال المهمة السابقة.' });
    if (message.includes('DAILY_CAP_REACHED')) return res.status(400).json({ error: 'تم بلوغ الحد اليومي للربح، ولا يمكن جمع أكثر من الربح اليومي الثابت.' });
    if (error?.code === 'PGRST202' || /operix_daily_task_complete_atomic.*does not exist/i.test(message)) return res.status(503).json({ error: 'قاعدة البيانات تحتاج إلى تحديث نظام مهام التقييم.' });
    res.status(500).json({ error: 'تعذر حفظ التقييم وإنهاء المهمة' });
  }
}

async function reward(req, res, min, max, label) {
  return rewardSupabase(req, res, min, max, label);
}

async function rewardSupabase(req, res, min, max, label) {
  try {
    const user = await dataAccess.user.findById(req.user.id);
    const paidFeatureAccess = hasPaidFeatureAccess(user);
    const referralsPerCycle = Math.max(1, Number(req.app.locals.gameSettings?.referralsPerCycle) || 6);
    const cycleRequirementMessage = `تحتاج إلى ${referralsPerCycle} إحالات نشطة لفتح دورة العجلة والصندوق، مع إيداع وتفعيل مستوى الحساب`;
    if (!user || !user.tierCode || !user.wallet || (!paidFeatureAccess && !(user.wallet.totalDeposits > 0))) return res.status(400).json({ error: cycleRequirementMessage });
    const creditField = label === 'Lucky Spin Wheel' ? 'wheelCredits' : 'mysteryBoxCredits';
    if (!paidFeatureAccess && Number(user[creditField] || 0) < 1) return res.status(400).json({ error: cycleRequirementMessage });
    const rewardAmount = Number((Math.random() * (max - min) + min).toFixed(2));
    const split = splitHybridReward(rewardAmount);
    const history = await dataAccess.transaction.find({ userId: user.id || user._id, type: 'reward', walletAddress: { $in: ['Lucky Spin Wheel', 'Mystery Box'] }, status: 'approved', createdAt: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } });
    const dailyTotal = history.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (dailyTotal + rewardAmount > (req.app.locals.gameSettings.dailyGameRewardCap || 100)) return res.status(400).json({ error: 'تم بلوغ الحد اليومي لمكافآت الألعاب، حاول غدًا' });
    if (!paidFeatureAccess) user[creditField] = Number(user[creditField]) - 1;
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
    const user = await dataAccess.user.findById(req.user.id);
    if (!hasFullFeatureAccess(user) && ![7, 15, 30].includes(duration)) return res.status(400).json({ error: 'مدة التخزين المتاحة هي 7، 15، أو 30 يوماً فقط' });
    const profitRate = duration === 7 ? 0.05 : duration === 15 ? 0.12 : 0.30;
    if (!user || (!hasFullFeatureAccess(user) && Number(user.wallet?.balance || 0) < stakeAmount)) return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ لإنشاء حزمة التخزين' });
    let remaining = stakeAmount;
    if (!hasFullFeatureAccess(user)) {
      if (Number(user.wallet.depositBalance || 0) >= remaining) user.wallet.depositBalance -= remaining;
      else { remaining -= Number(user.wallet.depositBalance || 0); user.wallet.depositBalance = 0; user.wallet.profitBalance = Number(user.wallet.profitBalance || 0) - remaining; }
    }
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
  getDailyTaskProgress,
  hasDailyPlatformPost,
  hasDailyCommunityInteraction,
  completeTask,
  submitDailyEvaluation,
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
