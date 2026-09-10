const express = require('express');
const investmentVaultController = require('../controllers/investmentVaultController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/investment-vault/contracts', verifyToken, investmentVaultController.getVaultContracts);
router.post('/investment-vault/create', verifyToken, investmentVaultController.createVault);
router.get('/investment-vault/my', verifyToken, investmentVaultController.getVaults);
router.post('/investment-vault/claim', verifyToken, investmentVaultController.claimVault);

module.exports = router;