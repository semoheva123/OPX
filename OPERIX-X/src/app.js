const express = require('express');
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
const { verifyAdmin } = require('./middlewares/auth');

function createApp({ resend, webpush, gameSettings }) {
  const app = express();
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', trustProxy === 'true' ? 1 : trustProxy === 'false' || trustProxy === undefined ? false : Number(trustProxy));
  app.locals.resend = resend;
  app.locals.webpush = webpush;
  app.locals.gameSettings = gameSettings;

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() }));

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
    if (/^\/\.(env|git|npmrc)(?:\/|$)/i.test(req.path) || /^\/(?:package-lock\.json|package\.json)$/i.test(req.path)) return res.status(404).end();
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
