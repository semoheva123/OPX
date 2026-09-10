const express = require('express');
const controller = require('../controllers/notificationController');
const { verifyToken } = require('../middlewares/auth');
const router = express.Router();
router.use(verifyToken);
router.get('/', controller.list);
router.post('/read-all', controller.markAllRead);
router.post('/:id/read', controller.markRead);
module.exports = router;
