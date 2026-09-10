const jwt = require('jsonwebtoken');
const dataAccess = require('../services/dataAccess');

const JWT_SECRET = process.env.JWT_SECRET;

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const bearerToken = authHeader.split(' ')[1];
    if (bearerToken && bearerToken !== 'undefined' && bearerToken !== 'null') return bearerToken;
  }
  const cookies = String(req.headers.cookie || '').split(';').map(cookie => cookie.trim());
  const adminCookie = cookies.find(cookie => cookie.startsWith('operix_admin='));
  return adminCookie ? decodeURIComponent(adminCookie.slice('operix_admin='.length)) : null;
}

function getAdminToken(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(cookie => cookie.trim());
  const adminCookie = cookies.find(cookie => cookie.startsWith('operix_admin='));
  if (adminCookie) return decodeURIComponent(adminCookie.slice('operix_admin='.length));
  return getBearerToken(req);
}

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(403).json({ error: 'مطلوب توكن المصادقة' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(403).json({ error: 'صيغة التوكن غير صحيحة' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.scope === 'admin') return res.status(403).json({ error: 'توكن الإدارة غير صالح لهذه المنطقة' });
    const activeSession = decoded.jti
      ? await dataAccess.session.findOne({ jti: decoded.jti, userId: decoded.id, scope: 'user' })
      : null;
    if (activeSession && (activeSession.revokedAt || new Date(activeSession.expiresAt) <= new Date())) {
      return res.status(401).json({ error: 'تم إنهاء هذه الجلسة أو انتهت صلاحيتها' });
    }
    if (decoded.jti && !activeSession) return res.status(401).json({ error: 'تم إنهاء هذه الجلسة أو انتهت صلاحيتها' });
    const user = await dataAccess.user.findById(decoded.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.isBanned) return res.status(403).json({ error: 'تم تعليق حسابك من قبل الإدارة. يرجى التواصل مع الدعم الفني.' });

    req.user = decoded;
    req.session = activeSession;
    if (activeSession && !dataAccess.isSupabaseRuntime()) {
      await dataAccess.session.updateOne({ _id: activeSession._id }, { $set: { lastSeenAt: new Date() } });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'التوكن غير صالح أو انتهت صلاحيته' });
  }
};

const adminRoles = ['admin', 'financial_admin', 'support_admin', 'monitor'];

function rejectAdminRequest(req, res, status, error) {
  if (req.path === '/admin.html' && req.accepts('html')) return res.redirect('/admin-login.html');
  return res.status(status).json({ error });
}

const verifyAdmin = async (req, res, next) => {
  try {
    const token = getAdminToken(req);
    if (!token) return rejectAdminRequest(req, res, 401, 'غير مصرح: لا يوجد توكن');

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.scope !== 'admin') return rejectAdminRequest(req, res, 401, 'تحتاج إلى جلسة إدارية مستقلة');
    const activeSession = decoded.jti
      ? await dataAccess.session.findOne({ jti: decoded.jti, userId: decoded.id, scope: 'admin' })
      : null;
    if (activeSession && (activeSession.revokedAt || new Date(activeSession.expiresAt) <= new Date())) {
      return rejectAdminRequest(req, res, 401, 'جلسة إدارية غير صالحة أو انتهت الصلاحية');
    }
    if (!activeSession) return rejectAdminRequest(req, res, 401, 'جلسة إدارية غير صالحة أو انتهت الصلاحية');
    const user = await dataAccess.user.findById(decoded.id);

    if (!user || !adminRoles.includes(user.role) || user.isBanned) {
      return rejectAdminRequest(req, res, 403, 'وصول مرفوض: هذه المنطقة مخصصة للمدير فقط');
    }

    req.user = user;
    req.session = activeSession;
    next();
  } catch (error) {
    return rejectAdminRequest(req, res, 401, 'جلسة غير صالحة أو انتهت الصلاحية');
  }
};

function requirePermission(permission) {
  return (req, res, next) => {
    const permissions = {
      admin: ['read_overview', 'read_users', 'manage_users', 'finance', 'manage_vip', 'manage_games', 'broadcast', 'read_audit', 'read_referrals'],
      financial_admin: ['read_overview', 'read_users', 'finance', 'read_audit'],
      support_admin: ['read_overview', 'read_users', 'manage_users', 'read_audit', 'read_referrals'],
      monitor: ['read_overview', 'read_users', 'read_audit', 'read_referrals']
    };
    if (!permissions[req.user.role]?.includes(permission)) return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' });
    next();
  };
}

function requireFullAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'هذا الإجراء متاح للمدير الكامل فقط' });
  next();
}

module.exports = { verifyToken, verifyAdmin, requirePermission, requireFullAdmin, adminRoles };
