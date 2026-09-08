const express = require('express');
const zealyController = require('../controllers/zealyController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/tasks', verifyToken, zealyController.listTasks);
router.post('/webhook', zealyController.receiveWebhook);

module.exports = router;