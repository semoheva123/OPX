const express = require('express');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/profile', verifyToken, userController.getProfile);
router.post('/wallet-address', verifyToken, userController.setWalletAddress);
router.post('/profile-image', verifyToken, userController.updateProfileImage);
router.get('/referrals', verifyToken, userController.getReferrals);
router.get('/team-network', verifyToken, userController.getTeamNetwork);
router.get('/growth', verifyToken, userController.getGrowth);
router.get('/upgrade-history', verifyToken, userController.getUpgradeHistory);
router.get('/home-summary', verifyToken, userController.getHomeSummary);
router.post('/2fa/send-code', verifyToken, userController.sendTwoFactorCode);
router.post('/2fa/toggle', verifyToken, userController.toggleTwoFactor);
router.post('/2fa/setup', verifyToken, userController.setupTwoFactor);
router.post('/2fa/confirm', verifyToken, userController.confirmTwoFactor);
router.post('/change-password', verifyToken, userController.changePassword);
router.post('/push/subscribe', verifyToken, userController.subscribePush);

module.exports = router;
