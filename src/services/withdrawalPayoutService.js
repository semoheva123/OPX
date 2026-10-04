const crypto = require('crypto');
const { Contract, JsonRpcProvider, Wallet, isAddress, keccak256, parseUnits } = require('ethers');
const { TronWeb } = require('tronweb');
const blockchainService = require('./blockchainService');

const TOKEN_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];
const TRANSFER_ABI_V2 = {
  name: 'transfer',
  type: 'function',
  inputs: [{ name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }],
  outputs: [{ name: 'success', type: 'bool' }],
  stateMutability: 'nonpayable'
};
const BSC_CHAIN_ID = 56n;
const DEFAULT_CONFIRMATIONS = 12;
const MAX_BROADCAST_ATTEMPTS = 10;
const MAX_PAYOUT_AMOUNT = Number(process.env.WITHDRAWAL_MAX_SINGLE_USDT || 5000);

function parseTokenUnits(value, decimals) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[2] && match[2].length > decimals)) throw new Error('INVALID_PAYOUT_AMOUNT');
  const units = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] || '').padEnd(decimals, '0') || '0');
  if (units <= 0n || !Number.isFinite(Number(text)) || Number(text) > MAX_PAYOUT_AMOUNT) throw new Error('PAYOUT_AMOUNT_LIMIT');
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

async function prepareBep20Payout({ recipient, amount }) {
  const config = blockchainService.getBlockchainConfig().BEP20;
  if (!config.rpcUrl) throw new Error('BSC_RPC_URL_NOT_CONFIGURED');
  const privateKey = getPrivateKey('BEP20');
  const provider = new JsonRpcProvider(config.rpcUrl, Number(BSC_CHAIN_ID), { staticNetwork: true });
  const wallet = new Wallet(privateKey, provider);
  if (!isAddress(recipient)) throw new Error('INVALID_BEP20_RECIPIENT');
  const recipientAddress = recipient.trim();
  const chain = await provider.getNetwork();
  if (chain.chainId !== BSC_CHAIN_ID) throw new Error('BSC_RPC_WRONG_CHAIN');

  const token = new Contract(config.tokenContract, TOKEN_ABI, wallet);
  const amountUnits = parseTokenUnits(amount, config.decimals);
  const balance = await token.balanceOf(wallet.address);
  if (balance < amountUnits) throw new Error('PAYOUT_TOKEN_BALANCE_INSUFFICIENT');

  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  const gasPrice = feeData.gasPrice;
  const feeFields = maxFeePerGas !== null && maxPriorityFeePerGas !== null
    ? { type: 2, maxFeePerGas, maxPriorityFeePerGas }
    : gasPrice !== null ? { type: 0, gasPrice } : null;
  if (!feeFields) throw new Error('BSC_GAS_PRICE_UNAVAILABLE');
  const maxAllowedGasPrice = parseUnits(String(process.env.BSC_WITHDRAWAL_MAX_GAS_PRICE_GWEI || '10'), 'gwei');
  if ((feeFields.maxFeePerGas || feeFields.gasPrice) > maxAllowedGasPrice) throw new Error('BSC_GAS_PRICE_LIMIT_EXCEEDED');

  const data = token.interface.encodeFunctionData('transfer', [recipientAddress, amountUnits]);
  const estimate = await provider.estimateGas({ from: wallet.address, to: config.tokenContract, data, value: 0n });
  const gasLimit = estimate * 120n / 100n;
  const gasBalance = await provider.getBalance(wallet.address);
  const maxGasPrice = feeFields.maxFeePerGas || feeFields.gasPrice;
  if (gasBalance < gasLimit * maxGasPrice) throw new Error('PAYOUT_NATIVE_GAS_BALANCE_INSUFFICIENT');

  const nonce = await provider.getTransactionCount(wallet.address, 'pending');
  const rawTransaction = await wallet.signTransaction({
    chainId: BSC_CHAIN_ID,
    type: feeFields.type,
    nonce,
    to: config.tokenContract,
    value: 0n,
    data,
    gasLimit,
    ...feeFields
  });
  const txHash = keccak256(rawTransaction);
  return {
    network: 'BEP20', recipient: recipientAddress, amount: String(amount), amountUnits: amountUnits.toString(),
    senderAddress: wallet.address, txHash, encryptedPayload: encryptSignedPayload('BEP20', privateKey, { rawTransaction }),
    payloadExpiresAt: null
  };
}

