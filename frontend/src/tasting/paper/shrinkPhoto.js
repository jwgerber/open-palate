/**
 * Shrink a phone photo before upload: the server caps each file at 3.5 MB, and a 12 MP shot is
 * several times that. A JPEG that already fits goes through untouched.
 */
const MAX_PASSTHROUGH_BYTES = 3 * 1024 * 1024;

export async function shrinkPhoto(file, { maxEdge = 2000, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === 'image/jpeg' && file.size < MAX_PASSTHROUGH_BYTES) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't prepare the photo."))), 'image/jpeg', quality);
    });
  } finally {
    bitmap.close?.();
  }
}
