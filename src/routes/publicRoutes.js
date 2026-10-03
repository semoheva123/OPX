const express = require('express');
const publicController = require('../controllers/publicController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();
router.get('/vip-levels', publicController.getVipLevels);
router.get('/opx-price', publicController.getOpxPricing);
router.get('/opx-market', publicController.getOpxMarketData);
router.get('/leaderboard', publicController.leaderboard);
router.get('/live-activity', publicController.liveActivity);
router.post('/user/upgrade', verifyToken, publicController.upgrade);

module.exports = router;
