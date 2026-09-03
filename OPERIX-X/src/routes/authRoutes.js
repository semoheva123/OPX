const express = require('express');
const authController = require('../controllers/authController');
const { verifyToken, verifyAdmin } = require('../middlewares/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/admin-login', authController.adminLogin);
router.post('/admin-2fa/setup', authController.adminSetupTwoFactor);
router.post('/admin-2fa/confirm', authController.adminConfirmTwoFactor);
router.post('/admin-invite/setup', authController.acceptAdminInviteSetup);
router.post('/admin-invite/confirm', authController.confirmAdminInvite);
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);
router.post('/logout', verifyToken, authController.logout);
router.post('/admin-logout', verifyAdmin, authController.logout);
router.post('/logout-other-sessions', verifyToken, authController.logoutOtherSessions);
router.post('/sessions/:jti/revoke', verifyToken, authController.revokeSession);
router.get('/sessions', verifyToken, authController.listSessions);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-otp', authController.verifyOtp);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
