const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const localStorageDir = path.join(__dirname, '..', '..', 'private', 'kyc');
const storageMode = process.env.KYC_STORAGE_MODE || 'local';

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { extension: match[1] === 'jpeg' ? 'jpg' : match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function store(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;

  if (storageMode !== 'local') {
    console.warn('KYC storage is forced to local private storage.');
  }

  await fs.promises.mkdir(localStorageDir, { recursive: true, mode: 0o700 });
  const filename = `${crypto.randomBytes(32).toString('hex')}.${parsed.extension}`;
  await fs.promises.writeFile(path.join(localStorageDir, filename), parsed.buffer, { mode: 0o600 });
  return `private://${filename}`;
}

function getLocalPath(reference) {
  const match = String(reference).match(/^private:\/\/([a-f0-9]{64}\.(?:jpg|png|webp))$/i);
  return match ? path.join(localStorageDir, match[1]) : null;
}

function stream(reference, res) {
  const localPath = getLocalPath(reference);
  if (!localPath) return false;

  if (!fs.existsSync(localPath)) return false;
  res.set('Content-Type', path.extname(localPath) === '.png' ? 'image/png' : path.extname(localPath) === '.webp' ? 'image/webp' : 'image/jpeg');
  fs.createReadStream(localPath).pipe(res);
  return true;
}

module.exports = { store, stream };