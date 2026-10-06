const assert = require('node:assert/strict');
const { buildPlatformKnowledge, localReply, getSuggestedAction } = require('../src/controllers/aiController');

const levels = [
  { code: 'A1', name: 'A1', price: 100, tasks: 8, dailyProfit: 1.5 },
  { code: 'A2', name: 'A2', price: 300, tasks: 12, dailyProfit: 3 }
];
const knowledge = buildPlatformKnowledge(levels, { referralsPerCycle: 9, spinMin: 2, spinMax: 8, boxMin: 5, boxMax: 15, dailyGameRewardCap: 60 }, 'A2', [
  { durationDays: 90, expectedReturnRate: 1.5, enabled: true }
], {
  depositBalance: 20,
  profitBalance: 5,
  opxBalance: 3,
  wheelCredits: 1,
  mysteryBoxCredits: 0,
  recentTransactions: [{ type: 'deposit', status: 'pending', amount: 20 }],
  recentVaults: [{ status: 'active', amount: 20, maturityDate: '2030-01-01T00:00:00.000Z' }]
});

assert.match(knowledge.levelFacts, /A1:.*100 USDT.*7.*1\.5/);
assert.match(knowledge.levelFacts, /A2:.*300 USDT.*11.*3/);
assert.equal(knowledge.currentLevelTaskLimit, 11);
assert.equal(knowledge.referralsPerCycle, 9);
assert.equal(knowledge.vaultMinimum, 10);
assert.match(knowledge.vaultContractFacts, /90 يوم/);
assert.match(knowledge.gameRewardRanges, /2–8/);
assert.match(knowledge.withdrawalFee, /5%.*2 USDT/);
assert.match(knowledge.withdrawalSchedule, /الجمعة/);
assert.match(knowledge.taskRule, /التفاعل المجتمعي اختياري وبلا مكافأة/);
assert.match(knowledge.taskRule, /ساعتين/);
assert.match(knowledge.upgradeRule, /فرق السعر/);
for (const tab of ['home', 'community', 'tiers', 'vault', 'tasks', 'games', 'team', 'profile', 'customerService']) {
  assert.ok(knowledge.tabGuides[tab], `knowledge must describe ${tab}`);
}

const taskReply = localReply('كيف أنفذ المهام؟', 'member', 25, 'A2', knowledge);
assert.match(taskReply, /الحالة «متاحة»/);
assert.match(taskReply, /فاصل ساعتين/);

const referralReply = localReply('كم إحالة أحتاج للألعاب؟', 'member', 25, 'A2', knowledge);
assert.match(referralReply, /9 إحالات نشطة/);

const depositReply = localReply('أين أجد عنوان الإيداع؟', 'member', 25, 'A2', { ...knowledge, depositAutomationEnabled: false });
assert.match(depositReply, /لا ترسل أي أموال/);

const withdrawalReply = localReply('ما رسوم السحب؟', 'member', 25, 'A2', knowledge);
assert.match(withdrawalReply, /5%/);
assert.match(withdrawalReply, /TRC20/);

const vaultReply = localReply('كيف أسترد الخزنة؟', 'member', 25, 'A2', knowledge);
assert.match(vaultReply, /90 يوم/);
assert.match(vaultReply, /لا يمكن الاسترداد قبل تاريخ الاستحقاق/);

const profileReply = localReply('كيف أفعل المصادقة الثنائية في حسابي؟', 'member', 25, 'A2', knowledge);
assert.match(profileReply, /امسح QR/);

const communityReply = localReply('كيف أنشر في المجتمع؟', 'member', 25, 'A2', knowledge);
assert.match(communityReply, /الرسائل الخاصة/);

const transactionReply = localReply('ما حالة آخر معاملة عندي؟', 'member', 25, 'A2', knowledge);
assert.match(transactionReply, /قيد المعالجة/);
assert.match(transactionReply, /لا تنشئ طلبًا مكررًا/);

const supportReply = localReply('أريد تقديم شكوى ومراجعة معاملة', 'member', 25, 'A2', knowledge);
assert.match(supportReply, /«حسابي»/);
assert.match(supportReply, /«إعدادات المنصة والدعم»/);
assert.match(supportReply, /«فتح تذكرة دعم»/);
assert.match(supportReply, /«إرسال التذكرة»/);
assert.match(supportReply, /تذاكرك السابقة/);
assert.doesNotMatch(supportReply, /مركز الدعم.*القائمة الرئيسية/);
assert.doesNotMatch(supportReply, /جميع المعاملات.*آمنة/);
assert.equal(getSuggestedAction('اشرح لي الخزنة').tab, 'vault');
assert.equal(getSuggestedAction('كيف أستخدم الألعاب؟').tab, 'spin');
assert.equal(getSuggestedAction('مشكلة في البريد').tab, 'profile');
assert.equal(getSuggestedAction('أين مكافآت الفريق؟').tab, 'team');

console.log('Customer service live-knowledge tests passed');
