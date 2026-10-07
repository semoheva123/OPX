const Groq = require('groq-sdk');
const dataAccess = require('../services/dataAccess');
const User = dataAccess.user;
const { getWithdrawalSchedule } = require('../services/weeklySchedule');
const { OPX_INTERNAL_USD_PRICE, OPX_MAX_UPGRADE_DISCOUNT_SHARE, OPX_MAX_UPGRADE_VALUE_USD, getTierDailyOpxConversion } = require('../services/opxPricing');
const withdrawalPayoutService = require('../services/withdrawalPayoutService');

function localReply(message, userName, userBalance, userTier, platformFacts = {}) {
  const text = normalizeSupportText(message);
  const has = (...terms) => terms.some(term => text.includes(normalizeSupportText(term)));
  const account = platformFacts.account || {};
  const tickets = 'من تبويب «حسابي» ← «إعدادات المنصة والدعم» ← «فتح تذكرة دعم». اكتب عنوانًا واضحًا وتفاصيل المشكلة ثم اضغط «إرسال التذكرة»؛ وتظهر تذاكرك السابقة وردود الفريق وحالة كل تذكرة في النافذة نفسها. لا ترسل كلمة المرور أو رمز 2FA أو المفتاح الخاص للمحفظة.';
  const transactionStatus = { approved: 'معتمدة', completed: 'مكتملة', pending: 'قيد المعالجة', rejected: 'مرفوضة', processing: 'قيد المعالجة' };
  const vaultStatus = { active: 'مجمّدة', matured: 'مستحقة للاسترداد', claimed: 'تم استردادها', closed: 'منتهية' };

  if (has('شكوى', 'موظف', 'تذكرة', 'الدعم', 'دعم فني', 'اتواصل', 'اتصال بالدعم')) return tickets;
  if (has('ايداع', 'ايداعات', 'deposit', 'تحويل الى المنصة', 'لم يصل الايداع', 'الايداع معلق')) {
    const problem = has('مشكلة', 'لم يصل', 'ما وصل', 'متاخر', 'معلق', 'خطا', 'تعذر');
    if (platformFacts.depositAutomationEnabled === false) return `الإيداع الآلي غير مفعّل حاليًا، لذلك لا ترسل أي أموال ولا تستخدم عنوانًا قديمًا. راجع حالة الخدمة لاحقًا أو افتح تذكرة دعم من «حسابي»؛ أرفق وقت المحاولة ورقم المعاملة العام فقط، ولا تشارك مفاتيحك الخاصة.${problem ? ' إذا سبق أن أرسلت تحويلًا، لا تكرره قبل مراجعة الدعم.' : ''}`;
    return `الإيداع المدعوم هو USDT عبر TRON (TRC20) إلى العنوان الشخصي الذي يظهر في نافذة «إيداع» من الرئيسية؛ تتم مطابقة التحويل آليًا بعد تأكيد الشبكة ولا يوجد إدخال يدوي لـ TxHash. ${problem ? 'افتح سجل المعاملات وانتظر تأكيد الشبكة؛ تحقّق من الشبكة والعنوان والمبلغ، ولا تكرر التحويل. إذا لم يظهر بعد التأكيد، افتح تذكرة دعم وأرسل TxHash العام ووقت التحويل.' : 'تأكد من تطابق الشبكة والعنوان الظاهرين في حسابك قبل الإرسال؛ لا تستخدم عنوانًا من حساب آخر.'}`;
  }
  if (has('سحب', 'اسحب', 'withdraw', 'رسوم السحب', 'لم يصل السحب', 'السحب معلق')) {
    const problem = has('مشكلة', 'لم يصل', 'ما وصل', 'متاخر', 'معلق', 'مرفوض', 'خطا', 'تعذر');
    const fee = platformFacts.withdrawalFee || 'تظهر الرسوم والمبلغ الصافي قبل التأكيد';
    const payoutState = platformFacts.withdrawalAutomationEnabled === false ? 'تنفيذ الدفع الآلي غير مفعّل بحسب الإعداد الحالي؛ لا تعتبر الطلب مدفوعًا حتى تتغير حالته في السجل.' : 'يبقى الطلب قيد المراجعة حتى تتغير حالته في السجل.';
    return `السحب بعملة USDT وعلى TRC20 فقط، ويُخصم من رصيد الأرباح المتاح لا من رصيد الإيداع أو OPX. الحد الأدنى ${platformFacts.withdrawalMinimum || 20} USDT والرسوم الحالية ${fee}؛ وموعد مستوى ${userTier}: ${platformFacts.withdrawalSchedule || 'اعتمد الموعد المعروض في نافذة السحب'}. يلزم توثيق البريد وتفعيل 2FA وتطابق عنوان TRC20 المثبت؛ ${payoutState} راجع سجل المعاملات قبل إعادة المحاولة.${problem ? ' إذا ظل معلقًا أو رُفض، أرسل رقم المعاملة وحالتها للدعم ولا تنشئ طلبًا مكررًا.' : ''}`;
  }
  if (has('معاملة', 'معاملاتي', 'العمليات الاخيرة', 'حالة الطلب', 'حاله الطلب', 'سجل المعاملات')) {
    const recent = Array.isArray(account.recentTransactions) ? account.recentTransactions : [];
    if (!recent.length) return 'لا توجد عمليات إيداع أو سحب حديثة ضمن البيانات المحمّلة لهذا الحساب. افتح «السجل» من الرئيسية للتأكد؛ إذا كنت تتوقع عملية غير موجودة، أرسل للدعم وقتها ورقمها العام.';
    const details = recent.map(item => `${item.type === 'deposit' ? 'إيداع' : 'سحب'} ${Number(item.amount || 0).toFixed(2)} USDT: ${transactionStatus[item.status] || item.status || 'الحالة غير محددة'}`).join('؛ ');
    return `أحدث عمليات الإيداع/السحب المسجلة لحسابك: ${details}. هذه بيانات سجل الحساب وليست تأكيدًا إضافيًا خارج الحالة الظاهرة؛ راجع تبويب الرئيسية ← «السجل» للتفاصيل الكاملة. إذا كان status «قيد المعالجة» فلا تنشئ طلبًا مكررًا.`;
  }
  if (has('خزنة', 'الخزنة', 'تجميد', 'استحقاق', 'vault', 'فك التجميد')) {
    const contracts = platformFacts.vaultContractFacts || 'العقود ومددها ونسبها تظهر مباشرة في تبويب «الخزنة»';
    const problem = has('مشكلة', 'لا استطيع', 'ما اقدر', 'لم استطع', 'خطا', 'تعذر', 'استرداد');
    const vaults = Array.isArray(account.recentVaults) ? account.recentVaults : [];
    const vaultSummary = vaults.length ? ` خزائنك الأخيرة: ${vaults.map(item => `${vaultStatus[item.status] || item.status || 'حالة غير محددة'} بقيمة ${Number(item.amount || 0).toFixed(2)} USDT${item.maturityDate ? `، الاستحقاق ${new Date(item.maturityDate).toLocaleDateString('ar')}` : ''}`).join('؛ ')}.` : ' لا توجد خزائن حديثة ضمن البيانات المحمّلة.';
    return `تبويب «الخزنة» يعرض USDT المتاح للتجميد، العقد ومدته، الحافز المتوقع، والخزائن القائمة وموعد الاستحقاق. الحد الأدنى الحالي ${platformFacts.vaultMinimum || 10} USDT؛ لا يمكن الاسترداد قبل تاريخ الاستحقاق، ويتم الاسترداد من زر الخزنة المستحقة. العقود المتاحة الآن: ${contracts}.${vaultSummary} ${problem ? 'إذا وصل تاريخ الاستحقاق ولم يظهر زر الاسترداد، حدّث الصفحة وافتح تذكرة مع معرّف الخزنة وحالتها.' : 'راجع شروط العقد الفعّال قبل التأكيد؛ الأرقام المعروضة لا تعني ضمانًا خارج شروط ذلك العقد.'}`;
  }
  if (has('مهمة', 'المهام', 'التقييم', 'مهمات', 'task')) {
    const problem = has('مشكلة', 'لا استطيع', 'ما اقدر', 'غير متاح', 'تعذر', 'خطا', 'لم يحفظ', 'لم تكتمل');
    return `في تبويب «المهام» تظهر مهام التقييم المدفوعة للمستوى ${userTier}، بحد يومي ${platformFacts.currentLevelTaskLimit ?? 'الموضح في الشاشة'}؛ وعدّ المهام المدفوعة يطابق عدد مهام المستوى فعليًا بدون إضافة مهمة مجتمع. افتح المهمة المتاحة، قيّمها من 1 إلى 5 واختر جانب التقييم ثم أرسل؛ المهمة المجتمعية غير موجودة في المسار المدفوع. الخطة تتجدد عند بداية اليوم في Europe/Istanbul، وتتوقف الجمعة والسبت، وتفتح المهام المدفوعة بفاصل ساعتين مع اشتراط إنهاء المهمة السابقة قبل التالية. ${problem ? 'عند فشل الحفظ لا ترسل تقييمًا مكررًا فورًا: حدّث قائمة المهام، راجع سجل الرصيد والإنجاز، ثم أرسل للدعم نص الخطأ ومفتاح المهمة والوقت.' : 'تأكد من ظهور الحالة «متاحة»؛ لا تُعد المهمة مكتملة حتى يؤكد النظام نجاح الإنهاء وتظهر المكافأة في الرصيد والسجل.'}`;
  }
  if (has('لعبة', 'العاب', 'العاب', 'عجلة', 'الصندوق', 'صندوق', 'دورة', 'spin', 'game')) {
    const gameRanges = platformFacts.gameRewardRanges || 'نطاق المكافأة وإعدادات الدورة تظهر في تبويب «الألعاب»';
    const problem = has('مشكلة', 'لا تعمل', 'لا استطيع', 'ما اقدر', 'خطا', 'لم تظهر');
    const cycleRequirement = account.paidFeatureAccess ? 'حسابك لديه صلاحية وصول خاصة؛ اعتمد عدد الدورات الظاهر بجانب اللعبة' : `تتطلب الدورة ${platformFacts.referralsPerCycle || 6} إحالات نشطة مع تفعيل الحساب/المستوى`;
    return `تبويب «الألعاب» يحتوي عجلة الحظ والصندوق المجهول وسجل المكافآت والإحصاءات. ${cycleRequirement}؛ عدد الدورات المتاح لحسابك هو ${account.wheelCredits ?? 'المعروض بجانب اللعبة'} للعجلة و${account.mysteryBoxCredits ?? 'المعروض بجانب اللعبة'} للصندوق. نطاقات المكافآت الحالية: ${gameRanges}، ويُوزع إجمالي مكافأة اللعب 70% USDT و30% OPX حسب الإعداد الحالي. لا يوجد ضمان لمكافأة بعينها، وتخضع المكافآت للسقف اليومي الظاهر بالإعدادات.${problem ? ' إذا كانت لديك دورة والزر لا يعمل، تأكد من حالة المستوى والحد اليومي ثم حدّث الحساب؛ أرسل رسالة الخطأ للدعم.' : ''}`;
  }
  if (has('فريق', 'احالة', 'احالات', 'دعوة', 'دعوات', 'رابط الدعوة', 'referral', 'نقاط الحملة', 'مكافأة إحالة', 'مكافآت إحالة')) {
    const problem = has('مشكلة', 'لم تصل', 'لم تظهر', 'خطا', 'ناقص');
    return `تبويب «الفريق» يعرض كود/رابط الدعوة، الإحالات المباشرة ومستويات الشبكة حتى 3 مستويات، النشط وغير النشط، مكافآت الإحالات وتقدم إنجاز A4. المكافأة النقدية تُسجل عند تفعيل مدفوع مؤهل للإحالة المباشرة: ${platformFacts.referralCashRewards || '$1 للمستوى A1، $2 لـA2، و$5 لـA3'} مرة واحدة لكل مستوى؛ ونقاط الحملة مختلفة: ${platformFacts.referralCampaignPoints || '1 و2 و4 نقاط للمستويات 1 و2 و3'}. إنجاز A4 المجاني يتطلب 300 إحالة مباشرة نشطة، ويضيف $100 إلى رصيد الأرباح وفق أهلية النظام.${problem ? ' افتح سجل المكافآت وانتظر تسجيل التفعيل؛ إذا كان التفعيل مدفوعًا ومؤكدًا ولم تظهر المكافأة، أرسل كود الإحالة ومعرّف الحساب للدعم.' : ''}`;
  }
  if (has('مستوى', 'مستويات', 'ترقية', 'تفعيل', 'vip', 'tier')) {
    const problem = has('مشكلة', 'رفض', 'لا استطيع', 'ما اقدر', 'خطا', 'تعذر', 'لم يتم');
    return `مستواك الحالي ${userTier}. تبويب «المستويات» يعرض سعر كل مستوى وعدد المهام والعائد التقديري وسجل الترقيات؛ الأسعار الحالية: ${platformFacts.levelFacts}. التفعيل الأول المدفوع يتطلب سعر المستوى كاملًا، وبعد التفعيل تُحسب الترقية بفرق السعر؛ لا يشترط إحالات عادةً إلا إنجاز A4 المجاني. استخدام OPX للترقية محدود بحد ${Math.round(OPX_MAX_UPGRADE_DISCOUNT_SHARE * 100)}% أو ${OPX_MAX_UPGRADE_VALUE_USD} USDT كحد أقصى، وفق الأقل، والباقي USDT؛ راجع مبلغ التأكيد قبل الدفع. ${problem ? 'إذا رُفضت العملية، لا تكررها قبل مراجعة سجل المعاملات والرصيد؛ أرسل رسالة الرفض للدعم.' : 'العوائد تقديرية وغير مضمونة، وOPX الداخلي ليس قابلًا للسحب.'}`;
  }
  if (has('مكافاة', 'مكافآت', 'مكافأة', 'المكافآت', 'المكافاة', 'ارباح', 'ربح', 'عائد', 'مبلغ', 'reward', 'نقاط')) {
    const problem = has('مشكلة', 'لم تصل', 'لم تضاف', 'ناقص', 'خطا', 'مفقودة');
    return `المكافآت تظهر في تبويب الرئيسية ضمن الرصيد وسجل المعاملات، ويمكن مراجعة مكافآت الإحالات في تبويب الفريق. مكافآت المهام تعتمد على المستوى والمهام التي أكد النظام إكمالها؛ مكافآت الألعاب تخضع للنطاق والسقف اليومي، والإحالات للمستوى المدفوع المؤهل. أرصدة USDT وOPX منفصلة، وOPX مخصص للترقيات ولا يُسحب. ${problem ? 'راجع حالة العملية وسجل المعاملات وحدّث الحساب؛ لا تعتبر العملية مكتملة قبل ظهورها هناك. إذا بقي الفرق، أرسل معرّف العملية والوقت للدعم.' : 'كل العوائد تقديرية وغير مضمونة ما لم تنص شروط عقد فعّال على غير ذلك.'}`;
  }
  if (has('حسابي', 'الملف الشخصي', 'البريد', 'اسم المستخدم', 'كلمة المرور', '2fa', 'مصادقة', 'جلسة', 'محفظتي', 'رصيد', 'محفظة')) {
    const balance = Number(userBalance || 0).toFixed(2);
    const problem = has('مشكلة', 'صفر', 'لا يظهر', 'لم يظهر', 'خطا', 'نسي', 'لا استطيع');
    const securityAdvice = has('2fa', 'مصادقة')
      ? account.twoFactorEnabled ? 'المصادقة الثنائية مفعلة في حسابك. إذا فقدت الوصول للمُصدّق، لا ترسل الرموز؛ تواصل عبر تذكرة دعم موثقة.' : 'لتفعيل 2FA افتح «حسابي» ← «إعدادات الأمان» ← المصادقة الثنائية، امسح QR في تطبيق المصادقة ثم أدخل الرمز الحالي للتأكيد.'
      : 'لحماية الحساب وثّق البريد، فعّل 2FA وثبّت عنوان TRC20؛ لا تشارك كلمة المرور أو رموز التحقق أو المفتاح الخاص.';
    return `في «حسابي» تجد الملف الاجتماعي، إعداد المحفظة، أمان الحساب، البريد، 2FA والجلسات وتذكرة الدعم؛ اسم المستخدم هو بريد الحساب. رصيدك الإجمالي الظاهر ${balance} USDT (إيداع ${Number(account.depositBalance || 0).toFixed(2)}، أرباح ${Number(account.profitBalance || 0).toFixed(2)}) ورصيد OPX ${Number(account.opxBalance || 0).toFixed(4)}؛ ومستواك ${userTier}. ${problem ? 'إذا ظهر رصيد صفرًا أو بيانات قديمة، حدّث الرئيسية ثم افتح سجل المعاملات؛ لا ترسل بيانات الدخول. إذا استمر الفرق أرسل لقطة شاشة ووقت المشكلة للدعم.' : securityAdvice}`;
  }
  if (has('مجتمع', 'منشور', 'تعليق', 'رسالة خاصة', 'متابعة', 'feed', 'هاشتاغ')) return 'تبويب «المجتمع» يتيح تصفح المنشورات، النشر والتعليق والتفاعل والمتابعة والرسائل الخاصة. اكتب منشورًا مناسبًا، ويمكن إرفاق صورة ضمن حد الحجم الظاهر؛ للإبلاغ عن محتوى أو مشكلة مراسلة، استخدم أدوات المحتوى أو افتح تذكرة من «حسابي». لا تنشر بيانات مالية أو أسرار حسابك.';
  if (has('مشكلة', 'خطا', 'تعذر', 'لا يعمل', 'لا تعمل', 'لا استطيع', 'ما اقدر', 'لم يظهر', 'لم تظهر')) return `لحل المشكلة: حدّث الصفحة، تأكد من الاتصال، ثم افتح التبويب المعني وراجع حالة العنصر وسجل المعاملات؛ لا تكرر أي عملية مالية قبل التحقق من نتيجتها. أرسل للدعم اسم التبويب، نص الخطأ، وقت حدوثه، ومعرّف العملية إن وجد عبر ${tickets}`;
  if (has('كيف ابدا', 'كيف أبدأ', 'ابدأ', 'ما هي التبويبات', 'التبويبات', 'كل التبويبات', 'ماذا تقدم')) return `تجد في OPERIX: الرئيسية للأرصدة والنشاط؛ المجتمع للنشر والرسائل؛ المستويات للتفعيل والترقية؛ الخزنة لتجميد USDT؛ المهام للتقييمات المدفوعة؛ الألعاب للعجلة والصندوق؛ الفريق للإحالات والمكافآت؛ «حسابي» للأمان والمحفظة والدعم؛ وهذا التبويب لخدمة العملاء. ${platformFacts.generalRiskRule || 'العوائد والمكافآت تقديرية وغير مضمونة؛ راجع شروط كل عملية قبل التأكيد.'}`;
  return `أهلًا ${userName}. أستطيع إرشادك في الرئيسية، المجتمع، المستويات، الخزنة، المهام، الألعاب، الفريق، حسابي والإيداع والسحب، بالاعتماد على قواعد OPERIX الحالية. اذكر اسم التبويب أو نص الخطأ لأعطيك خطوات أدق؛ وللمعاملة غير الظاهرة استخدم سجل الحساب ثم تذكرة الدعم، ولا تشارك كلمات المرور أو رموز التحقق.`;
}

