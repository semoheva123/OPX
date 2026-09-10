const express = require('express');
const cpaLeadController = require('../controllers/cpaLeadController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/offerwall', verifyToken, cpaLeadController.getOfferwall);
router.get('/postback', cpaLeadController.postback);

module.exports = router;