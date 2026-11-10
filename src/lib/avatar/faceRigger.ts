"use client";

import * as THREE from "three";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { EyeRig, FaceRig, Vec3 } from "./types";

/**
 * Finds the face on a generated character so it can be animated.
 *
 * The rigged mesh is posed in bind pose, its head is rendered head-on
 * (unlit, so colours are pure albedo) and MediaPipe Face Landmarker runs on
 * that render. Each 2D landmark is raycast back onto the mesh and converted
 * to the mesh's geometry space with barycentric coordinates, which is where
 * the FaceDriver builds its morph targets. If no face is detected, a
 * proportional fallback keeps the avatar talking.
 */

const MEDIAPIPE_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function getFaceLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  })();
  landmarkerPromise.catch(() => (landmarkerPromise = null));
  return landmarkerPromise;
}

// MediaPipe face mesh indices. "A" is the eye/corner on the image's left,
// which is the character's right side.
const LM = {
  innerUpper: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  innerLower: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  outerUpper: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  outerLower: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  chin: 152,
  noseTip: 1,
  eyeA: { inner: 133, outer: 33, upper: [173, 157, 158, 159, 160, 161, 246], lower: [155, 154, 153, 145, 144, 163, 7], brow: [107, 66, 105, 63, 70], lid: [56, 28, 27, 29] },
  eyeB: { inner: 362, outer: 263, upper: [398, 384, 385, 386, 387, 388, 466], lower: [382, 381, 380, 374, 373, 390, 249], brow: [336, 296, 334, 293, 300], lid: [286, 258, 257, 259] },
  cheeks: [50, 280, 101, 330, 123, 352],
  lips: [0, 17, 37, 267, 84, 314],
};

const asSkinned = (m: THREE.Mesh) => ((m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh) : null);

/**
 * The mesh that carries the face: the largest skinned mesh of a rigged
 * character, or the largest plain mesh of a head-and-shoulders model, which
 * has no skeleton.
 */
export function findCharacterMesh(root: THREE.Object3D): THREE.Mesh | null {
  let best: THREE.Mesh | null = null;
  const count = (m: THREE.Mesh) => (m.geometry as THREE.BufferGeometry).attributes.position.count;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const better = !best || (!!asSkinned(m) && !asSkinned(best)) || (!!asSkinned(m) === !!asSkinned(best) && count(m) > count(best));
    if (better) best = m;
  });
  return best;
}

type Baked = {
  mesh: THREE.Mesh;
  headBox: THREE.Box3;
  forward: THREE.Vector3;
};

/**
 * Rest-pose world positions in a plain mesh that can be rendered and raycast.
 * Must run while the skeleton is in its rest pose (see AvatarPlayer.withRestPose).
 * Note: Skeleton.pose() is deliberately not used; it corrupts bone scales when
 * the root bone's parent carries a transform, as Meshy's 0.01-scaled armature does.
 */
