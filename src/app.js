const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const walletRoutes = require('./routes/walletRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const activityRoutes = require('./routes/activityRoutes');
const publicRoutes = require('./routes/publicRoutes');
const aiRoutes = require('./routes/aiRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const supportRoutes = require('./routes/supportRoutes');
const couponRoutes = require('./routes/couponRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const investmentVaultRoutes = require('./routes/investmentVaultRoutes');
const socialFeedRoutes = require('./routes/socialFeedRoutes');
const socialGraphRoutes = require('./routes/socialGraphRoutes');
const messageRoutes = require('./routes/messageRoutes');
const cpaLeadRoutes = require('./routes/cpaLeadRoutes');
const { verifyAdmin } = require('./middlewares/auth');
const jwt = require('jsonwebtoken');
const realtimeService = require('./services/realtimeService');
const { checkSupabaseConnection } = require('./config/supabase');
const dataAccess = require('./services/dataAccess');
const Session = dataAccess.session;
const User = dataAccess.user;
const { getDatabaseMode } = require('./config/database');

function readCookieToken(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(cookie => cookie.trim());
  const adminCookie = cookies.find(cookie => cookie.startsWith('operix_admin='));
  if (adminCookie) return decodeURIComponent(adminCookie.slice('operix_admin='.length));
  const userCookie = cookies.find(cookie => cookie.startsWith('operix_session='));
  if (userCookie) return decodeURIComponent(userCookie.slice('operix_session='.length));
  return '';
}

function readBearerToken(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function createApp({ resend, webpush, gameSettings, cronHandlers = {} }) {
  const app = express();
  app.locals.deploymentVersion = process.env.DEPLOYMENT_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'local';
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', trustProxy === 'true' ? 1 : trustProxy === 'false' || trustProxy === undefined ? false : Number(trustProxy));
  app.locals.resend = resend;
  app.locals.webpush = webpush;
  app.locals.gameSettings = gameSettings;
  const realtimeRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز عدد محاولات التحديث اللحظي، يرجى المحاولة لاحقاً' } });

  app.use((req, res, next) => {
    const requestHost = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (requestHost !== 'www.operix.website') return next();
    return res.redirect(308, `https://operix.website${req.originalUrl}`);
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com', 'https://cdn.ably.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:', 'wss://*.ably-realtime.com', 'wss://*.ably-realtime.net', 'wss://*.ably.net'],
        frameSrc: ["'self'", 'https://www.cpalead.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.get('/api/health', async (req, res) => {
    const runtimeMode = getDatabaseMode();
    const supabase = await checkSupabaseConnection().catch(error => ({ configured: true, reachable: false, error: error.message }));
    const databaseReady = Boolean(supabase?.reachable);
    res.status(200).json({ success: databaseReady, status: databaseReady ? 'ok' : 'degraded', database: databaseReady ? 'supabase' : 'disconnected', financialSchema: supabase?.financialSchema || { depositTablesReady: false, payoutTableReady: false, ready: false }, supabase, migrationMode: runtimeMode, deploymentVersion: req.app.locals.deploymentVersion, uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
  });

  const runCronJob = async (req, res) => {
    const expectedSecret = process.env.CRON_SECRET;
    const suppliedSecret = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') || String(req.get('x-cron-secret') || '');
    if (!expectedSecret || suppliedSecret !== expectedSecret) return res.status(401).json({ error: 'مصادقة المهمة المجدولة غير صالحة' });
    const handler = cronHandlers[req.params.job];
    if (typeof handler !== 'function') return res.status(404).json({ error: 'المهمة المجدولة غير موجودة' });
    try {
      const result = await handler(req);
      res.json({ success: true, job: req.params.job, result: result || null });
    } catch (error) {
      console.error(`Cron job ${req.params.job} error:`, error.message);
      res.status(500).json({ error: 'فشل تنفيذ المهمة المجدولة' });
    }
  };
  app.get('/api/internal/cron/:job', runCronJob);
  app.post('/api/internal/cron/:job', runCronJob);

  app.get('/api/realtime/token', realtimeRateLimit, async (req, res) => {
    try {
      if (!process.env.ABLY_API_KEY) return res.status(503).json({ error: 'خدمة التحديث اللحظي غير مهيأة' });
      const token = readBearerToken(req) || readCookieToken(req);
      if (!token) return res.status(401).json({ error: 'مطلوب توكن المصادقة' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const scope = decoded.scope === 'admin' ? 'admin' : 'user';
      const activeSession = decoded.jti
        ? await dataAccess.session.findOne({ jti: decoded.jti, userId: decoded.id, scope })
        : null;
      if (!activeSession || activeSession.revokedAt || new Date(activeSession.expiresAt) <= new Date()) return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
      const user = await dataAccess.user.findById(decoded.id);
      const adminRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];
      if (!user || user.isBanned || (scope === 'admin' && !adminRoles.includes(user.role))) return res.status(403).json({ error: 'الوصول إلى التحديث اللحظي مرفوض' });
      const channel = scope === 'admin' ? 'operix:admin' : `operix:user:${user._id}`;
      const Ably = require('ably');
      const client = new Ably.Rest(process.env.ABLY_API_KEY);
      const tokenRequest = await client.auth.createTokenRequest({ clientId: `${scope}:${user._id}`, capability: JSON.stringify({ [channel]: ['subscribe'] }) });
      res.json(tokenRequest);
    } catch (error) {
      res.status(401).json({ error: 'توكن التحديث اللحظي غير صالح' });
    }
  });

  app.get('/api/realtime/stream', realtimeRateLimit, async (req, res) => {
    try {
      const token = String(req.query.token || '') || readBearerToken(req) || readCookieToken(req);
      if (!token) return res.status(401).json({ error: 'مطلوب توكن المصادقة' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const expectedScope = decoded.scope === 'admin' ? 'admin' : 'user';
      const activeSession = decoded.jti
        ? await dataAccess.session.findOne({ jti: decoded.jti, userId: decoded.id, scope: expectedScope })
        : null;
      if (!activeSession || activeSession.revokedAt || new Date(activeSession.expiresAt) <= new Date()) return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
      const user = await dataAccess.user.findById(decoded.id);
      if (!user || user.isBanned || (expectedScope === 'admin' && !['admin', 'financial_admin', 'support_admin', 'monitor'].includes(user.role))) {
        return res.status(403).json({ error: 'الوصول إلى التحديث اللحظي مرفوض' });
      }
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      res.write(`event: connected\ndata: ${JSON.stringify({ scope: expectedScope })}\n\n`);
      realtimeService.addClient({ response: res, userId: user._id, scope: expectedScope, role: user.role });
    } catch (error) {
      res.status(401).json({ error: 'توكن التحديث اللحظي غير صالح' });
    }
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean)
    : ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = allowedOrigins.includes(origin.replace(/\/$/, ''));
      // Rejecting the CORS handshake is enough for browsers; state-changing requests are also
      // blocked with an explicit 403 by the origin guard below.
      callback(null, allowed);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));

  app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => req.path.startsWith('/admin/') || req.path.startsWith('/internal/'),
    message: { error: 'تم تجاوز حد الطلبات المسموح به، يرجى المحاولة لاحقاً' }
  }));
  app.use('/api/auth/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => req.path.startsWith('/admin-'),
    message: { error: 'تم تجاوز محاولات الدخول/التسجيل المسموحة، يرجى الانتظار 15 دقيقة.' }
  }));
  // A working admin console legitimately issues far more requests than an end user behind the same IP.
  app.use('/api/admin/', rateLimit({ windowMs: 15 * 60 * 1000, max: 1200, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز حد طلبات لوحة الإدارة، يرجى المحاولة بعد قليل.' } }));
  app.use('/api/auth/admin-login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز محاولات الدخول الإدارية المسموحة، يرجى الانتظار 15 دقيقة.' } }));

  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.use('/api/', (req, res, next) => {
    if (!mutatingMethods.has(req.method)) return next();
    const requestHost = String(req.headers.host || '').toLowerCase();
    const isSameHost = value => {
      try { return new URL(value).host.toLowerCase() === requestHost; } catch (error) { return false; }
    };
    const origin = req.get('origin');
    const referer = req.get('referer');
    if (origin) {
      const allowed = allowedOrigins.includes(origin.replace(/\/$/, '')) || isSameHost(origin);
      if (!allowed) return res.status(403).json({ error: 'طلب غير موثوق: مصدر الطلب غير مسموح' });
    } else if (referer) {
      const allowed = isSameHost(referer) || allowedOrigins.some(item => referer.startsWith(`${item}/`));
      if (!allowed) return res.status(403).json({ error: 'طلب غير موثوق: مصدر الطلب غير مسموح' });
    }
    next();
  });
  app.use((req, res, next) => {
    if (/^\/(?:private|\.)(?:\/|$)/i.test(req.path) || /^\/(?:package-lock\.json|package\.json)$/i.test(req.path)) return res.status(404).end();
    next();
  });

  const staticRoot = path.join(__dirname, '..');
  const sendNoStoreStatic = (req, res, file) => res.sendFile(path.join(staticRoot, file), {
    headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff' }
  });

  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      const sitemap = await fs.readFile(path.join(staticRoot, 'sitemap.xml'));
      res.status(200).set({
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Content-Type': 'application/xml; charset=utf-8',
        'ETag': `W/"${app.locals.deploymentVersion}-sitemap"`,
        'Last-Modified': new Date().toUTCString(),
        'X-Content-Type-Options': 'nosniff'
      }).send(sitemap);
    } catch (error) {
      next(error);
    }
  });

  app.get('/', (req, res) => sendNoStoreStatic(req, res, 'index.html'));
  app.get('/index.html', (req, res) => sendNoStoreStatic(req, res, 'index.html'));
  app.get('/app.js', (req, res) => sendNoStoreStatic(req, res, 'app.js'));
  app.get('/sw.js', (req, res) => sendNoStoreStatic(req, res, 'sw.js'));

  app.get('/admin.html', verifyAdmin, (req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html'), {
    headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' }
  }));
  app.use(express.static(staticRoot, { dotfiles: 'deny', index: false, maxAge: 0 }));

  app.use('/api/user', userRoutes);
  app.use('/api', activityRoutes);
  app.use('/api', publicRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api', walletRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/support', supportRoutes);
  app.use('/api/coupons', couponRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api', investmentVaultRoutes);
  app.use('/api/social-feed', socialFeedRoutes);
  app.use('/api/social', socialGraphRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/integrations/cpalead', cpaLeadRoutes);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'المسار المطلوب غير موجود.' });
    res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
  });
  app.use((error, req, res, next) => {
    console.error('Unhandled application error:', error.message);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'تعذر معالجة الطلب الآن. يرجى المحاولة مرة أخرى.' });
    res.status(500).sendFile(path.join(__dirname, '..', '500.html'));
  });

  return app;
}

module.exports = createApp;
