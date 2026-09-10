const express = require('express');
const couponController = require('../controllers/couponController');
const { verifyToken } = require('../middlewares/auth');
const router = express.Router();
router.post('/apply', verifyToken, couponController.apply);
module.exports = router;
