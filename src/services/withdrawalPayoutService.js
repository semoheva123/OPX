const crypto = require('crypto');
const blockchainService = require('./blockchainService');
const tronProvider = require('./tronProvider');

const TRANSFER_ABI_V2 = {
  name: 'transfer',
  type: 'function',
  inputs: [{ name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }],
  outputs: [{ name: 'success', type: 'bool' }],
  stateMutability: 'nonpayable'
};
const MAX_BROADCAST_ATTEMPTS = 10;
const DEFAULT_MAX_PAYOUT_AMOUNT = 100;

function getMaxPayoutAmount() {
  const configured = String(process.env.WITHDRAWAL_MAX_SINGLE_USDT || '').trim();
  if (!configured) return DEFAULT_MAX_PAYOUT_AMOUNT;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(configured)) throw new Error('PAYOUT_AMOUNT_LIMIT_CONFIG_INVALID');
  const maximum = Number(configured);
  if (!Number.isFinite(maximum) || maximum <= 0 || maximum > DEFAULT_MAX_PAYOUT_AMOUNT) {
    throw new Error('PAYOUT_AMOUNT_LIMIT_CONFIG_INVALID');
  }
  return maximum;
}

function parseTokenUnits(value, decimals) {
  const text = String(value ?? '').trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('INVALID_TOKEN_DECIMALS');
  const match = text.match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[2] && match[2].length > decimals)) throw new Error('INVALID_PAYOUT_AMOUNT');
  const units = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] || '').padEnd(decimals, '0') || '0');
  const numericAmount = Number(text);
  if (units <= 0n || !Number.isFinite(numericAmount) || numericAmount > getMaxPayoutAmount()) throw new Error('PAYOUT_AMOUNT_LIMIT');
  return units;
}

function encryptionKey(network, privateKey) {
  if (!privateKey) throw new Error(`${network}_WITHDRAWAL_PRIVATE_KEY is not configured`);
  return crypto.createHash('sha256').update(`OPERIX_WITHDRAWAL_SIGNED_PAYLOAD_V1:${network}:${privateKey}`).digest();
}

