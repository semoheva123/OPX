const express = require('express');
const activityController = require('../controllers/activityController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.post('/tasks/complete', verifyToken, activityController.completeTask);
router.post('/spin/wheel', verifyToken, activityController.spinWheel);
router.post('/spin/mystery-box', verifyToken, activityController.mysteryBox);
router.get('/games/config', activityController.getGameConfig);
router.get('/games/history', verifyToken, activityController.getGameHistory);
router.get('/games/stats', verifyToken, activityController.getGameStats);
router.post('/staking/create', verifyToken, activityController.createStaking);
router.get('/staking/my', verifyToken, activityController.getStakings);
router.post('/staking/claim', verifyToken, activityController.claimStaking);

module.exports = router;
