// Shrinks a photo in the browser before it is uploaded. Phone cameras take pictures of 4 to 8 MB, far over the
// upload limit (2 MB by default), and a shop does not need more than about 1600 pixels. A smaller picture also loads
// faster for customers on a slow connection.
//
// It never makes things worse: if the browser cannot do it, or the result is not smaller, the original is used.
// GIFs and anything that is not a JPEG, PNG or WEBP are left alone.

const SHRINKABLE = /^image\/(jpeg|png|webp)$/i;

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' }); // keeps a phone photo the right way up
  } catch {
    return createImageBitmap(file); // an older browser that does not know the option
  }
}

export async function prepareImage(file, { maxEdge = 1600, quality = 0.82, leaveAloneBelow = 300 * 1024 } = {}) {
  try {
    if (!file || !SHRINKABLE.test(file.type || '')) return file;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    const bitmap = await decode(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= leaveAloneBelow) { if (bitmap.close) bitmap.close(); return file; }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { if (bitmap.close) bitmap.close(); return file; }
    ctx.fillStyle = '#ffffff'; // a transparent PNG becomes white rather than black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || (scale === 1 && blob.size >= file.size)) return file;
    const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
