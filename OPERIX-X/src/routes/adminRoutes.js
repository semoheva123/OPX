const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyAdmin, requirePermission, requireFullAdmin } = require('../middlewares/auth');
const supportController = require('../controllers/supportController');
const authController = require('../controllers/authController');

const router = express.Router();
router.use(verifyAdmin);

router.post('/vip-levels', requirePermission('manage_vip'), adminController.saveVipLevel);
router.delete('/vip-levels/:code', requirePermission('manage_vip'), adminController.deleteVipLevel);
router.get('/overview', requirePermission('read_overview'), adminController.overview);
router.get('/analytics', requirePermission('read_overview'), adminController.analytics);
router.get('/users', requirePermission('read_users'), adminController.listUsers);
router.post('/reset-daily-tasks', requirePermission('manage_users'), adminController.resetDailyTasks);
router.post('/users/toggle-ban', requirePermission('manage_users'), adminController.toggleBan);
router.post('/users/update', requirePermission('finance'), adminController.updateUser);
router.post('/users/update-account', requirePermission('manage_users'), adminController.updateUserAccount);
router.post('/users/tier', requirePermission('manage_vip'), adminController.updateUserTier);
router.post('/users/role', requireFullAdmin, adminController.updateUserRole);
router.get('/withdrawals', requirePermission('finance'), adminController.listWithdrawals);
router.get('/audit-logs', requirePermission('read_audit'), adminController.listAuditLogs);
router.get('/referrals', requirePermission('read_referrals'), adminController.listReferrals);
router.get('/referrals/tree/:userId', requirePermission('read_referrals'), adminController.referralTree);
router.post('/withdrawals/action', requirePermission('finance'), adminController.withdrawalAction);
router.get('/settings/games', requirePermission('manage_games'), adminController.gameSettings);
router.post('/settings/games', requirePermission('manage_games'), adminController.updateGameSettings);
router.post('/broadcast', requirePermission('broadcast'), adminController.broadcast);
router.get('/broadcasts', requirePermission('broadcast'), adminController.listBroadcasts);
router.get('/support/tickets', requirePermission('manage_users'), supportController.listAdmin);
router.get('/security/2fa', requireFullAdmin, authController.adminSecurityStatus);
router.post('/security/2fa/setup', requireFullAdmin, authController.adminSecuritySetup);
router.post('/security/2fa/confirm', requireFullAdmin, authController.adminSecurityConfirm);
router.post('/security/invite-admin', requireFullAdmin, authController.inviteAdmin);
router.post('/support/tickets/:id', requirePermission('manage_users'), supportController.updateAdmin);

module.exports = router;
