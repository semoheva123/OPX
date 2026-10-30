// 🚀 OPERIX Platform Backend Server
// تم تحديث الكود وتطبيق أفضل الممارسات الأمنية وإدارة المعاملات المعقدة وفصل الأرباح عن الإيداع.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { Client } = require('pg');
const webpush = require('web-push');
const crypto = require('crypto');
const createApp = require('./src/app');
const logger = require('./src/services/logger');
const { connectDatabase, closeDatabase, getDatabaseMode } = require('./src/config/database');
const dataAccess = require('./src/services/dataAccess');
const { resetDailyTasks, scheduleDailyTaskReset } = require('./src/jobs/dailyTasksReset');
const { generateDailyTaskEntities, scheduleDailyTaskGeneration } = require('./src/jobs/dailyTaskGeneration');
const { generateOfficialAiPost } = require('./src/jobs/aiAnnouncer');
const { ensureOfficialCommunityAccount, followOfficialForExistingUsers } = require('./src/services/officialCommunity');
const { processScheduledBroadcasts } = require('./src/controllers/adminController');

// 🔐 إعداد المفاتيح السرية وتجنب الثغرات الافتراضية
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.JWT_SECRET) {
  logger.warn('jwt_secret_missing', { detail: 'falling back to a temporary key, run in degraded mode' });
}

// 📧 إعداد عميل Resend
const resendKey = process.env.RESEND_API_KEY;
const resend = resendKey ? new Resend(resendKey) : null;
const emailFrom = String(process.env.EMAIL_FROM || 'noreply@operix.local').trim();
if (process.env.NODE_ENV === 'production' && (!process.env.EMAIL_FROM || /resend\.dev/i.test(emailFrom))) {
  logger.warn('email_from_not_configured', { detail: 'outbound email disabled until EMAIL_FROM is verified' });
}

// 🔔 إعداد مفاتيح Web Push (VAPID Keys)
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (publicVapidKey && privateVapidKey) {
  try {
    webpush.setVapidDetails(
      'mailto:support@operix.app',
      publicVapidKey,
      privateVapidKey
    );
  } catch (e) {
    logger.warn('web_push_init_failed', { error: { name: e.name, message: e.message } });
  }
}

// 🕹️ متغيرات إعدادات الألعاب
let gameSettings = {
  spinMin: 1,
  spinMax: 10,
  boxMin: 5,
  boxMax: 25,
  dailyGameRewardCap: 100,
  referralsPerCycle: 6
};
const app = createApp({
  resend,
  webpush,
  gameSettings,
  cronHandlers: {
    'reset-daily-tasks': resetDailyTasks,
    'refresh-daily-task-entities': generateDailyTaskEntities,
    'ai-announcer': generateOfficialAiPost,
    'process-broadcasts': () => processScheduledBroadcasts(webpush),
    'process-email-broadcasts': req => require('./src/controllers/adminController').processAdminEmailBroadcasts(resend, req?.body?.campaignId),
    'process-email-verification-reminders': () => require('./src/controllers/adminController').processEmailVerificationReminders(resend),
    'check-financial-readiness': () => require('./src/services/financialReadinessService').checkFinancialReadiness(),
    'process-withdrawal-payouts': async () => {
      const adminController = require('./src/controllers/adminController');
      let automaticApprovals;
      try { automaticApprovals = await adminController.processAutomaticWithdrawalApprovals(); }
      catch (error) {
        logger.error('withdrawal_worker_failed', { error: { name: error.name, message: error.message, stack: error.stack } });
        automaticApprovals = { processed: 0, error: error.message };
      }
      const payouts = await adminController.processWithdrawalPayoutQueue(resend);
      return { automaticApprovals, payouts };
    }
  }
});

// ==================== 📌 الملفات الثابتة وSEO ====================
// تُخدَم من src/app.js: مسارات SEO (sitemap.xml / robots.txt) والأرشفة الثابتة مسجّلة هناك.
// أي مسار يُسجَّل في هذا الملف بعد createApp() لا يُنفَّذ أبدًا لأن createApp يثبّت معالج 404
// قبل العودة؛ أُزيلت المسارات الميتة لتجنّب الاعتقاد بأنها تعمل.

// ==============================================================================