function normalizeSupportText(value) {
  return String(value || '').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
}

function buildPlatformKnowledge(levels = [], settings = {}, userTier = '', vaultContracts = [], account = {}) {
  const currentLevel = levels.find(level => String(level.code).toUpperCase() === String(userTier).toUpperCase());
  const levelFacts = levels.map(level => {
    const taskLimit = Math.max(0, Number(level.tasks || 1));
    const dailyOpx = getTierDailyOpxConversion(level.code);
    return `${level.code}: الاسم=${level.name}؛ السعر=${Number(level.price || 0)} USDT؛ المهام المدفوعة يوميًا=${taskLimit}؛ العائد اليومي المعروض=${Number(level.dailyProfit || 0)} USDT (تقديري)؛ توزيع OPX اليومي=${dailyOpx} USDT قيمة داخلية`;
  }).join('؛ ') || 'بيانات المستويات غير متاحة الآن؛ لا تخمّن الأرقام';
  const withdrawalSchedule = getWithdrawalSchedule(userTier, new Date());
  const safeContracts = Array.isArray(vaultContracts) ? vaultContracts.filter(contract => contract && contract.enabled !== false) : [];
  const vaultContractFacts = safeContracts.length
    ? safeContracts.map(contract => `${Number(contract.durationDays)} يوم، نسبة الحافز ${Number(contract.expectedReturnRate || 0)}%`).join('؛ ')
    : 'لا توجد عقود فعالة مؤكدة الآن؛ راجع القائمة المباشرة في تبويب الخزنة ولا تخمّن النسب';
  let withdrawalMax = 5000;
  try { withdrawalMax = withdrawalPayoutService.getMaxPayoutAmount(); } catch { withdrawalMax = null; }
  return {
    levelFacts,
    currentLevelTaskLimit: currentLevel ? Math.max(0, Number(currentLevel.tasks || 1)) : null,
    referralsPerCycle: Math.max(1, Number(settings.referralsPerCycle) || 6),
    withdrawalSchedule: withdrawalSchedule.message,
    withdrawalDay: withdrawalSchedule.allowedDayName,
    gameRewardRanges: `العجلة ${Number(settings.spinMin ?? 1)}–${Number(settings.spinMax ?? 10)}؛ الصندوق ${Number(settings.boxMin ?? 5)}–${Number(settings.boxMax ?? 25)} USDT إجماليًا قبل التوزيع`,
    gameDailyRewardCap: Number(settings.dailyGameRewardCap || 100),
    vaultMinimum: 10,
    vaultContractFacts,
    withdrawalMinimum: 20,
    withdrawalMaximum: withdrawalMax,
    withdrawalFee: `5% من المبلغ + 2 USDT؛ الحد الأدنى 20 USDT؛ الحد الأعلى العام الحالي ${withdrawalMax ?? 'غير متاح'} USDT إضافة إلى سقف المستوى/الأسبوع`,
    withdrawalAutomationEnabled: String(process.env.WITHDRAWAL_PAYOUTS_ENABLED || '').toLowerCase() === 'true',
    depositAutomationEnabled: String(process.env.TRON_DEPOSIT_AUTOMATION_ENABLED || '').toLowerCase() === 'true',
    referralCashRewards: '$1 لتفعيل إحالة مباشرة في A1، $2 في A2، و$5 في A3؛ مكافأة واحدة لكل مستوى مؤهل',
    referralCampaignPoints: 'نقطة واحدة لتفعيل مباشر في A1، نقطتان في A2، و4 نقاط في A3؛ النقاط لا تساوي مبلغ المكافأة النقدية',
    a4ReferralMilestone: '300 إحالة مباشرة نشطة مؤهلة لفتح تفعيل A4 المجاني مع مكافأة $100 في رصيد الأرباح، مرة واحدة وفق أهلية الحساب',
    taskRule: 'حد المهام المدفوعة اليومي يساوي قيمة tasks في إعداد المستوى فعليًا؛ المهام التقييمية تتطلب تقييم 1–5 واختيار جانب مسموح؛ التقييم يُسجل ثم يجري إنهاء ذري للمهمة والمكافأة، ولا تعرض المنصة مراجعة بشرية لكل تقييم؛ يشترط تسلسل إنهاء المهام المدفوعة وفاصل ساعتين بين ظهورها؛ اليوم يبدأ وفق Europe/Istanbul؛ الجمعة والسبت عطلة مهام؛ لا توجد مهمة مجتمعية مدفوعة في المسار الحالي',
    gameCycleRule: `تتطلب دورة اللعبة ${Math.max(1, Number(settings.referralsPerCycle) || 6)} إحالات مباشرة نشطة مع تفعيل الحساب، ويخصم الاستخدام دورة؛ الأرصدة المتاحة تظهر بجوار اللعبة؛ الحد اليومي ${Number(settings.dailyGameRewardCap || 100)} USDT؛ مكافأة اللعب توزع حاليًا 70% USDT و30% OPX`,
    upgradeRule: `السعر وشروط التفعيل والترقية تظهر في تبويب المستويات والتأكيد؛ أول تفعيل مدفوع يكلف سعر المستوى كاملًا، ثم تحسب الترقية بفرق السعر؛ لا يشترط تسلسل مستويات أو إحالات للترقية العادية؛ تفعيل A4 المجاني يتطلب الإنجاز المؤهل؛ OPX الداخلي بسعر حساب الترقية ${OPX_INTERNAL_USD_PRICE} USDT لكل OPX ويغطي بحد أقصى ${Math.round(OPX_MAX_UPGRADE_DISCOUNT_SHARE * 100)}% أو ${OPX_MAX_UPGRADE_VALUE_USD} USDT أيهما أقل، والباقي USDT؛ OPX غير قابل للسحب`,
    depositRule: String(process.env.TRON_DEPOSIT_AUTOMATION_ENABLED || '').toLowerCase() === 'true'
      ? 'USDT فقط على TRON (TRC20) عبر عنوان آلي شخصي من الرئيسية؛ لا يوجد إدخال يدوي لـTxHash؛ لا ترسل قبل التأكد من أن العنوان ظاهر ومتاح في حسابك.'
      : 'الإيداع الآلي TRC20 غير مفعّل حاليًا؛ يجب ألا يُطلب من المستخدم إرسال أموال أو استعمال عنوان قديم، ويُوجّه إلى حالة الخدمة والدعم.',
    withdrawalRule: `USDT فقط على TRC20؛ المصدر رصيد الأرباح المتاح؛ الحد الأدنى 20 USDT؛ الرسوم 5% + 2 USDT؛ موعد ${userTier}: ${withdrawalSchedule.message}; يتطلب بريدًا موثقًا و2FA وعنوانًا مثبتًا مطابقًا، ويظهر الطلب في السجل وقد يبقى قيد المراجعة.`,
    tabGuides: {
      home: 'الرئيسية: الرصيد الإجمالي وتفصيل USDT (إيداع/أرباح) وOPX، التقدم اليومي، نشاط الحساب، سجل زمني، تحديث السوق الخارجي OPXUSD من Bitfinex. سعر السوق ليس سعرًا داخليًا ولا عائدًا أو توصية.',
      community: 'المجتمع: موجز كل المنشورات أو المتابَعين، نشر نص وصورة، إعجاب وتعليق ومتابعة ملفات اجتماعية ورسائل خاصة؛ المحتوى يخضع للإشراف.',
      tiers: 'المستويات: الأسعار والمهام والعوائد التقديرية، مراجعة كلفة التفعيل/الترقية وسجل الترقيات. اقرأ مبلغ الدفع النهائي قبل التأكيد.',
      vault: `الخزنة: عقود تجميد USDT، الحد الأدنى 10، مدتها ونسبة الحافز حسب العقد الفعال، ملخص المجمد والاستحقاق، والاسترداد بعد الاستحقاق فقط. العقود الحالية: ${vaultContractFacts}.`,
      tasks: 'المهام: مهام تقييم شركات/منتجات تظهر حسب مستوى الحساب؛ فتح بطاقة المهمة، قراءة بيانات العنصر، اختيار تقييم ووسم، ثم إرسال. يوجد انتظار ساعتين وتسلسل إكمال؛ مهام المجتمع اختيارية وليست مدفوعة.',
      games: 'الألعاب: عجلة الحظ والصندوق المجهول، رصيد الدورات، نطاق الجوائز، سجل اللعب وإحصاءات المستخدم.',
      team: 'الفريق: رابط وكود الدعوة، مستويات الشبكة الثلاثة، النشط وغير النشط، مكافآت مباشرة وتقدم 300 إحالة لـA4.',
      profile: 'حسابي: البريد واسم المستخدم المطابق له، ملف اجتماعي، صورة، رصيد/أرباح/إيداع/سحوبات/OPX، عنوان سحب TRC20 المثبت، 2FA، توثيق البريد، تغيير كلمة المرور والجلسات، تذاكر الدعم وإعداد اللغة.',
      customerService: 'خدمة العملاء: أسئلة المنصة والحساب وحلول أولية؛ الشكوى أو الفروقات المالية أو المعاملات العالقة تصعّد بتذكرة من حسابي ثم إعدادات المنصة والدعم ثم فتح تذكرة دعم.'
    },
    account,
    generalRiskRule: 'المكافآت والعوائد تقديرية وغير مضمونة إلا الحافز الذي ينص عليه عقد خزنة فعال وضمن شروطه؛ لا تودع مالًا لا تتحمل مخاطر فقده.'
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
    const userId = user?.id || user?._id || req.user.id;
    const [levels, gameSettings, vaultContracts, recentTransactions, recentVaults] = await Promise.all([
      dataAccess.vipLevel.find({}, { sort: { price: 1 } }).catch(() => []),
      dataAccess.gameSetting.findOne({ key: 'default' }).catch(() => null),
      dataAccess.investmentVaultContract.find({ enabled: true }, { sort: { durationDays: 1 }, limit: 20 }).catch(() => []),
      dataAccess.transaction.find({ userId, type: { $in: ['deposit', 'withdraw'] } }, { sort: { createdAt: -1 }, limit: 5, select: 'type amount feeAmount netAmount status network createdAt' }).catch(() => []),
      dataAccess.investmentVault.find({ userId }, { sort: { createdAt: -1 }, limit: 5, select: 'status amount durationDays maturityDate expectedReturnRate incentiveAmount' }).catch(() => [])
    ]);
    const wallet = user?.wallet || {};
    const account = {
      usdtBalance: Number(wallet.balance ?? user?.USDT_balance ?? 0),
      depositBalance: Number(wallet.depositBalance || 0),
      profitBalance: Number(wallet.profitBalance || 0),
      opxBalance: Number(wallet.OPX_balance ?? user?.OPX_balance ?? 0),
      tierActive: Boolean(user?.isTierActivated || Number(wallet.totalDeposits || 0) > 0 || String(user?.email || '').toLowerCase() === 'official@operix.website'),
      paidFeatureAccess: String(user?.email || '').toLowerCase() === 'official@operix.website',
      emailVerified: Boolean(user?.emailVerified),
      twoFactorEnabled: Boolean(user?.twoFactorEnabled),
      withdrawalWalletSet: Boolean(String(user?.walletAddress || '').trim()),
      todayCompletedTasks: Number(user?.todayCompletedTasks || 0),
      referrals,
      activeReferrals,
      wheelCredits: Number(user?.wheelCredits || 0),
      mysteryBoxCredits: Number(user?.mysteryBoxCredits || 0),
      recentTransactions: (recentTransactions || []).map(item => ({ type: item.type, status: item.status, amount: Number(item.amount || 0), feeAmount: Number(item.feeAmount || 0), netAmount: Number(item.netAmount || 0), network: item.network || '', createdAt: item.createdAt })),
      recentVaults: (recentVaults || []).map(item => ({ status: item.status, amount: Number(item.amount || 0), durationDays: Number(item.durationDays || 0), maturityDate: item.maturityDate, expectedReturnRate: Number(item.expectedReturnRate || 0), incentiveAmount: Number(item.incentiveAmount || 0) }))
    };
    const platformFacts = buildPlatformKnowledge(Array.isArray(levels) ? levels : [], gameSettings || req.app.locals.gameSettings || {}, userTier, vaultContracts, account);
    const context = `المهام اليوم: ${user?.todayCompletedTasks || 0}، الإحالات: ${referrals}، الإحالات النشطة: ${activeReferrals}، دورات العجلة: ${user?.wheelCredits || 0}، دورات الصندوق: ${user?.mysteryBoxCredits || 0}، المصادقة الثنائية: ${user?.twoFactorEnabled ? 'مفعلة' : 'غير مفعلة'}، محفظة السحب: ${user?.walletAddress ? 'مثبتة' : 'غير مثبتة'}.`;
    const safeHistory = Array.isArray(history) ? history.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-8).map(item => ({ role: item.role, content: item.content.slice(0, 2000) })) : [];
    const systemPrompt = `أنت «خدمة العملاء الذكية» لمنصة OPERIX. مهمتك شرح طريقة استخدام المنصة ومعلومات الحساب والخدمات الحالية باللغة العربية الواضحة والمهذبة.
  مصدر الحقيقة عن تحديثات المنصة هو بيانات المستوى والإعدادات الحية والسياق أدناه، لا معلوماتك العامة أو الإصدارات السابقة. إذا كانت معلومة غير موجودة أو متعارضة، صرّح بأنك لا تستطيع تأكيدها ووجّه المستخدم إلى الصفحة المعنية أو مركز الدعم؛ لا تخمّن ولا تعد بأن جميع معلومات المحادثة جرى تحديثها من الإنترنت.
  قواعد ثابتة: لا تضمن الأرباح أو العوائد ولا تحث على الإيداع أو الترقية. لا تدّع تشفيرًا أو ترخيصًا أو شراكة أو مراجعة بشرية للمهام أو معاملة ما لم يثبت ذلك. لا تطلب كلمة مرور أو رمز تحقق أو مفتاح محفظة. لا تعتبر المهام المجتمعية الاختيارية مهامًا مدفوعة. لا تقل إن المهمة اكتملت أو أن المال وصل إلا إذا ظهر ذلك في بيانات الحساب. إذا كانت خدمة الإيداع الآلي غير مفعلة، حذّر بوضوح من إرسال المال. فرّق بين المكافآت النقدية ونقاط الحملة. عند مشكلة مالية، اطلب مراجعة السجل ولا تشجع على تكرار العملية، ثم صعّد بتذكرة عند الحاجة. عند طلب الدعم اذكر هذا المسار حرفيًا: «حسابي» ← «إعدادات المنصة والدعم» ← «فتح تذكرة دعم»؛ أدخل عنوانًا وتفاصيل وتابع التذكرة في النافذة نفسها. لا تقل إن مركز الدعم تبويب مستقل.
  دليل كل تبويب: ${JSON.stringify(platformFacts.tabGuides)}.
  بيانات المستويات الحية: ${platformFacts.levelFacts}.
  قواعد المنصة الحية: ${JSON.stringify(platformFacts)}.
  ملخص بيانات العميل الحالي الآمن: ${JSON.stringify(account)}. ${context}
  أحدث معاملات وخزائن العميل المملوكة له واردة فقط في البيانات أعلاه؛ لا تكشف بيانات مستخدم آخر.
  نمط الخدمة: ${mode === 'account' ? 'مساعدة الحساب' : mode === 'support' ? 'إرشاد خدمة العملاء وتصعيد الحالات التي تتطلب فريق الدعم' : 'معلومات المنصة'}.
  أجب بالعربية الفصحى مباشرة وبخطوات عملية تناسب السؤال؛ اذكر الأرقام فقط إذا وردت في البيانات الحية أعلاه، ولا توحِ بأنك موظف بشري أو تستطيع تنفيذ عملية مالية.`;
    const contextualMessage = safeHistory.length
      ? `سياق المحادثة الأخيرة:\n${safeHistory.map(item => `${item.role === 'user' ? 'المستخدم' : 'المستشار'}: ${item.content}`).join('\n')}\n\nالسؤال الجديد: ${message}`
      : message;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
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
        const completion = await groq.chat.completions.create({ messages: [{ role: 'system', content: systemPrompt }, ...safeHistory, { role: 'user', content: message }], model, temperature: 0.4, max_tokens: 1500, top_p: 1 });
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
  const text = normalizeSupportText(message);
  if (['خزنه', 'تجميد', 'استحقاق', 'vault'].some(term => text.includes(term))) return { label: 'فتح الخزنة', tab: 'vault' };
  if (['لعبه', 'العاب', 'عجله', 'صندوق', 'دوره', 'spin', 'game'].some(term => text.includes(term))) return { label: 'فتح الألعاب', tab: 'spin' };
  if (['مجتمع', 'منشور', 'تعليق', 'رساله خاصه', 'feed'].some(term => text.includes(term))) return { label: 'فتح المجتمع', tab: 'feed' };
  if (['حسابي', 'ملف شخصي', 'البريد', '2fa', 'مصادقه', 'كلمه المرور', 'جلسه', 'شكوى', 'مشكل', 'خطا', 'دعم', 'تذكره'].some(term => text.includes(term))) return { label: 'فتح حسابي', tab: 'profile' };
  if (text.includes('مستو') || text.includes('ترقي')) return { label: 'فتح المستويات', tab: 'tiers' };
  if (['فريق', 'احاله', 'احالات', 'دعوه', 'دعوات', 'مكافاه', 'مكافات', 'نقاط'].some(term => text.includes(term))) return { label: 'فتح الفريق', tab: 'team' };
  if (['مهمه', 'مهام', 'تقييم', 'task'].some(term => text.includes(term))) return { label: 'فتح المهام', tab: 'travel' };
  if (['رصيد', 'محفظه', 'سحب', 'ايداع', 'deposit', 'withdraw'].some(term => text.includes(term))) return { label: 'فتح الرئيسية', tab: 'home' };
  return null;
}

module.exports = { chat, localReply, buildPlatformKnowledge, getSuggestedAction };
