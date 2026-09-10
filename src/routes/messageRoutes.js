const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/messageController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();
const messageWriteLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز محاولات الرسائل، حاول لاحقاً' } });

router.use(verifyToken);
router.get('/', controller.listConversations);
router.get('/:userId', controller.getThread);
router.post('/:userId', messageWriteLimit, controller.sendMessage);

module.exports = router;