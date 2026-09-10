const blockchainConfig = {
  TRC20: {
    decimals: 6,
    tokenContract: process.env.TRON_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    depositAddress: process.env.PLATFORM_TRON_DEPOSIT_ADDRESS,
    apiUrl: (process.env.TRONGRID_API_URL || 'https://api.trongrid.io').replace(/\/$/, '')
  },
  BEP20: {
    decimals: 18,
    tokenContract: process.env.BSC_USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955',
    depositAddress: process.env.PLATFORM_BSC_DEPOSIT_ADDRESS,
    rpcUrl: process.env.BSC_RPC_URL,
    minConfirmations: Number(process.env.BSC_MIN_CONFIRMATIONS || 12)
  }
};

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(`Blockchain API returned HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function parseTokenUnits(value, decimals) {
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2] && match[2].length > decimals)) throw new Error('Invalid token amount');
  return BigInt(match[1]) * (10n ** BigInt(decimals)) +
    BigInt((match[2] || '').padEnd(decimals, '0') || '0');
}

function normalizeDepositRequest(amount, network, txHash) {
  const normalizedNetwork = String(network || '').trim().toUpperCase();
  const normalizedHash = String(txHash || '').trim();
  const config = blockchainConfig[normalizedNetwork];
  if (!config || !config.depositAddress) throw new Error('Unsupported or unconfigured deposit network');
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !/^\d+(?:\.\d+)?$/.test(String(amount).trim())) {
    throw new Error('Invalid deposit amount');
  }
  if (!normalizedHash || (normalizedNetwork === 'TRC20' && !/^[a-f\d]{64}$/i.test(normalizedHash)) ||
      (normalizedNetwork === 'BEP20' && !/^0x[a-f\d]{64}$/i.test(normalizedHash))) {
    throw new Error('Invalid transaction hash');
  }
  return { amount: Number(amount), amountUnits: parseTokenUnits(amount, config.decimals), network: normalizedNetwork, txHash: normalizedHash, config };
}

async function verifyTronDeposit(request) {
  const headers = process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : {};
  const transaction = await fetchJson(`${request.config.apiUrl}/v1/transactions/${request.txHash}`, { headers });
  if (!transaction.ret?.some(result => result.contractRet === 'SUCCESS')) throw new Error('TRON transaction is not successful');
  const events = await fetchJson(`${request.config.apiUrl}/v1/transactions/${request.txHash}/events?only_confirmed=true&event_name=Transfer&limit=200&contract_address=${request.config.tokenContract}`, { headers });
  const transfer = (events.data || []).find(event => event.transaction_id === request.txHash && event.contract_address === request.config.tokenContract && event.result?.to === request.config.depositAddress);
  if (!transfer || BigInt(transfer.result.value) !== request.amountUnits) throw new Error('TRON transfer recipient or amount does not match');
}

async function bscRpcCall(rpcUrl, method, params) {
  const body = await fetchJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
  if (body.error || body.result === null) throw new Error(body.error?.message || `BSC RPC failed: ${method}`);
  return body.result;
}

async function verifyBscDeposit(request) {
  if (!request.config.rpcUrl) throw new Error('BSC_RPC_URL is not configured');
  const [transaction, receipt] = await Promise.all([
    bscRpcCall(request.config.rpcUrl, 'eth_getTransactionByHash', [request.txHash]),
    bscRpcCall(request.config.rpcUrl, 'eth_getTransactionReceipt', [request.txHash])
  ]);
  if (!transaction || !receipt || receipt.status !== '0x1' || !receipt.blockNumber) throw new Error('BSC transaction is not confirmed successfully');
  if (transaction.to?.toLowerCase() !== request.config.tokenContract.toLowerCase()) throw new Error('BSC transaction was not sent to the configured token contract');
  const latestBlock = await bscRpcCall(request.config.rpcUrl, 'eth_blockNumber', []);
  if (BigInt(latestBlock) - BigInt(receipt.blockNumber) + 1n < BigInt(request.config.minConfirmations)) throw new Error('BSC transaction does not have enough confirmations');
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const transfer = (receipt.logs || []).find(log => log.address?.toLowerCase() === request.config.tokenContract.toLowerCase() && log.topics?.[0]?.toLowerCase() === transferTopic && log.topics?.[2] && `0x${log.topics[2].slice(-40)}`.toLowerCase() === request.config.depositAddress.toLowerCase());
  if (!transfer || BigInt(transfer.data) !== request.amountUnits) throw new Error('BSC transfer recipient or amount does not match');
}

async function verifyDeposit(amount, network, txHash) {
  const request = normalizeDepositRequest(amount, network, txHash);
  if (request.network === 'TRC20') await verifyTronDeposit(request);
  else await verifyBscDeposit(request);
  return request;
}

function getDepositAddresses() {
  return { TRC20: blockchainConfig.TRC20.depositAddress || null, BEP20: blockchainConfig.BEP20.depositAddress || null };
}

module.exports = { verifyDeposit, getDepositAddresses };
