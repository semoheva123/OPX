const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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
const { verifyAdmin } = require('./middlewares/auth');
const jwt = require('jsonwebtoken');
const Session = require('./models/Session');
const User = require('./models/User');
const realtimeService = require('./services/realtimeService');

function createApp({ resend, webpush, gameSettings, cronHandlers = {} }) {
  const app = express();
  app.locals.deploymentVersion = process.env.DEPLOYMENT_VERSION || 'socialfi-20260907-2';
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', trustProxy === 'true' ? 1 : trustProxy === 'false' || trustProxy === undefined ? false : Number(trustProxy));
  app.locals.resend = resend;
  app.locals.webpush = webpush;
  app.locals.gameSettings = gameSettings;
  const realtimeRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز عدد محاولات التحديث اللحظي، يرجى المحاولة لاحقاً' } });

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
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.get('/api/health', (req, res) => {
    const databaseReady = mongoose.connection.readyState === 1;
    res.status(databaseReady ? 200 : 503).json({ success: databaseReady, status: databaseReady ? 'ok' : 'degraded', database: databaseReady ? 'connected' : 'disconnected', deploymentVersion: req.app.locals.deploymentVersion, uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
  });

  const runCronJob = async (req, res) => {
    const expectedSecret = process.env.CRON_SECRET;
    const suppliedSecret = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') || String(req.get('x-cron-secret') || '');
    if (!expectedSecret || suppliedSecret !== expectedSecret) return res.status(401).json({ error: 'مصادقة المهمة المجدولة غير صالحة' });
    const handler = cronHandlers[req.params.job];
    if (typeof handler !== 'function') return res.status(404).json({ error: 'المهمة المجدولة غير موجودة' });
    try {
      const result = await handler();
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
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const scope = decoded.scope === 'admin' ? 'admin' : 'user';
      const activeSession = decoded.jti
        ? await Session.findOne({ jti: decoded.jti, userId: decoded.id, scope, revokedAt: null, expiresAt: { $gt: new Date() } })
        : null;
      if (!activeSession) return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
      const user = await User.findById(decoded.id).select('role isBanned');
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
      const token = String(req.query.token || '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const expectedScope = decoded.scope === 'admin' ? 'admin' : 'user';
      const activeSession = decoded.jti
        ? await Session.findOne({ jti: decoded.jti, userId: decoded.id, scope: expectedScope, revokedAt: null, expiresAt: { $gt: new Date() } })
        : null;
      if (!activeSession) return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
      const user = await User.findById(decoded.id).select('role isBanned');
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
      callback(allowed ? null : new Error('CORS Policy: Access denied'), allowed);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));

  app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز حد الطلبات المسموح به، يرجى المحاولة لاحقاً' } }));
  app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز محاولات الدخول/التسجيل المسموحة، يرجى الانتظار 15 دقيقة.' } }));
  app.use((req, res, next) => {
    if (/^\/(?:private|\.)(?:\/|$)/i.test(req.path) || /^\/(?:package-lock\.json|package\.json)$/i.test(req.path)) return res.status(404).end();
    next();
  });
  app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html')));
  app.use(express.static(path.join(__dirname, '..'), { dotfiles: 'deny' }));

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

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'المسار غير موجود' });
    res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
  });
  app.use((error, req, res, next) => {
    console.error('Unhandled application error:', error.message);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
    res.status(500).sendFile(path.join(__dirname, '..', '500.html'));
  });

  return app;
}

module.exports = createApp;
