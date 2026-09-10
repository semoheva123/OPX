const express = require('express');
const aiController = require('../controllers/aiController');
const { verifyToken } = require('../middlewares/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'تم تجاوز عدد أسئلة AI المسموح بها، حاول لاحقًا.' } }));
router.post('/chat', verifyToken, aiController.chat);

module.exports = router;
