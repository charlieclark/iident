"use client";

/**
 * Uploads go through a serverless function, which accepts at most 4.5 MB per
 * request, and a phone photo is often larger. The server only keeps a
 * 1024 px selfie (1600 px backdrop) anyway, so big pictures are scaled down
 * in the browser first. Small ones are sent as they are.
 */
const SEND_AS_IS_BYTES = 1_500_000;

export async function shrinkImage(file: Blob, maxSide: number): Promise<Blob> {
  if (file.size <= SEND_AS_IS_BYTES) return file;
  try {
    // Applies the photo's EXIF orientation, which the re-encoded picture no longer carries.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return jpeg && jpeg.size < file.size ? jpeg : file;
  } catch {
    // A format the browser can't decode: let the server have a go at the original.
    return file;
  }
}
