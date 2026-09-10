const express = require('express');
const walletController = require('../controllers/walletController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/wallet/deposit-config', walletController.getDepositConfig);
router.post('/wallet/deposit', verifyToken, walletController.deposit);
router.post('/wallet/withdraw', verifyToken, walletController.withdraw);
router.get('/transactions/my-history', verifyToken, walletController.getMyHistory);

module.exports = router;