function bake(source: THREE.Mesh): Baked {
  source.updateMatrixWorld(true);
  const skinned = asSkinned(source);
  const geo = source.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position;
  const baked = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const bones = skinned?.skeleton.bones ?? [];
  const headIndex = bones.findIndex((b) => /^head$/i.test(b.name) || /(^|[^a-z])head$/i.test(b.name));
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const headBox = new THREE.Box3();
  const fullBox = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) {
    if (skinned) skinned.getVertexPosition(i, v);
    else v.fromBufferAttribute(pos, i);
    v.applyMatrix4(source.matrixWorld);
    baked.set([v.x, v.y, v.z], i * 3);
    fullBox.expandByPoint(v);
    if (headIndex >= 0 && si && sw) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === headIndex) w += sw.getComponent(i, k);
      if (w > 0.5) headBox.expandByPoint(v);
    }
  }
  const fullSize = fullBox.getSize(new THREE.Vector3());
  if (headBox.isEmpty() && !skinned && fullSize.y < fullSize.x * 1.4) {
    // A head-and-shoulders model: the head is the upper, central part. This
    // only needs to get the face into view; the view is then tightened
    // around the face that is found.
    const cx = (fullBox.min.x + fullBox.max.x) / 2;
    headBox.set(
      new THREE.Vector3(cx - fullSize.y * 0.32, fullBox.max.y - fullSize.y * 0.66, fullBox.min.z),
      new THREE.Vector3(cx + fullSize.y * 0.32, fullBox.max.y, fullBox.max.z),
    );
  }
  if (headBox.isEmpty()) {
    const h = fullBox.max.y - fullBox.min.y;
    headBox.set(
      new THREE.Vector3(fullBox.min.x, fullBox.max.y - h * 0.14, fullBox.min.z),
      fullBox.max.clone(),
    );
    // narrow the fallback to the central column
    const cx = (fullBox.min.x + fullBox.max.x) / 2;
    headBox.min.x = cx - h * 0.08;
    headBox.max.x = cx + h * 0.08;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(baked, 3));
  if (geo.attributes.uv) g.setAttribute("uv", geo.attributes.uv);
  if (geo.index) g.setIndex(geo.index);
  g.computeBoundingSphere();
  g.computeBoundingBox();

  const srcMat = (Array.isArray(source.material) ? source.material[0] : source.material) as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshBasicMaterial({ map: srcMat.map ?? null, color: srcMat.map ? 0xffffff : srcMat.color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);

  // Facing direction: Meshy rigs carry a "headfront" helper bone; fall back to +Z.
  const forward = new THREE.Vector3(0, 0, 1);
  const head = headIndex >= 0 ? bones[headIndex] : null;
  const front = bones.find((b) => /headfront/i.test(b.name));
  if (head && front) {
    const a = head.getWorldPosition(new THREE.Vector3());
    const b = front.getWorldPosition(new THREE.Vector3());
    const d = b.sub(a);
    d.y = 0;
    if (d.lengthSq() > 1e-8) forward.copy(d.normalize());
  }
  return { mesh, headBox, forward };
}

const SIZE = 768;

type View = { center: THREE.Vector3; half: number };

function headView(baked: Baked): View {
  const size = baked.headBox.getSize(new THREE.Vector3());
  return { center: baked.headBox.getCenter(new THREE.Vector3()), half: Math.max(size.x, size.y, size.z) * 0.62 };
}

/** A tighter view around a detected face, so the landmarks are found at a higher resolution. */
function faceView(baked: Baked, view: View, lms: { x: number; y: number }[]): View | null {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lms) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const extent = Math.max(x1 - x0, y1 - y0);
  // Already fills most of the frame: nothing to gain.
  if (extent > 0.5 || extent <= 0) return null;
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, baked.forward).normalize();
  const center = view.center
    .clone()
    .addScaledVector(right, ((x0 + x1) / 2 - 0.5) * 2 * view.half)
    .addScaledVector(up, (0.5 - (y0 + y1) / 2) * 2 * view.half);
  return { center, half: extent * view.half * 1.5 };
}

function renderHead(baked: Baked, view: View) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(baked.mesh);

  const { center, half } = view;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, 50);
  camera.position.copy(center).addScaledVector(baked.forward, Math.max(half * 6, 3));
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  ctx.canvas.width = SIZE;
  ctx.canvas.height = SIZE;
  ctx.drawImage(canvas, 0, 0);
  renderer.dispose();
  return { canvas, ctx, camera, scene, view };
}

function geometryPoint(
  source: THREE.Mesh,
  hit: THREE.Intersection,
): Vec3 | null {
  if (!hit.face || !hit.barycoord) return null;
  const pos = (source.geometry as THREE.BufferGeometry).attributes.position;
  const a = new THREE.Vector3().fromBufferAttribute(pos, hit.face.a);
  const b = new THREE.Vector3().fromBufferAttribute(pos, hit.face.b);
  const c = new THREE.Vector3().fromBufferAttribute(pos, hit.face.c);
  const p = a
    .multiplyScalar(hit.barycoord.x)
    .add(b.multiplyScalar(hit.barycoord.y))
    .add(c.multiplyScalar(hit.barycoord.z));
  return [p.x, p.y, p.z];
}

function sampleColor(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): Vec3 {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const p of points) {
    const px = Math.round(p.x * SIZE);
    const py = Math.round(p.y * SIZE);
    const data = ctx.getImageData(Math.max(0, px - 3), Math.max(0, py - 3), 7, 7).data;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0.8, 0.62, 0.52];
}

