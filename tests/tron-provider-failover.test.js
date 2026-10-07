const assert = require('node:assert/strict');
const provider = require('../src/services/tronProvider');

const envKeys = [
  'TRON_RPC_URL', 'TRON_RPC_FALLBACK_URLS', 'TRON_INDEXER_URL', 'TRON_INDEXER_FALLBACK_URLS',
  'TRON_SOLIDITY_API_URL', 'TRON_SOLIDITY_FALLBACK_URLS', 'TRONGRID_SOLIDITY_API_URL',
  'TRONGRID_API_URL', 'TRONGRID_API_KEY'
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

(async () => {
  try {
    process.env.TRON_RPC_URL = 'https://rpc.primary.example/';
    process.env.TRON_RPC_FALLBACK_URLS = 'https://rpc.backup.example, https://rpc.primary.example/';
    process.env.TRON_INDEXER_URL = 'https://indexer.primary.example';
    process.env.TRON_INDEXER_FALLBACK_URLS = 'https://indexer.backup.example';
    process.env.TRON_SOLIDITY_API_URL = 'https://solidity.primary.example';
    process.env.TRON_SOLIDITY_FALLBACK_URLS = '';
    process.env.TRONGRID_API_URL = '';
    process.env.TRONGRID_SOLIDITY_API_URL = '';
    process.env.TRONGRID_API_KEY = 'secret-test-key';

    assert.deepEqual(provider.getRpcEndpoints(), ['https://rpc.primary.example', 'https://rpc.backup.example', 'https://api.trongrid.io']);
    assert.deepEqual(provider.getIndexerEndpoints(), ['https://indexer.primary.example', 'https://indexer.backup.example']);
    assert.deepEqual(provider.getSolidityEndpoints(), ['https://solidity.primary.example']);
    assert.equal(provider.normalizeEndpoint('ftp://not-supported.example'), '');
    assert.equal(provider.headersForEndpoint('https://rpc.primary.example')['TRON-PRO-API-KEY'], undefined, 'do not leak TronGrid secrets to another RPC vendor');
    assert.equal(provider.headersForEndpoint('https://api.trongrid.io')['TRON-PRO-API-KEY'], 'secret-test-key');

    process.env.TRON_RPC_URL = '';
    process.env.TRON_RPC_FALLBACK_URLS = '';
    process.env.TRON_INDEXER_URL = 'https://indexer.only.example';
    process.env.TRON_INDEXER_FALLBACK_URLS = '';
    process.env.TRONGRID_API_URL = '';
    assert.equal(provider.getIndexerEndpoints()[0], 'https://indexer.only.example');
    assert.notEqual(provider.getRpcEndpoints()[0], 'https://indexer.only.example', 'an indexer-only URL must not be silently used as a node RPC endpoint');

    process.env.TRON_RPC_URL = 'https://rpc.primary.example';
    process.env.TRON_RPC_FALLBACK_URLS = 'https://rpc.backup.example';
    process.env.TRON_INDEXER_URL = 'https://indexer.primary.example';
    process.env.TRON_INDEXER_FALLBACK_URLS = 'https://indexer.backup.example';
    process.env.TRONGRID_API_URL = '';
    const requested = [];
    const result = await provider.requestJsonWithFallback(provider.getIndexerEndpoints(), 'v1/accounts/T123/transactions/trc20', {
      fetcher: async (url, options) => {
        requested.push({ url, options });
        if (requested.length === 1) return { ok: true, status: 200, json: async () => ({ error: 'invalid endpoint response' }) };
        return { ok: true, status: 200, json: async () => ({ data: [{ transaction_id: 'confirmed-transfer' }] }) };
      },
      validateBody: body => Array.isArray(body?.data)
    });
    assert.equal(requested.length, 2, 'a failed indexer should fail over only to configured indexer-compatible endpoints');
    assert.equal(requested[0].url, 'https://indexer.primary.example/v1/accounts/T123/transactions/trc20');
    assert.equal(requested[1].url, 'https://indexer.backup.example/v1/accounts/T123/transactions/trc20');
    assert.equal(requested[0].options.headers['TRON-PRO-API-KEY'], undefined);
    assert.equal(result.body.data[0].transaction_id, 'confirmed-transfer');
    assert.equal(result.endpoint, 'https://indexer.backup.example');

    const visitedClients = [];
    const operationResult = await provider.withTronWeb(async (client, endpoint) => {
      visitedClients.push(endpoint);
      if (endpoint.startsWith('https://rpc.primary')) throw new Error('primary unavailable');
      return client.marker;
    }, {
      endpoints: provider.getRpcEndpoints(),
      createClient: endpoint => ({ marker: `connected:${endpoint}` })
    });
    assert.deepEqual(visitedClients, ['https://rpc.primary.example', 'https://rpc.backup.example']);
    assert.equal(operationResult, 'connected:https://rpc.backup.example');

    await assert.rejects(provider.requestJsonWithFallback([], 'wallet/getnowblock', { fetcher: async () => ({}) }), /TRON_HTTP_ENDPOINTS_NOT_CONFIGURED/);
    console.log('TRON provider separation and failover tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
})();
