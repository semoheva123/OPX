const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/socialGraphController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();
const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
router.use(verifyToken);
router.get('/community', controller.listCommunity);
router.post('/:userId/follow', writeLimit, controller.toggleFollow);

module.exports = router;