export type FaceRigResult = { rig: FaceRig; preview: string };

export async function computeFaceRig(
  root: THREE.Object3D,
  withRestPose: <T>(fn: () => T) => T = (fn) => fn(),
): Promise<FaceRigResult> {
  const skinned = findCharacterMesh(root);
  if (!skinned) throw new Error("No mesh found in the character");
  const baked = withRestPose(() => bake(skinned));
  let shot = renderHead(baked, headView(baked));

  let landmarks: { x: number; y: number }[] | null = null;
  try {
    const landmarker = await getFaceLandmarker();
    landmarks = landmarker.detect(shot.canvas).faceLandmarks?.[0] ?? null;
    // A face that is small in the first view is looked at again up close.
    const closer = landmarks && faceView(baked, shot.view, landmarks);
    if (closer) {
      const second = renderHead(baked, closer);
      const again = landmarker.detect(second.canvas).faceLandmarks?.[0] ?? null;
      if (again) {
        shot = second;
        landmarks = again;
      }
    }
  } catch (err) {
    console.warn("Face landmark detection failed", err);
  }
  const { canvas, ctx, camera, scene } = shot;

  const raycaster = new THREE.Raycaster();
  const toGeometry = (pt: { x: number; y: number }): Vec3 | null => {
    raycaster.setFromCamera(new THREE.Vector2(pt.x * 2 - 1, -(pt.y * 2 - 1)), camera);
    const hit = raycaster.intersectObject(baked.mesh, false)[0];
    return hit ? geometryPoint(skinned, hit) : null;
  };

  let rig: FaceRig | null = null;
  if (landmarks) rig = rigFromLandmarks(landmarks, toGeometry, ctx, skinned.name);
  if (!rig) rig = fallbackRig(baked, toGeometry, ctx, skinned.name);

  // Small annotated preview for debugging/QA.
  const preview = document.createElement("canvas");
  preview.width = 256;
  preview.height = 256;
  preview.getContext("2d")!.drawImage(canvas, 0, 0, 256, 256);
  scene.clear();
  (baked.mesh.material as THREE.Material).dispose();
  baked.mesh.geometry.dispose();
  return { rig, preview: preview.toDataURL("image/png") };
}

function rigFromLandmarks(
  lms: { x: number; y: number }[],
  toGeometry: (p: { x: number; y: number }) => Vec3 | null,
  ctx: CanvasRenderingContext2D,
  meshName: string,
): FaceRig | null {
  const get = (i: number) => toGeometry(lms[i]);
  const list = (ids: number[]) => ids.map(get);
  const all = <T,>(xs: (T | null)[]): xs is T[] => xs.every((x) => x !== null);

  const upperInner = list(LM.innerUpper);
  const lowerInner = list(LM.innerLower);
  const upperOuter = list(LM.outerUpper);
  const lowerOuter = list(LM.outerLower);
  const chin = get(LM.chin);
  const nose = get(LM.noseTip);
  const eye = (e: typeof LM.eyeA): EyeRig | null => {
    const inner = get(e.inner);
    const outer = get(e.outer);
    const upper = list(e.upper);
    const lower = list(e.lower);
    if (!inner || !outer || !all(upper) || !all(lower)) return null;
    const c = new THREE.Vector3(...inner).add(new THREE.Vector3(...outer)).multiplyScalar(0.5);
    return { center: [c.x, c.y, c.z], inner, outer, upper, lower };
  };
  const eyeA = eye(LM.eyeA);
  const eyeB = eye(LM.eyeB);
  const browA = list(LM.eyeA.brow);
  const browB = list(LM.eyeB.brow);
  if (!all(upperInner) || !all(lowerInner) || !all(upperOuter) || !all(lowerOuter) || !chin || !nose || !eyeA || !eyeB) {
    return null;
  }

  const left = upperInner[0];
  const right = upperInner[upperInner.length - 1];
  const center = new THREE.Vector3(...upperInner[5]).add(new THREE.Vector3(...lowerInner[5])).multiplyScalar(0.5);
  const frame = faceFrame(left, right, eyeA.center, eyeB.center, center);
  if (!frame) return null;

  return {
    version: 1,
    detected: true,
    meshName,
    right: frame.r,
    up: frame.u,
    forward: frame.f,
    mouth: {
      center: [center.x, center.y, center.z],
      left,
      right,
      upperInner,
      lowerInner,
      upperOuter,
      lowerOuter,
    },
    chin,
    noseTip: nose,
    // "left"/"right" are from the viewer's point of view.
    eyes: { left: eyeA, right: eyeB },
    skinColor: sampleColor(ctx, LM.cheeks.map((i) => lms[i])),
    lipColor: sampleColor(ctx, LM.lips.map((i) => lms[i])),
    ...(all(browA) && all(browB) ? { brows: { left: browA, right: browB } } : {}),
    lidColor: sampleColor(ctx, [...LM.eyeA.lid, ...LM.eyeB.lid].map((i) => lms[i])),
  };
}

