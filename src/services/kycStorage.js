const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');

const localStorageDir = path.join(__dirname, '..', '..', 'private', 'kyc');
const storageMode = process.env.KYC_STORAGE_MODE || (process.env.VERCEL ? 'gridfs' : 'local');

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { extension: match[1] === 'jpeg' ? 'jpg' : match[1], buffer: Buffer.from(match[2], 'base64') };
}

function getBucket() {
  if (!mongoose.connection.db) throw new Error('KYC storage database is not ready');
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'kyc_documents' });
}

async function store(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  if (storageMode === 'gridfs') {
    const filename = `${crypto.randomBytes(24).toString('hex')}.${parsed.extension}`;
    const bucket = getBucket();
    const fileId = await new Promise((resolve, reject) => {
      const upload = bucket.openUploadStream(filename, { contentType: `image/${parsed.extension}` });
      upload.on('error', reject);
      upload.on('finish', () => resolve(upload.id));
      upload.end(parsed.buffer);
    });
    return `gridfs://${fileId.toString()}`;
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

function getGridFsId(reference) {
  const match = String(reference).match(/^gridfs:\/\/([a-f0-9]{24})$/i);
  return match ? new mongoose.Types.ObjectId(match[1]) : null;
}

function stream(reference, res) {
  const localPath = getLocalPath(reference);
  if (localPath) {
    if (!fs.existsSync(localPath)) return false;
    res.set('Content-Type', path.extname(localPath) === '.png' ? 'image/png' : path.extname(localPath) === '.webp' ? 'image/webp' : 'image/jpeg');
    fs.createReadStream(localPath).pipe(res);
    return true;
  }
  const fileId = getGridFsId(reference);
  if (!fileId) return false;
  const bucket = getBucket();
  const download = bucket.openDownloadStream(fileId);
  download.on('file', file => res.set('Content-Type', file.contentType || 'application/octet-stream'));
  download.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'ملف الوثيقة غير موجود' }); });
  download.pipe(res);
  return true;
}

module.exports = { store, stream };