function createTronWeb(network, privateKey) {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const apiKey = String(process.env.TRONGRID_API_KEY || '').trim();
  const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
  const tronWeb = new TronWeb({ fullHost: config.apiUrl, privateKey, headers });
  if (!tronWeb.isAddress(config.tokenContract)) throw new Error('INVALID_TRON_USDT_CONTRACT');
  return { tronWeb, config };
}

async function prepareTrc20Payout({ recipient, amount }) {
  const privateKey = getPrivateKey('TRC20');
  const { tronWeb, config } = createTronWeb('TRC20', privateKey);
  if (!tronWeb.isAddress(recipient)) throw new Error('INVALID_TRC20_RECIPIENT');
  const normalizedRecipient = tronWeb.address.fromHex(tronWeb.address.toHex(recipient.trim()));
  const amountUnits = parseTokenUnits(amount, config.decimals);
  const senderAddress = tronWeb.defaultAddress.base58;
  const token = await tronWeb.contract().at(config.tokenContract);
  const tokenBalance = BigInt(String(await token.balanceOf(senderAddress).call()));
  if (tokenBalance < amountUnits) throw new Error('PAYOUT_TOKEN_BALANCE_INSUFFICIENT');
  const feeLimit = BigInt(process.env.TRON_WITHDRAWAL_FEE_LIMIT_SUN || '100000000');
  if (feeLimit <= 0n || feeLimit > 1_000_000_000n) throw new Error('TRON_WITHDRAWAL_FEE_LIMIT_INVALID');
  const nativeBalance = BigInt(String(await tronWeb.trx.getBalance(senderAddress)));
  const minimumTrx = BigInt(process.env.TRON_WITHDRAWAL_MIN_TRX_SUN || feeLimit.toString());
  if (nativeBalance < (minimumTrx > feeLimit ? minimumTrx : feeLimit)) throw new Error('PAYOUT_NATIVE_GAS_BALANCE_INSUFFICIENT');

  // Get public reference-block data, then construct/sign locally without ever sending the private key to the RPC.
  const blockHeader = await tronWeb.trx.getCurrentRefBlockParams();
  blockHeader.timestamp = Date.now();
  blockHeader.expiration = blockHeader.timestamp + 60 * 60 * 1000;
  const wrapper = await tronWeb.transactionBuilder.triggerSmartContract(
    config.tokenContract,
    'transfer(address,uint256)',
    {
      feeLimit: Number(feeLimit), callValue: 0, txLocal: true, blockHeader,
      funcABIV2: TRANSFER_ABI_V2, parametersV2: [normalizedRecipient, amountUnits.toString()]
    },
    [],
    senderAddress
  );
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
  const amount = Number(withdrawal.netAmount ?? withdrawal.amount);
  if (network !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYOUT_AMOUNT) throw new Error('PAYOUT_AMOUNT_LIMIT');
  return prepareTrc20Payout({ recipient: withdrawal.walletAddress, amount });
}