function faceFrame(left: Vec3, right: Vec3, eyeA: Vec3, eyeB: Vec3, mouth: THREE.Vector3) {
  const r = new THREE.Vector3(...right).sub(new THREE.Vector3(...left));
  if (r.lengthSq() < 1e-10) return null;
  r.normalize();
  const eyes = new THREE.Vector3(...eyeA).add(new THREE.Vector3(...eyeB)).multiplyScalar(0.5);
  const u = eyes.sub(mouth);
  u.addScaledVector(r, -u.dot(r));
  if (u.lengthSq() < 1e-10) return null;
  u.normalize();
  const f = new THREE.Vector3().crossVectors(r, u).normalize();
  return { r: r.toArray() as Vec3, u: u.toArray() as Vec3, f: f.toArray() as Vec3 };
}

/** Proportional guess for faces the detector cannot read (very stylized looks). */
function fallbackRig(
  baked: Baked,
  toGeometry: (p: { x: number; y: number }) => Vec3 | null,
  ctx: CanvasRenderingContext2D,
  meshName: string,
): FaceRig {
  // In the normalized render the head box spans roughly 0.19..0.81.
  const at = (x: number, y: number): Vec3 => toGeometry({ x, y }) ?? toGeometry({ x: 0.5, y: 0.5 }) ?? [0, 1.5, 0.1];
  const mouthY = 0.66;
  const halfW = 0.045;
  const line = (dy: number) =>
    Array.from({ length: 11 }, (_, i) => at(0.5 - halfW + (2 * halfW * i) / 10, mouthY + dy));
  const upperInner = line(0);
  const lowerInner = line(0);
  const eyeAt = (cx: number): EyeRig => {
    const c = at(cx, 0.47);
    const inner = at(cx + (cx < 0.5 ? 0.035 : -0.035), 0.47);
    const outer = at(cx + (cx < 0.5 ? -0.035 : 0.035), 0.47);
    const up = Array.from({ length: 7 }, (_, i) => at(cx - 0.03 + 0.01 * i, 0.455));
    const lo = Array.from({ length: 7 }, (_, i) => at(cx - 0.03 + 0.01 * i, 0.485));
    return { center: c, inner, outer, upper: up, lower: lo };
  };
  const eyeA = eyeAt(0.42);
  const eyeB = eyeAt(0.58);
  const left = upperInner[0];
  const right = upperInner[10];
  const center = new THREE.Vector3(...at(0.5, mouthY));
  const frame = faceFrame(left, right, eyeA.center, eyeB.center, center) ?? {
    r: [1, 0, 0] as Vec3,
    u: [0, 1, 0] as Vec3,
    f: baked.forward.toArray() as Vec3,
  };
  return {
    version: 1,
    detected: false,
    meshName,
    right: frame.r,
    up: frame.u,
    forward: frame.f,
    mouth: {
      center: center.toArray() as Vec3,
      left,
      right,
      upperInner,
      lowerInner,
      upperOuter: line(-0.012),
      lowerOuter: line(0.014),
    },
    chin: at(0.5, 0.76),
    noseTip: at(0.5, 0.58),
    eyes: { left: eyeA, right: eyeB },
    skinColor: sampleColor(ctx, [{ x: 0.4, y: 0.58 }, { x: 0.6, y: 0.58 }]),
    lipColor: sampleColor(ctx, [{ x: 0.5, y: mouthY + 0.012 }]),
  };
}
