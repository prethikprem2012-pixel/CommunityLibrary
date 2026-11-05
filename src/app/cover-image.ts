const MAX_COVER_WIDTH = 480;
const COVER_JPEG_QUALITY = 0.82;

export function readCoverAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, MAX_COVER_WIDTH / image.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected file could not be read as an image.'));
    };
    image.src = objectUrl;
  });
}
