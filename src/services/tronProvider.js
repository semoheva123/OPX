const { TronWeb } = require('tronweb');
const blockchainService = require('./blockchainService');

const DEFAULT_TRON_ENDPOINT = 'https://api.trongrid.io';
const DEFAULT_TRONSCAN_INDEXER = 'https://apilist.tronscanapi.com';
const PROVIDER_COOLDOWN_MS = Math.max(5000, Number(process.env.TRON_PROVIDER_COOLDOWN_MS) || 30000);
const providerCooldowns = new Map();
const providerRequestTimes = new Map();
const PUBLIC_RPC_PROVIDERS = Object.freeze([
  { id: 'trongrid', label: 'TronGrid Mainnet HTTP', url: DEFAULT_TRON_ENDPOINT, freePublic: true, supportsNativeHttp: true },
  { id: 'publicnode', label: 'PublicNode TRON Mainnet HTTP', url: 'https://tron-rpc.publicnode.com', freePublic: true, supportsNativeHttp: true },
  { id: 'ankr', label: 'Ankr TRON REST endpoint', env: 'TRON_ANKR_RPC_URL', freePublic: false, supportsNativeHttp: true }
]);

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim().replace(/\/+$/, '');
  if (!endpoint) return '';
  try {
    const parsed = new URL(endpoint);
    return ['http:', 'https:'].includes(parsed.protocol) ? endpoint : '';
  } catch {
    return '';
  }
}

function uniqueEndpoints(values) {
  return [...new Set(values.map(normalizeEndpoint).filter(Boolean))];
}

function parseEndpointList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function isTransientProviderError(error) {
  return /TRON_PROVIDER_HTTP_(?:429|5\d\d)|429|rate.?limit|frequency.?limit|quota|computing resources|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|TRON_PROVIDER_INVALID_RESPONSE/i.test(String(error?.message || error || ''));
}

function orderedAvailableEndpoints(endpoints) {
  const unique = uniqueEndpoints(endpoints);
  const now = Date.now();
  return unique
    .map((endpoint, index) => ({ endpoint, index, unavailableUntil: providerCooldowns.get(endpoint) || 0 }))
    .sort((left, right) => {
      const leftCooling = left.unavailableUntil > now;
      const rightCooling = right.unavailableUntil > now;
      return Number(leftCooling) - Number(rightCooling) || left.index - right.index;
    })
    .map(item => item.endpoint);
}

function noteProviderSuccess(endpoint) {
  providerCooldowns.delete(endpoint);
}

function noteProviderFailure(endpoint, error) {
  if (isTransientProviderError(error)) providerCooldowns.set(endpoint, Date.now() + PROVIDER_COOLDOWN_MS);
}