function encryptSignedPayload(network, privateKey, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(network, privateKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptSignedPayload(network, privateKey, value) {
  const [version, ivText, tagText, ciphertextText] = String(value || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new Error('INVALID_ENCRYPTED_PAYOUT_PAYLOAD');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(network, privateKey), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8'));
}

function getPrivateKey(network) {
  if (String(network || '').toUpperCase() !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  const keyName = 'TRON_WITHDRAWAL_PRIVATE_KEY';
  const privateKey = String(process.env[keyName] || '').trim();
  if (!privateKey) throw new Error(`${keyName}_NOT_CONFIGURED`);
  return privateKey;
}

function createTronWeb(network, privateKey) {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const endpoints = tronProvider.getRpcEndpoints();
  if (!endpoints.length) throw new Error('TRON_RPC_ENDPOINTS_NOT_CONFIGURED');
  const tronWeb = tronProvider.createTronWebForEndpoint(endpoints[0], { privateKey });
  if (!tronWeb.isAddress(config.tokenContract)) throw new Error('INVALID_TRON_USDT_CONTRACT');
  return { tronWeb, config, endpoints };
}

async function prepareTrc20Payout({ recipient, amount }) {
  const privateKey = getPrivateKey('TRC20');
  const { tronWeb, config, endpoints } = createTronWeb('TRC20', privateKey);
  if (!tronWeb.isAddress(recipient)) throw new Error('INVALID_TRC20_RECIPIENT');
  const normalizedRecipient = tronWeb.address.fromHex(tronWeb.address.toHex(recipient.trim()));
  const amountUnits = parseTokenUnits(amount, config.decimals);
  const senderAddress = tronWeb.defaultAddress.base58;
  const tokenBalance = await tronProvider.withTronWeb(async client => {
    const token = await client.contract().at(config.tokenContract);
    return BigInt(String(await token.balanceOf(senderAddress).call()));
  }, { endpoints, privateKey });
  if (tokenBalance < amountUnits) throw new Error('PAYOUT_TOKEN_BALANCE_INSUFFICIENT');
  const feeLimit = BigInt(process.env.TRON_WITHDRAWAL_FEE_LIMIT_SUN || '100000000');
  if (feeLimit <= 0n || feeLimit > 1_000_000_000n) throw new Error('TRON_WITHDRAWAL_FEE_LIMIT_INVALID');
  const nativeBalance = await tronProvider.withTronWeb(async client => BigInt(String(await client.trx.getBalance(senderAddress))), { endpoints, privateKey });
  const minimumTrx = BigInt(process.env.TRON_WITHDRAWAL_MIN_TRX_SUN || feeLimit.toString());
  if (nativeBalance < (minimumTrx > feeLimit ? minimumTrx : feeLimit)) throw new Error('PAYOUT_NATIVE_GAS_BALANCE_INSUFFICIENT');

  // Get public reference-block data, then construct/sign locally without ever sending the private key to the RPC.
  const blockHeader = await tronProvider.withTronWeb(client => client.trx.getCurrentRefBlockParams(), { endpoints, privateKey });
  blockHeader.timestamp = Date.now();
  blockHeader.expiration = blockHeader.timestamp + 60 * 60 * 1000;
  const wrapper = await tronProvider.withTronWeb(client => client.transactionBuilder.triggerSmartContract(
    config.tokenContract,
    'transfer(address,uint256)',
    {
      feeLimit: Number(feeLimit), callValue: 0, txLocal: true, blockHeader,
      funcABIV2: TRANSFER_ABI_V2, parametersV2: [normalizedRecipient, amountUnits.toString()]
    },
    [],
    senderAddress
  ), { endpoints, privateKey });
  const unsignedTransaction = wrapper?.transaction;
  if (!wrapper?.result?.result || !unsignedTransaction?.txID) throw new Error('TRON_PAYOUT_TRANSACTION_BUILD_FAILED');
  const signedTransaction = await tronWeb.trx.sign(unsignedTransaction, privateKey);
  if (signedTransaction.txID !== unsignedTransaction.txID) throw new Error('TRON_PAYOUT_HASH_MISMATCH');
  return {
    network: 'TRC20', recipient: normalizedRecipient, amount: String(amount), amountUnits: amountUnits.toString(),
    senderAddress, txHash: signedTransaction.txID,
    encryptedPayload: encryptSignedPayload('TRC20', privateKey, { signedTransaction }),
    payloadExpiresAt: new Date(signedTransaction.raw_data.expiration).toISOString()
  };
}

async function preparePayout(withdrawal) {
  const network = String(withdrawal.network || '').toUpperCase();
  const amount = String(withdrawal.netAmount ?? withdrawal.amount ?? '').trim();
  const numericAmount = Number(amount);
  if (network !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > getMaxPayoutAmount()) throw new Error('PAYOUT_AMOUNT_LIMIT');
  return prepareTrc20Payout({ recipient: withdrawal.walletAddress, amount });
}

async function broadcastPreparedPayout(network, encryptedPayload) {
  const normalizedNetwork = String(network || '').toUpperCase();
  if (normalizedNetwork !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  const privateKey = getPrivateKey(normalizedNetwork);
  const payload = decryptSignedPayload(normalizedNetwork, privateKey, encryptedPayload);
  const { endpoints } = createTronWeb(normalizedNetwork, privateKey);
  await tronProvider.withTronWeb(async client => {
    const response = await client.trx.sendRawTransaction(payload.signedTransaction);
    if (response?.result !== true && String(response?.code || '').toUpperCase() !== 'DUP_TRANSACTION_ERROR') throw new Error('TRON_PAYOUT_BROADCAST_NOT_ACCEPTED');
    return response;
  }, { endpoints, privateKey });
  return { accepted: true, txHash: payload.signedTransaction.txID };
}

async function inspectPayout(network, txHash, encryptedPayload) {
  const normalizedNetwork = String(network || '').toUpperCase();
  if (normalizedNetwork !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  const solidityEndpoints = tronProvider.getSolidityEndpoints();
  const payload = decryptSignedPayload(normalizedNetwork, getPrivateKey(normalizedNetwork), encryptedPayload);
  if (String(payload.signedTransaction?.txID || '').toLowerCase() !== String(txHash || '').toLowerCase()) {
    throw new Error('PAYOUT_HASH_MISMATCH');
  }
  const { body: info } = await tronProvider.requestJsonWithFallback(solidityEndpoints, 'walletsolidity/gettransactioninfobyid', {
    timeoutMs: 10000,
    request: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: txHash }) }
  });
  const expiration = Number(payload.signedTransaction.raw_data.expiration);
  if (!info?.id) {
    const rpcEndpoints = tronProvider.getRpcEndpoints();
    // Do not turn provider/network errors into proof that the transaction is absent.
    const observedTransaction = await tronProvider.withTronWeb(client => client.trx.getTransaction(txHash), { endpoints: rpcEndpoints, privateKey: getPrivateKey(normalizedNetwork) });
    return classifyTronConfirmation({ txHash, info, observedTransaction, expiration });
  }
  return classifyTronConfirmation({ txHash, info, expiration });
}

function getMaxBroadcastAttempts() { return MAX_BROADCAST_ATTEMPTS; }

function classifyTronConfirmation({ txHash, info, observedTransaction, expiration, now = Date.now() }) {
  if (info?.id) {
    if (String(info.id).toLowerCase() !== String(txHash).toLowerCase()) throw new Error('TRON_CONFIRMATION_HASH_MISMATCH');
    const block = info.blockNumber === undefined ? {} : { blockNumber: info.blockNumber };
    if (info.receipt?.result === 'SUCCESS') return { state: 'confirmed', ...block };
    if (typeof info.receipt?.result === 'string' && info.receipt.result.trim()) return { state: 'failed', ...block };
    return { state: 'confirming', ...block };
  }
  if (observedTransaction?.txID) {
    if (String(observedTransaction.txID).toLowerCase() !== String(txHash).toLowerCase()) throw new Error('TRON_CONFIRMATION_HASH_MISMATCH');
    return { state: 'confirming' };
  }
  if (!Number.isFinite(expiration) || expiration <= 0) throw new Error('INVALID_SIGNED_PAYOUT_EXPIRATION');
  return now >= expiration + 30 * 60 * 1000 ? { state: 'expired' } : { state: 'pending' };
}

module.exports = {
  parseTokenUnits,
  getMaxPayoutAmount,
  classifyTronConfirmation,
  encryptSignedPayload,
  decryptSignedPayload,
  preparePayout,
  broadcastPreparedPayout,
  inspectPayout,
  getMaxBroadcastAttempts
};
