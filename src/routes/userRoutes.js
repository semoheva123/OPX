const express = require('express');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/profile', verifyToken, userController.getProfile);
router.put('/username', verifyToken, userController.updateUsername);
router.post('/wallet-address', verifyToken, userController.setWalletAddress);
router.post('/profile-image', verifyToken, userController.updateProfileImage);
router.post('/social-profile', verifyToken, userController.updateSocialProfile);
router.get('/referrals', verifyToken, userController.getReferrals);
router.get('/referral-rewards', verifyToken, userController.getReferralRewards);
router.get('/growth', verifyToken, userController.getGrowth);
router.get('/upgrade-history', verifyToken, userController.getUpgradeHistory);
router.get('/home-summary', verifyToken, userController.getHomeSummary);
router.post('/change-password', verifyToken, userController.changePassword);
router.post('/push/subscribe', verifyToken, userController.subscribePush);

module.exports = router;