function getRetryDelayMs(response, retryIndex) {
  const retryAfter = response?.headers?.get?.('retry-after');
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return Math.min(5000, retryAfterSeconds * 1000);
  const retryAfterDate = Date.parse(String(retryAfter || ''));
  if (Number.isFinite(retryAfterDate)) return Math.min(5000, Math.max(0, retryAfterDate - Date.now()));
  return Math.min(3000, 1000 * (retryIndex + 1));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function paceIndexerEndpoint(endpoint, options = {}) {
  let hostname = '';
  try { hostname = new URL(endpoint).hostname.toLowerCase(); } catch { }
  if (hostname !== 'apilist.tronscanapi.com') return;
  const configuredInterval = Number(options.tronscanMinIntervalMs ?? process.env.TRONSCAN_MIN_REQUEST_INTERVAL_MS);
  const minIntervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 0
    ? Math.min(10000, configuredInterval)
    : 1500;
  const lastRequestAt = providerRequestTimes.get(endpoint) || 0;
  const waitMs = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
  if (waitMs > 0) await delay(waitMs);
  providerRequestTimes.set(endpoint, Date.now());
}

function getRpcEndpoints() {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const primary = process.env.TRON_RPC_URL || config.rpcUrl || DEFAULT_TRON_ENDPOINT;
  const configuredFallbacks = parseEndpointList(process.env.TRON_RPC_FALLBACK_URLS);
  const providerDefaults = PUBLIC_RPC_PROVIDERS
    .filter(provider => provider.id !== 'ankr')
    .map(provider => provider.url);
  const configuredAnkr = String(process.env.TRON_ANKR_RPC_URL || '').trim();
  return uniqueEndpoints([primary, ...configuredFallbacks, ...providerDefaults, configuredAnkr]);
}

function getIndexerEndpoints() {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const primary = process.env.TRON_INDEXER_URL || config.indexerUrl || DEFAULT_TRON_ENDPOINT;
  return uniqueEndpoints([primary, ...parseEndpointList(process.env.TRON_INDEXER_FALLBACK_URLS), DEFAULT_TRONSCAN_INDEXER]);
}

function buildIndexerRequest(endpoint, path) {
  const parsedPath = new URL(String(path || '').replace(/^\/+/, ''), 'https://trongrid.invalid');
  let hostname = '';
  try { hostname = new URL(endpoint).hostname.toLowerCase(); } catch { }
  if (hostname !== 'apilist.tronscanapi.com') return { url: `${endpoint}/${String(path || '').replace(/^\/+/, '')}` };

  const match = parsedPath.pathname.match(/^\/v1\/accounts\/([^/]+)\/transactions\/trc20$/);
  if (!match) return { url: `${endpoint}/${String(path || '').replace(/^\/+/, '')}` };
  const source = parsedPath.searchParams;
  const pageSize = Math.min(200, Math.max(1, Number(source.get('limit')) || 200));
  const offset = Math.max(0, Number(source.get('fingerprint')) || 0);
  const contractAddress = source.get('contract_address') || '';
  const timestampOrder = source.get('order_by') || 'block_timestamp,desc';
  const sort = timestampOrder.endsWith(',asc') ? 'timestamp' : '-timestamp';
  const url = new URL('/api/token_trc20/transfers', endpoint);
  url.search = new URLSearchParams({
    limit: String(pageSize),
    start: String(offset),
    sort,
    count: 'true',
    relatedAddress: decodeURIComponent(match[1]),
    ...(contractAddress ? { contract_address: contractAddress } : {}),
    ...(source.has('min_timestamp') ? { start_timestamp: source.get('min_timestamp') } : {})
  }).toString();
  return { url: url.toString(), pageSize, offset, tronscan: true };
}

function normalizeIndexerBody(body, request) {
  if (!request.tronscan) return body;
  const transfers = Array.isArray(body?.token_transfers) ? body.token_transfers : [];
  const data = transfers
    .filter(transfer => transfer?.confirmed === true && String(transfer.contractRet || '').toUpperCase() === 'SUCCESS' && String(transfer.event_type || '').toLowerCase() === 'transfer')
    .map(transfer => ({
      transaction_id: transfer.transaction_id,
      from: transfer.from_address,
      to: transfer.to_address,
      value: String(transfer.quant ?? ''),
      block_timestamp: Number(transfer.block_ts || 0),
      contract_address: transfer.contract_address,
      token_info: { address: transfer.contract_address },
      event_index: 0
    }));
  const hasMore = transfers.length >= request.pageSize;
  return { data, meta: { fingerprint: hasMore ? String(request.offset + transfers.length) : '' } };
}

function getSolidityEndpoints() {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const primary = process.env.TRON_SOLIDITY_API_URL || process.env.TRONGRID_SOLIDITY_API_URL || config.solidityApiUrl || DEFAULT_TRON_ENDPOINT;
  return uniqueEndpoints([primary, ...parseEndpointList(process.env.TRON_SOLIDITY_FALLBACK_URLS)]);
}

function headersForEndpoint(endpoint, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const apiKey = String(process.env.TRONGRID_API_KEY || '').trim();
  if (!apiKey) return headers;
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    const isTronGridHost = host === 'trongrid.io' || host.endsWith('.trongrid.io');
    if (isTronGridHost) headers['TRON-PRO-API-KEY'] = apiKey;
  } catch {
    // Invalid provider URLs are filtered before requests are made.
  }
  return headers;
}

