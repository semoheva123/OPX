// Run only on a trusted offline machine. The mnemonic is read without echo and is never printed or saved.
const { HDNodeWallet } = require('ethers');

const TRON_ACCOUNT_PATH = "m/44'/195'/0'/0";

function readHiddenMnemonic() {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Run this script in an interactive terminal; do not pass the mnemonic as a command-line argument.'));
      return;
    }
    let mnemonic = '';
    process.stdout.write('Enter the recovery phrase for a NEW, dedicated TRON deposit wallet (input hidden): ');
    input.setRawMode(true);
    input.resume();
    input.on('data', chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          input.setRawMode(false);
          process.stdout.write('\nCancelled.\n');
          process.exit(130);
        }
        if (character === '\r' || character === '\n') {
          input.setRawMode(false);
          input.pause();
          input.removeAllListeners('data');
          process.stdout.write('\n');
          resolve(mnemonic.trim().replace(/\s+/g, ' '));
          return;
        }
        if (character === '\u007f' || character === '\b') mnemonic = mnemonic.slice(0, -1);
        else if (/^[a-zA-Z ]$/.test(character)) mnemonic += character;
      }
    });
  });
}

(async () => {
  let mnemonic = await readHiddenMnemonic();
  try {
    const accountNode = HDNodeWallet.fromPhrase(mnemonic, undefined, TRON_ACCOUNT_PATH);
    const xpub = accountNode.neuter().extendedKey;
    if (!xpub || !/^(xpub|tpub)/.test(xpub)) throw new Error('Unexpected extended public key format');
    process.stdout.write(`TRON deposit xpub (public key; configure as TRON_DEPOSIT_XPUB):\n${xpub}\n`);
    process.stdout.write('The recovery phrase/private key was not printed. Keep it offline for recovery and fund sweeping.\n');
  } finally {
    mnemonic = '';
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
