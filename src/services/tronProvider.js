const { TronWeb } = require('tronweb');
const blockchainService = require('./blockchainService');

const DEFAULT_TRON_ENDPOINT = 'https://api.trongrid.io';
const PROVIDER_COOLDOWN_MS = Math.max(5000, Number(process.env.TRON_PROVIDER_COOLDOWN_MS) || 30000);
const providerCooldowns = new Map();
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
  return uniqueEndpoints([primary, ...parseEndpointList(process.env.TRON_INDEXER_FALLBACK_URLS)]);
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
  let lastError;
  for (const endpoint of endpoints) {
    const url = `${endpoint}/${String(path || '').replace(/^\/+/, '')}`;
    try {
      const request = {
        ...options.request,
        headers: headersForEndpoint(endpoint, options.request?.headers || {}),
        signal: options.request?.signal || AbortSignal.timeout(options.timeoutMs || 12000)
      };
      let response = await fetcher(url, request);
      if ((response.status === 401 || response.status === 403) && request.headers['TRON-PRO-API-KEY']) {
        const publicHeaders = { ...request.headers };
        delete publicHeaders['TRON-PRO-API-KEY'];
        response = await fetcher(url, { ...request, headers: publicHeaders });
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`TRON_PROVIDER_HTTP_${response.status}`);
      if (body?.Error || (body?.success === false && body?.error) || body?.error) throw new Error(`TRON_PROVIDER_RESPONSE_ERROR:${String(body.Error || body.error).slice(0, 180)}`);
      if (typeof options.validateBody === 'function' && !options.validateBody(body)) throw new Error('TRON_PROVIDER_INVALID_RESPONSE');
      noteProviderSuccess(endpoint);
      return { body, endpoint };
    } catch (error) {
      lastError = error;
      noteProviderFailure(endpoint, error);
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
  getSolidityEndpoints,
  headersForEndpoint,
  createTronWeb,
  createTronWebForEndpoint,
  withTronWeb,
  requestJsonWithFallback
};