function createTronWebForEndpoint(endpoint, { privateKey } = {}) {
  return new TronWeb({ fullHost: endpoint, ...(privateKey ? { privateKey } : {}), headers: headersForEndpoint(endpoint) });
}

function createTronWeb(options = {}) {
  const endpoint = getRpcEndpoints()[0];
  if (!endpoint) throw new Error('TRON_RPC_ENDPOINTS_NOT_CONFIGURED');
  return createTronWebForEndpoint(endpoint, options);
}

async function withTronWeb(operation, options = {}) {
  const endpoints = orderedAvailableEndpoints(options.endpoints || getRpcEndpoints());
  if (!endpoints.length) throw new Error('TRON_RPC_ENDPOINTS_NOT_CONFIGURED');
  let lastError;
  const createClient = options.createClient || createTronWebForEndpoint;
  for (const endpoint of endpoints) {
    try {
      const tronWeb = createClient(endpoint, { privateKey: options.privateKey });
      const result = await operation(tronWeb, endpoint);
      noteProviderSuccess(endpoint);
      return result;
    } catch (error) {
      lastError = error;
      noteProviderFailure(endpoint, error);
    }
  }
  throw lastError || new Error('TRON_RPC_PROVIDERS_UNAVAILABLE');
}

async function requestJsonWithFallback(urls, path, options = {}) {
  const endpoints = orderedAvailableEndpoints(urls);
  if (!endpoints.length) throw new Error('TRON_HTTP_ENDPOINTS_NOT_CONFIGURED');
  const fetcher = options.fetcher || global.fetch;
  const maxRateLimitRetries = Math.max(0, Math.min(3, Number(options.maxRateLimitRetries ?? 2) || 0));
  let lastError;
  for (const endpoint of endpoints) {
    const providerRequest = buildIndexerRequest(endpoint, path);
    const url = providerRequest.url;
    for (let retryIndex = 0; retryIndex <= maxRateLimitRetries; retryIndex++) {
      let response;
      try {
        await paceIndexerEndpoint(endpoint, options);
        const request = {
          ...options.request,
          headers: headersForEndpoint(endpoint, options.request?.headers || {}),
          signal: options.request?.signal || AbortSignal.timeout(options.timeoutMs || 12000)
        };
        response = await fetcher(url, request);
        if ((response.status === 401 || response.status === 403) && request.headers['TRON-PRO-API-KEY']) {
          const publicHeaders = { ...request.headers };
          delete publicHeaders['TRON-PRO-API-KEY'];
          response = await fetcher(url, { ...request, headers: publicHeaders });
        }
        if (response.status === 429 && retryIndex < maxRateLimitRetries) {
          await delay(getRetryDelayMs(response, retryIndex));
          continue;
        }
        const rawBody = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`TRON_PROVIDER_HTTP_${response.status}`);
        const body = normalizeIndexerBody(rawBody, providerRequest);
        if (body?.Error || (body?.success === false && body?.error) || body?.error) throw new Error(`TRON_PROVIDER_RESPONSE_ERROR:${String(body.Error || body.error).slice(0, 180)}`);
        if (typeof options.validateBody === 'function' && !options.validateBody(body)) throw new Error('TRON_PROVIDER_INVALID_RESPONSE');
        noteProviderSuccess(endpoint);
        return { body, endpoint };
      } catch (error) {
        lastError = error;
        noteProviderFailure(endpoint, error);
        break;
      }
    }
  }
  throw lastError || new Error('TRON_HTTP_PROVIDERS_UNAVAILABLE');
}

module.exports = {
  PUBLIC_RPC_PROVIDERS,
  normalizeEndpoint,
  uniqueEndpoints,
  isTransientProviderError,
  getRpcEndpoints,
  getIndexerEndpoints,
  buildIndexerRequest,
  normalizeIndexerBody,
  paceIndexerEndpoint,
  getSolidityEndpoints,
  headersForEndpoint,
  createTronWeb,
  createTronWebForEndpoint,
  withTronWeb,
  requestJsonWithFallback
};
