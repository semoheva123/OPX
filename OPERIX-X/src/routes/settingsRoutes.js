const express = require('express');
const controller = require('../controllers/settingsController');
const { verifyAdmin, requireFullAdmin } = require('../middlewares/auth');
const router = express.Router();
router.get('/public', controller.getPublic);
router.get('/admin', verifyAdmin, controller.getAdmin);
router.post('/admin', verifyAdmin, requireFullAdmin, controller.update);
module.exports = router;
