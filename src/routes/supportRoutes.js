const express = require('express');
const controller = require('../controllers/supportController');
const { verifyToken } = require('../middlewares/auth');
const router = express.Router();
router.use(verifyToken);
router.get('/', controller.list);
router.post('/', controller.create);
router.post('/:id/reply', controller.reply);
module.exports = router;
