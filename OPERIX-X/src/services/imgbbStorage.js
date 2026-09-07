const allowedImageHosts = new Set(['ibb.co', 'www.ibb.co', 'i.ibb.co', 'imgbb.com', 'www.imgbb.com']);

function isImgBbUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && allowedImageHosts.has(url.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

async function uploadDataUrl(dataUrl) {
  const image = String(dataUrl || '').trim();
  if (!process.env.IMGBB_API_KEY) throw Object.assign(new Error('IMGBB_NOT_CONFIGURED'), { statusCode: 503 });
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)) throw Object.assign(new Error('INVALID_IMAGE'), { statusCode: 400 });
  const form = new FormData();
  form.append('image', image.split(',')[1]);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, { method: 'POST', body: form });
  const data = await response.json();
  const url = String(data.data?.url || '').trim();
  if (!response.ok || !data.success || !isImgBbUrl(url)) throw Object.assign(new Error('IMGBB_UPLOAD_FAILED'), { statusCode: 502 });
  return url;
}

function validateUrl(value) {
  return isImgBbUrl(value) ? String(value).trim().slice(0, 500) : '';
}

module.exports = { uploadDataUrl, validateUrl, isImgBbUrl };
