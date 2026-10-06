const assert = require('node:assert/strict');
const { buildPlatformKnowledge, localReply } = require('../src/controllers/aiController');

const levels = [
  { code: 'A1', name: 'A1', price: 100, tasks: 8, dailyProfit: 1.5 },
  { code: 'A2', name: 'A2', price: 300, tasks: 12, dailyProfit: 3 }
];
const knowledge = buildPlatformKnowledge(levels, { referralsPerCycle: 9 }, 'A2');

assert.match(knowledge.levelFacts, /A1:.*100 USDT.*7.*1\.5/);
assert.match(knowledge.levelFacts, /A2:.*300 USDT.*11.*3/);
assert.equal(knowledge.currentLevelTaskLimit, 11);
assert.equal(knowledge.referralsPerCycle, 9);
assert.match(knowledge.withdrawalSchedule, /الجمعة/);
assert.match(knowledge.taskRule, /المجتمعية اختيارية/);
assert.match(knowledge.upgradeRule, /لا تفترض شرط إحالات/);

const taskReply = localReply('كيف أنفذ المهام؟', 'member', 25, 'A2', knowledge);
assert.match(taskReply, /حالتها «متاحة»/);
assert.match(taskReply, /التسلسل وفترة الانتظار/);

const referralReply = localReply('كم إحالة أحتاج للألعاب؟', 'member', 25, 'A2', knowledge);
assert.match(referralReply, /9 إحالات نشطة/);

const supportReply = localReply('أريد تقديم شكوى ومراجعة معاملة', 'member', 25, 'A2', knowledge);
assert.match(supportReply, /«حسابي» من القائمة الرئيسية/);
assert.match(supportReply, /«إعدادات المنصة والدعم»/);
assert.match(supportReply, /«فتح تذكرة دعم»/);
assert.match(supportReply, /«إرسال التذكرة»/);
assert.match(supportReply, /تذاكرك السابقة/);
assert.doesNotMatch(supportReply, /مركز الدعم.*القائمة الرئيسية/);
assert.doesNotMatch(supportReply, /جميع المعاملات.*آمنة/);

console.log('Customer service live-knowledge tests passed');