async function broadcastPreparedPayout(network, encryptedPayload) {
  const normalizedNetwork = String(network || '').toUpperCase();
  if (normalizedNetwork !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  const privateKey = getPrivateKey(normalizedNetwork);
  const payload = decryptSignedPayload(normalizedNetwork, privateKey, encryptedPayload);
  const { tronWeb } = createTronWeb(normalizedNetwork, privateKey);
  const result = await tronWeb.trx.sendRawTransaction(payload.signedTransaction);
  if (result?.result !== true && String(result?.code || '').toUpperCase() !== 'DUP_TRANSACTION_ERROR') {
    throw new Error('TRON_PAYOUT_BROADCAST_NOT_ACCEPTED');
  }
  return { accepted: true, txHash: payload.signedTransaction.txID };
}

async function inspectPayout(network, txHash, encryptedPayload) {
  const normalizedNetwork = String(network || '').toUpperCase();
  if (normalizedNetwork !== 'TRC20') throw new Error('UNSUPPORTED_WITHDRAWAL_NETWORK');
  if (normalizedNetwork === 'BEP20') {
    const config = blockchainService.getBlockchainConfig().BEP20;
    const provider = new JsonRpcProvider(config.rpcUrl, Number(BSC_CHAIN_ID), { staticNetwork: true });
    const [receipt, transaction] = await Promise.all([provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)]);
    if (!receipt) return { state: 'pending' };
    if (!transaction || transaction.to?.toLowerCase() !== config.tokenContract.toLowerCase()) return { state: 'failed' };
    const tokenInterface = new Contract(config.tokenContract, TOKEN_ABI, provider).interface;
    const parsedTransfer = tokenInterface.parseTransaction({ data: transaction.data });
    if (!parsedTransfer || parsedTransfer.name !== 'transfer') return { state: 'failed' };
    const transferEvent = tokenInterface.getEvent('Transfer');
    const matchingTransfer = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== config.tokenContract.toLowerCase() || log.topics[0]?.toLowerCase() !== transferEvent.topicHash.toLowerCase()) return false;
      try {
        const parsedLog = tokenInterface.parseLog(log);
        return parsedLog.args.to.toLowerCase() === parsedTransfer.args.to.toLowerCase() && parsedLog.args.value === parsedTransfer.args.value;
      } catch { return false; }
    });
    if (!matchingTransfer) return { state: receipt.status === 1 ? 'failed' : 'confirming_failure' };
    const latestBlock = await provider.getBlockNumber();
    const confirmations = latestBlock - receipt.blockNumber + 1;
    if (receipt.status !== 1) {
      return confirmations >= Number(process.env.BSC_WITHDRAWAL_MIN_CONFIRMATIONS || DEFAULT_CONFIRMATIONS)
        ? { state: 'failed', confirmations }
        : { state: 'confirming_failure', confirmations };
    }
    return confirmations >= Number(process.env.BSC_WITHDRAWAL_MIN_CONFIRMATIONS || DEFAULT_CONFIRMATIONS)
      ? { state: 'confirmed', confirmations }
      : { state: 'confirming', confirmations };
  }
  const config = blockchainService.getBlockchainConfig().TRC20;
  const payload = decryptSignedPayload(normalizedNetwork, getPrivateKey(normalizedNetwork), encryptedPayload);
  const apiKey = String(process.env.TRONGRID_API_KEY || '').trim();
  const url = `${String(process.env.TRONGRID_SOLIDITY_API_URL || config.apiUrl).replace(/\/$/, '')}/walletsolidity/gettransactioninfobyid`;
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}) },
    body: JSON.stringify({ value: txHash }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('TRON_CONFIRMATION_PROVIDER_ERROR');
  const info = await response.json();
  if (!info?.id) {
    const tronWeb = createTronWeb(normalizedNetwork, getPrivateKey(normalizedNetwork)).tronWeb;
    const observedTransaction = await tronWeb.trx.getTransaction(txHash).catch(() => null);
    const expiration = Number(payload.signedTransaction.raw_data.expiration);
    if (observedTransaction?.txID && Date.now() < expiration + 30 * 60 * 1000) return { state: 'confirming' };
    if (Date.now() >= expiration) return { state: 'expired' };
    return { state: 'pending' };
  }
  return info.receipt?.result === 'SUCCESS' ? { state: 'confirmed', blockNumber: info.blockNumber } : { state: 'failed', blockNumber: info.blockNumber };
}

function getMaxBroadcastAttempts() { return MAX_BROADCAST_ATTEMPTS; }

module.exports = {
  parseTokenUnits,
  encryptSignedPayload,
  decryptSignedPayload,
  preparePayout,
  broadcastPreparedPayout,
  inspectPayout,
  getMaxBroadcastAttempts
};
