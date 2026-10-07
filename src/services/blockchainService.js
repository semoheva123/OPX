const blockchainConfig = {
  TRC20: {
    decimals: 6,
    tokenContract: process.env.TRON_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    rpcUrl: (process.env.TRON_RPC_URL || process.env.TRONGRID_API_URL || 'https://api.trongrid.io').replace(/\/$/, ''),
    indexerUrl: (process.env.TRON_INDEXER_URL || process.env.TRONGRID_API_URL || 'https://api.trongrid.io').replace(/\/$/, ''),
    solidityApiUrl: (process.env.TRON_SOLIDITY_API_URL || process.env.TRONGRID_SOLIDITY_API_URL || process.env.TRONGRID_API_URL || 'https://api.trongrid.io').replace(/\/$/, ''),
    // Backwards compatibility for code or operations scripts using the old shared endpoint.
    apiUrl: (process.env.TRON_INDEXER_URL || process.env.TRONGRID_API_URL || 'https://api.trongrid.io').replace(/\/$/, '')
  },
  BEP20: {
    decimals: 18,
    tokenContract: process.env.BSC_USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955',
    rpcUrl: process.env.BSC_RPC_URL,
    minConfirmations: Number(process.env.BSC_MIN_CONFIRMATIONS || 12)
  }
};

module.exports = { getBlockchainConfig: () => blockchainConfig };
