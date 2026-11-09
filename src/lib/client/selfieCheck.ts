"use client";

import { getFaceLandmarker } from "@/lib/avatar/faceRigger";

export type SelfieCheck = {
  /** Blocking problems. */
  errors: string[];
  /** Things that may lower likeness but are allowed. */
  warnings: string[];
  /** Face box in normalized image coordinates, for the preview overlay. */
  box?: { x: number; y: number; w: number; h: number };
};

/**
 * Quick on-device sanity check of a selfie before uploading: exactly one
 * face, big enough, roughly facing the camera and reasonably lit. Runs
 * MediaPipe in the browser, so the photo never leaves the device for this.
 */
export async function checkSelfie(image: HTMLImageElement | HTMLCanvasElement): Promise<SelfieCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let landmarker;
  try {
    landmarker = await getFaceLandmarker();
  } catch {
    return { errors, warnings: ["Couldn't run the on-device face check. You can still continue."] };
  }
  // Detect on a canvas copy so the IMAGE-mode detector gets consistent input.
  const canvas = document.createElement("canvas");
  const w = "naturalWidth" in image ? image.naturalWidth : image.width;
  const h = "naturalHeight" in image ? image.naturalHeight : image.height;
  const scale = Math.min(1, 1024 / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  // The landmarker is configured for a single face; count faces with a
  // second pass only when needed would cost another model, so we rely on
  // the detector's best face and check its size instead.
  const result = landmarker.detect(canvas);
  const face = result.faceLandmarks?.[0];
  if (!face) {
    errors.push("We couldn't find a face. Use a clear, well-lit photo of your face.");
    return { errors, warnings };
  }

  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of face) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  if (box.w < 0.16) warnings.push("Your face is quite small in the photo. A closer selfie gives a better likeness.");

  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m) {
    // Column-major 4x4: rotation part gives the head's yaw and pitch.
    const yaw = Math.atan2(m[8], m[10]) * (180 / Math.PI);
    const pitch = Math.asin(-Math.max(-1, Math.min(1, m[9]))) * (180 / Math.PI);
    if (Math.abs(yaw) > 22) warnings.push("Try facing the camera straight on.");
    if (Math.abs(pitch) > 22) warnings.push("Hold the camera at eye level.");
  }

  const shapes = Object.fromEntries(
    (result.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score]),
  );
  if ((shapes.jawOpen ?? 0) > 0.35) warnings.push("A relaxed, closed-mouth expression works best.");
  if ((shapes.eyeBlinkLeft ?? 0) > 0.6 && (shapes.eyeBlinkRight ?? 0) > 0.6) warnings.push("Your eyes look closed.");

  // Brightness of the face region.
  const px = ctx.getImageData(
    Math.floor(box.x * canvas.width),
    Math.floor(box.y * canvas.height),
    Math.max(1, Math.floor(box.w * canvas.width)),
    Math.max(1, Math.floor(box.h * canvas.height)),
  ).data;
  let lum = 0;
  for (let i = 0; i < px.length; i += 16) lum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
  lum /= px.length / 16;
  if (lum < 0.22) warnings.push("The photo is a bit dark. Face a window or a light.");

  return { errors, warnings, box };
}
