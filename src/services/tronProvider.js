const { TronWeb } = require('tronweb');
const blockchainService = require('./blockchainService');

const DEFAULT_TRON_ENDPOINT = 'https://api.trongrid.io';

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

function getRpcEndpoints() {
  const config = blockchainService.getBlockchainConfig().TRC20;
  const primary = process.env.TRON_RPC_URL || config.rpcUrl || DEFAULT_TRON_ENDPOINT;
  const configuredFallbacks = parseEndpointList(process.env.TRON_RPC_FALLBACK_URLS);
  const legacyTronGrid = process.env.TRONGRID_API_URL || DEFAULT_TRON_ENDPOINT;
  return uniqueEndpoints([primary, ...configuredFallbacks, legacyTronGrid]);
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
  const endpoints = uniqueEndpoints(options.endpoints || getRpcEndpoints());
  if (!endpoints.length) throw new Error('TRON_RPC_ENDPOINTS_NOT_CONFIGURED');
  let lastError;
  const createClient = options.createClient || createTronWebForEndpoint;
  for (const endpoint of endpoints) {
    try {
      const tronWeb = createClient(endpoint, { privateKey: options.privateKey });
      return await operation(tronWeb, endpoint);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('TRON_RPC_PROVIDERS_UNAVAILABLE');
}

async function requestJsonWithFallback(urls, path, options = {}) {
  const endpoints = uniqueEndpoints(urls);
  if (!endpoints.length) throw new Error('TRON_HTTP_ENDPOINTS_NOT_CONFIGURED');
  const fetcher = options.fetcher || global.fetch;
  let lastError;
  for (const endpoint of endpoints) {
    const url = `${endpoint}/${String(path || '').replace(/^\/+/, '')}`;
    try {
      const response = await fetcher(url, {
        ...options.request,
        headers: headersForEndpoint(endpoint, options.request?.headers || {}),
        signal: options.request?.signal || AbortSignal.timeout(options.timeoutMs || 12000)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`TRON_PROVIDER_HTTP_${response.status}`);
      if (typeof options.validateBody === 'function' && !options.validateBody(body)) throw new Error('TRON_PROVIDER_INVALID_RESPONSE');
      return { body, endpoint };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('TRON_HTTP_PROVIDERS_UNAVAILABLE');
}

module.exports = {
  normalizeEndpoint,
  uniqueEndpoints,
  getRpcEndpoints,
  getIndexerEndpoints,
  getSolidityEndpoints,
  headersForEndpoint,
  createTronWeb,
  createTronWebForEndpoint,
  withTronWeb,
  requestJsonWithFallback
};