// دالة تهيئة مستويات VIP الافتراضية
async function seedVipLevels() {
  try {
    const count = await dataAccess.vipLevel.countDocuments();
    if (count === 0) {
      const defaultLevels = [
        { code: 'A1', name: 'المستوى A1 المعتمد', price: 50, tasks: 33, dailyProfit: 2.50, monthlyProfit: 75.00, yearlyProfit: 912.50, badgeColor: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' },
        { code: 'A2', name: 'المستوى A2 المتقدم', price: 150, tasks: 35, dailyProfit: 8.00, monthlyProfit: 240.00, yearlyProfit: 2920.00, badgeColor: 'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400' },
        { code: 'A3', name: 'المستوى A3 الخبير', price: 350, tasks: 40, dailyProfit: 20.00, monthlyProfit: 600.00, yearlyProfit: 7300.00, badgeColor: 'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400' },
        { code: 'A4', name: 'المستوى A4 المحترف', price: 750, tasks: 45, dailyProfit: 45.00, monthlyProfit: 1350.00, yearlyProfit: 16425.00, badgeColor: 'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400' },
        { code: 'A5', name: 'المستوى A5 الخارق (VIP)', price: 1500, tasks: 50, dailyProfit: 100.00, monthlyProfit: 3000.00, yearlyProfit: 36500.00, badgeColor: 'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400' }
      ];
      await dataAccess.vipLevel.create(defaultLevels);
      logger.info('vip_levels_seeded');
    }
  } catch (err) {
    logger.error('vip_levels_seed_failed', { error: { name: err.name, message: err.message } });
  }
}

async function loadGameSettings() {
  try {
    let stored = await dataAccess.gameSetting.findOne({ key: 'default' });
    if (!stored) stored = await dataAccess.gameSetting.create({ key: 'default', spinMin: gameSettings.spinMin, spinMax: gameSettings.spinMax, boxMin: gameSettings.boxMin, boxMax: gameSettings.boxMax, dailyGameRewardCap: gameSettings.dailyGameRewardCap, referralsPerCycle: gameSettings.referralsPerCycle });
    if (stored) {
      const storedReferralThreshold = Number(stored.referralsPerCycle);
      const referralsPerCycle = storedReferralThreshold === 25 ? 6 : storedReferralThreshold || 6;
      if (storedReferralThreshold === 25) await dataAccess.gameSetting.updateOne({ id: stored.id || stored._id }, { referralsPerCycle });
      Object.assign(gameSettings, { spinMin: stored.spinMin, spinMax: stored.spinMax, boxMin: stored.boxMin, boxMax: stored.boxMax, dailyGameRewardCap: stored.dailyGameRewardCap, referralsPerCycle });
    }
  } catch (error) {
    logger.warn('game_settings_load_failed', { error: { name: error.name, message: error.message } });
  }
}

// كل مسارات API (بما فيها /admin و/admin.html) مسجّلة داخل src/app.js. لا تُضِف أي مسار هنا:
// createApp() يثبّت معالج 404 قبل العودة، لذا أي تسجيل في هذا الملف بعد الاستدعاء لا يُنفَّذ.

const PORT = process.env.PORT || 5000;
const isVercelRuntime = Boolean(process.env.VERCEL);
let server;
let initializationPromise;

async function ensureSupabaseSchema() {
  if (process.env.AUTO_APPLY_SUPABASE_SCHEMA !== 'true') {
    logger.info('supabase_schema_apply_skipped', { detail: 'set AUTO_APPLY_SUPABASE_SCHEMA=true to enable' });
    return;
  }

  const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.info('supabase_direct_url_missing', { detail: 'tables must be created from the Supabase SQL editor' });
    return;
  }

  try {
    const schemaPath = path.join(__dirname, 'supabase', 'schema.sql');
    const sqlText = fs.readFileSync(schemaPath, 'utf8');
    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    await client.query(sqlText);
    await client.end();
    logger.info('supabase_schema_ready');
  } catch (error) {
    logger.error('supabase_schema_check_failed', { error: { name: error.name, message: error.message } });
    logger.error('supabase_schema_hint', { detail: 'verify the database url and supabase/schema.sql compatibility' });
  }
}

async function initializeRuntime() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    await connectDatabase();
    await ensureSupabaseSchema();

    const runtimeMode = getDatabaseMode();
    if (runtimeMode === 'supabase') {
      logger.info('supabase_mode_enabled');
      if (isVercelRuntime) return;
      await seedVipLevels();
      await loadGameSettings();
      try {
        await ensureOfficialCommunityAccount();
        await followOfficialForExistingUsers();
      } catch (error) {
        logger.warn('official_community_init_failed', { error: { name: error.name, message: error.message } });
      }
      if (!isVercelRuntime) {
        scheduleDailyTaskReset();
        scheduleDailyTaskGeneration();
        generateDailyTaskEntities().catch(error => logger.warn('daily_task_entities_failed', { error: { name: error.name, message: error.message } }));
      }
    }
  })().catch(error => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

if (!isVercelRuntime) {
  initializeRuntime()
    .then(() => {
      server = app.listen(PORT, '0.0.0.0', () => {
        logger.info('server_started', { port: PORT, environment: process.env.NODE_ENV || 'development' });
      });
    })
    .catch(error => {
      logger.error('supabase_runtime_failed', { error: { name: error.name, message: error.message, stack: error.stack } });
      process.exit(1);
    });
} else {
  module.exports = async (req, res) => {
    try {
      await initializeRuntime();
      return app(req, res);
    } catch (error) {
      logger.error('vercel_runtime_failed', { error: { name: error.name, message: error.message, stack: error.stack } });
      return res.status(500).json({ error: 'تعذر تهيئة الخادم' });
    }
  };
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error('unhandled_rejection', { error: { name: reason?.name, message: reason?.message || String(reason), stack: reason?.stack } });
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error: { name: error.name, message: error.message, stack: error.stack } });
});

process.on('SIGTERM', () => {
  logger.info('shutdown_requested', { signal: 'SIGTERM' });
  if (server) {
    server.close(() => {
      closeDatabase().then(() => {
        process.exit(0);
      });
    });
  } else {
    process.exit(0);
  }
});
