import * as THREE from "three";
import { EYE_DEPTH, type EyeAtlas } from "./eyeAtlas";
import { MouthInterior } from "./mouthInterior";
import type { FaceRig, Vec3 } from "./types";

/**
 * Makes an AI-generated character talk.
 *
 * Generated meshes have a closed, painted-on mouth and no facial rig. Using
 * the landmarks in a FaceRig we:
 *  1. add morph targets to the skinned mesh: `jaw` (rotates the lower face
 *     around an estimated jaw hinge), `wide` (corners out, slight smile) and
 *     `round` (lips pucker in and forward);
 *  2. patch the material shader so the region between the lips, which
 *     stretches open when the jaw drops, becomes the mouth: painted with
 *     teeth and tongue on a rigged figure, or cut out of the skin on a
 *     head-and-shoulders model so the modelled MouthInterior shows through;
 *  3. paint eyelids over the eyes during blinks, or, given a picture of the
 *     eyes (EyeAtlas), redraw them from it: the iris moved for a glance,
 *     the person's own eyelid skin drawn down for a blink;
 *  4. add expression morph targets: `smile` (corners up and out, cheeks
 *     lifted) and `brow` (eyebrows raised);
 *  5. for a head-and-shoulders model, which has no skeleton, turn the head
 *     in the vertex shader: everything above the neck rotates about a pivot
 *     behind the jaw, blending to nothing at the shoulders.
 * Everything is expressed in the mesh's bind-pose geometry space, before
 * skinning, so it follows the head through every animation.
 */

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const LINE_SAMPLES = 9;
/** How much the mouth narrows, and the upper lip lifts (in mouth half-widths), at full jaw opening. */
/** Shape of the opening toward the corners: 0.5 is an ellipse with blunt ends, higher values come to a point like lips do. */
const CORNER_TAPER = 0.8;
const JAW_NARROW = 0.12;
const JAW_LIP_LIFT = 0.07;

export type FaceState = {
  jaw: number;
  wide: number;
  round: number;
  blinkLeft: number;
  blinkRight: number;
  smile: number;
  brow: number;
  /** Head turn in radians (head-and-shoulders models only): yaw to the viewer's right, pitch up, roll toward the viewer's right shoulder. */
  head: { yaw: number; pitch: number; roll: number };
  /** Where the eyes look, as an iris shift in half eye-widths: x to the viewer's right, y up. Needs an eye atlas. */
  gaze: { x: number; y: number };
};

type Frame = { c: THREE.Vector3; r: THREE.Vector3; u: THREE.Vector3; f: THREE.Vector3 };

function local(frame: Frame, p: THREE.Vector3) {
  const d = p.clone().sub(frame.c);
  return { x: d.dot(frame.r), y: d.dot(frame.u), z: d.dot(frame.f) };
}

/** Resamples a left->right contour to uniform x positions in [-w, w]. */
function sampleContour(frame: Frame, pts: Vec3[], w: number): number[] {
  const loc = pts.map((p) => local(frame, v3(p))).sort((a, b) => a.x - b.x);
  const out: number[] = [];
  for (let i = 0; i < LINE_SAMPLES; i++) {
    const x = -w + (2 * w * i) / (LINE_SAMPLES - 1);
    let y = loc[0].y;
    if (x >= loc[loc.length - 1].x) y = loc[loc.length - 1].y;
    else {
      for (let k = 0; k < loc.length - 1; k++) {
        if (x >= loc[k].x && x <= loc[k + 1].x) {
          const t = (x - loc[k].x) / Math.max(1e-6, loc[k + 1].x - loc[k].x);
          y = loc[k].y + t * (loc[k + 1].y - loc[k].y);
          break;
        }
      }
    }
    out.push(y);
  }
  return out;
}

function smoothLine(line: number[]): number[] {
  let out = line;
  for (let pass = 0; pass < 2; pass++) {
    out = out.map((y, i) => (i === 0 || i === out.length - 1 ? y : 0.25 * out[i - 1] + 0.5 * y + 0.25 * out[i + 1]));
  }
  return out;
}

function interpLine(line: number[], w: number, x: number) {
  const t = ((x + w) / (2 * w)) * (LINE_SAMPLES - 1);
  const i = Math.min(LINE_SAMPLES - 2, Math.max(0, Math.floor(t)));
  const f = Math.min(1, Math.max(0, t - i));
  return line[i] + f * (line[i + 1] - line[i]);
}

export class FaceDriver {
  readonly state: FaceState = {
    jaw: 0,
    wide: 0,
    round: 0,
    blinkLeft: 0,
    blinkRight: 0,
    smile: 0,
    brow: 0,
    head: { yaw: 0, pitch: 0, roll: 0 },
    gaze: { x: 0, y: 0 },
  };
  private uniforms: Record<string, THREE.IUniform>;
  private morphIndex = { jaw: -1, wide: -1, round: -1, smile: -1, brow: -1 };
  private frame: Frame;
  private headMotion: boolean;
  private interior: MouthInterior | null = null;
  private headPivot = new THREE.Vector3();

  constructor(
    private mesh: THREE.Mesh,
    rig: FaceRig,
    options: { blinks?: boolean; headMotion?: boolean; eyes?: EyeAtlas | null } = {},
  ) {
    const frame: Frame = { c: v3(rig.mouth.center), r: v3(rig.right), u: v3(rig.up), f: v3(rig.forward) };
    this.frame = frame;
    this.headMotion = !!options.headMotion;
    const halfWidth = v3(rig.mouth.left).distanceTo(v3(rig.mouth.right)) / 2;
    const chin = local(frame, v3(rig.chin));
    const chinDepth = Math.max(halfWidth * 1.2, -chin.y);

    // The lips are closed in the source picture, so there is one seam, and the
    // two inner contours the detector reports lie a little to either side of
    // it, on the lips themselves. Opening the mouth along those would cut
    // into the lips, so both edges start from the line between them.
    // Smoothing removes the small kinks of individual landmarks, which would
    // otherwise show as notches in the open mouth.
    const upperContour = sampleContour(frame, rig.mouth.upperInner, halfWidth);
    const lowerContour = sampleContour(frame, rig.mouth.lowerInner, halfWidth);
    const midLine = smoothLine(upperContour.map((y, i) => (y + lowerContour[i]) / 2));
    const upperLine = midLine;
    const lowerLine = midLine;

    // Jaw hinge: a little above the mouth line and well behind the lips.
    const pivot = { y: 0.35 * chinDepth, z: -1.9 * chinDepth };
    const lipArm = Math.hypot(pivot.y, pivot.z);
    const theta = THREE.MathUtils.clamp((0.6 * halfWidth) / lipArm, 0.07, 0.32);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    const jaw = new Float32Array(count * 3);
    const wide = new Float32Array(count * 3);
    const round = new Float32Array(count * 3);
    const smile = new Float32Array(count * 3);
    const brow = new Float32Array(count * 3);
    const p = new THREE.Vector3();

    // Eyes and brows in the mouth frame, for the brow morph.
    const eyeShape = (eye: FaceRig["eyes"]["left"], line?: Vec3[]) => {
      const c = local(frame, v3(eye.inner).add(v3(eye.outer)).multiplyScalar(0.5));
      const half = v3(eye.inner).distanceTo(v3(eye.outer)) / 2;
      const lidY = Math.max(...eye.upper.map((q) => local(frame, v3(q)).y));
      const browY = line?.length ? line.reduce((sum, q) => sum + local(frame, v3(q)).y, 0) / line.length : lidY + half * 0.9;
      return { c, half, lidY, browY: Math.max(browY, lidY + half * 0.4) };
    };
    const eyeShapes = [eyeShape(rig.eyes.left, rig.brows?.left), eyeShape(rig.eyes.right, rig.brows?.right)];
    const put = (target: Float32Array, i: number, dx: number, dy: number, df: number) => {
      target[i * 3] = frame.r.x * dx + frame.u.x * dy + frame.f.x * df;
      target[i * 3 + 1] = frame.r.y * dx + frame.u.y * dy + frame.f.y * df;
      target[i * 3 + 2] = frame.r.z * dx + frame.u.z * dy + frame.f.z * df;
    };
    const eps = 0.06 * halfWidth;
    const reach = 3.2 * halfWidth;

    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, i);
      const { x, y, z } = local(frame, p);

      // --- brows: the strip from the upper eyelid to above the eyebrow lifts ---
      for (const e of eyeShapes) {
        const ex = x - e.c.x;
        if (Math.abs(ex) > e.half * 3.2 || y < e.lidY || y > e.browY + e.half * 3.5 || Math.abs(z - e.c.z) > e.half * 3) continue;
        const across = Math.exp(-((ex / (e.half * 1.7)) ** 2));
        const along = y < e.browY ? smoothstep(e.lidY, e.browY, y) : Math.exp(-(((y - e.browY) / (e.half * 1.4)) ** 2));
        const g = across * along;
        if (g > 1e-3) put(brow, i, 0, 0.34 * e.half * g, 0.03 * e.half * g);
      }

      if (Math.abs(x) > reach * 1.4 || z < -2.6 * chinDepth || y > 2 * halfWidth || y < -2.6 * chinDepth) continue;
      const ax = Math.abs(x);

      // --- smile: corners up and out, cheeks lifted ------------------------
      if (z > -1.2 * chinDepth) {
        const corner = Math.exp(-(((ax - halfWidth) ** 2 + (y * 1.2) ** 2) / (0.85 * halfWidth) ** 2));
        const cheek = Math.exp(-(((ax - 1.35 * halfWidth) ** 2 + (y - 1.1 * halfWidth) ** 2) / (0.95 * halfWidth) ** 2));
        if (corner > 1e-3 || cheek > 1e-3) {
          put(
            smile,
            i,
            Math.sign(x) * 0.18 * halfWidth * corner,
            0.2 * halfWidth * corner + 0.06 * halfWidth * cheek,
            -0.08 * halfWidth * corner + 0.07 * halfWidth * cheek,
          );
        }
      }

      // --- jaw ---------------------------------------------------------
      const lineY = interpLine(midLine, halfWidth, THREE.MathUtils.clamp(x, -halfWidth, halfWidth));
      const d = y - lineY;
      const band = eps + 0.35 * Math.max(0, ax - halfWidth);
      const below = 1 - smoothstep(-band, band, d);
      const lateral = 1 - smoothstep(1.15 * halfWidth, reach, ax);
      const depth = smoothstep(-2.2 * chinDepth, -0.9 * chinDepth, z);
      const neck = 1 - smoothstep(-1.15 * chinDepth, -1.9 * chinDepth, y);
      const profile = Math.max(0, 1 - (x / (halfWidth * 1.08)) ** 2) ** CORNER_TAPER;
      const taper = THREE.MathUtils.lerp(profile, 1, smoothstep(0, 0.55 * chinDepth, -d));
      const wJaw = below * lateral * depth * neck * taper;
      let jx = 0;
      let jy = 0;
      let jz = 0;
      if (wJaw > 1e-4) {
        const qy = y - pivot.y;
        const qz = z - pivot.z;
        const ny = qy * cosT - qz * sinT;
        const nz = qy * sinT + qz * cosT;
        jy = (ny - qy) * wJaw;
        jz = (nz - qz) * wJaw;
      }
      if (z > -1.2 * chinDepth) {
        // An opening mouth gets rounder, not just taller: the corners draw in
        // and the upper lip lifts a little off the teeth. Without this every
        // open shape reads as a grin. The shader's opening follows the same
        // numbers (JAW_NARROW, JAW_LIP_LIFT).
        const nearSeam = Math.exp(-((((y - lineY) * 1.5) / (1.2 * halfWidth)) ** 2)) * (1 - smoothstep(1.1 * halfWidth, 2.2 * halfWidth, ax));
        jx = -JAW_NARROW * x * nearSeam;
        const above = smoothstep(-band, band, d) * Math.exp(-((d / (0.8 * halfWidth)) ** 2));
        jy += JAW_LIP_LIFT * halfWidth * above * profile * lateral;
      }
      if (jx || jy || jz) put(jaw, i, jx, jy, jz);

      // --- lips: wide / round ---------------------------------------------
      if (z > -1.2 * chinDepth) {
        const rho = Math.hypot(x, y * 1.5);
        const g = Math.exp(-((rho / (1.5 * halfWidth)) ** 2) * 1.6);
        if (g > 1e-3) {
          const dx = -0.3 * x * g;
          const df = 0.14 * halfWidth * g;
          round[i * 3] = frame.r.x * dx + frame.f.x * df;
          round[i * 3 + 1] = frame.r.y * dx + frame.f.y * df;
          round[i * 3 + 2] = frame.r.z * dx + frame.f.z * df;
        }
        const corner = Math.exp(-(((ax - halfWidth) ** 2 + y * y) / (0.75 * halfWidth) ** 2));
        const inner = smoothstep(0, halfWidth, ax);
        const gw = Math.max(corner, inner * Math.exp(-((y / (0.5 * halfWidth)) ** 2))) * smoothstep(-0.2, 0.4, 1 - ax / reach);
        if (gw > 1e-3) {
          const dx = Math.sign(x) * 0.13 * halfWidth * gw;
          const dy = 0.05 * halfWidth * gw;
          const df = -0.05 * halfWidth * gw;
          wide[i * 3] = frame.r.x * dx + frame.u.x * dy + frame.f.x * df;
          wide[i * 3 + 1] = frame.r.y * dx + frame.u.y * dy + frame.f.y * df;
          wide[i * 3 + 2] = frame.r.z * dx + frame.u.z * dy + frame.f.z * df;
        }
      }
    }

    // Vertical drop of the lower lip centre at full jaw influence, used by the
    // shader to know where the moved lower lip edge is.
    const lipQy = lowerLine[(LINE_SAMPLES - 1) / 2] - pivot.y;
    const lipQz = -pivot.z;
    const dropCenter = -((lipQy * cosT - lipQz * sinT) - lipQy);

    const existing = geom.morphAttributes.position ?? [];
    const base = existing.length;
    geom.morphAttributes.position = [
      ...existing,
      new THREE.BufferAttribute(jaw, 3),
      new THREE.BufferAttribute(wide, 3),
      new THREE.BufferAttribute(round, 3),
      new THREE.BufferAttribute(smile, 3),
      new THREE.BufferAttribute(brow, 3),
    ];
    geom.morphTargetsRelative = true;
    this.morphIndex = { jaw: base, wide: base + 1, round: base + 2, smile: base + 3, brow: base + 4 };
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences = new Array(base + 5).fill(0);

    // Head turning: a pivot behind the jaw, and the stretch of neck over which
    // the turn fades out (heights along the face's up axis, from the mouth).
    const eyesY = (eyeShapes[0].c.y + eyeShapes[1].c.y) / 2;
    const faceLength = Math.max(eyesY - chin.y, halfWidth * 2);
    const headPivot = frame.c
      .clone()
      .addScaledVector(frame.u, chin.y + 0.25 * faceLength)
      .addScaledVector(frame.f, -0.8 * faceLength);
    const neck = new THREE.Vector2(chin.y - 0.75 * faceLength, chin.y + 0.1 * faceLength);
    this.headPivot.copy(headPivot);

    if (this.headMotion) {
      // A head-and-shoulders model gets a modelled mouth behind the lips.
      // The face frame leans back with the slope of the face (the eyes sit
      // behind the mouth), which is right for moving skin but would tip the
      // teeth down into the lower lip. The mouth is built upright instead:
      // the model's own vertical, squared up against the line of the mouth.
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(frame.r, -frame.r.y).normalize();
      const out = new THREE.Vector3().crossVectors(frame.r, up);
      const hinge = frame.u.clone().multiplyScalar(pivot.y).addScaledVector(frame.f, pivot.z);
      this.interior = new MouthInterior({
        toGeometry: new THREE.Matrix4().makeBasis(frame.r, up, out).setPosition(frame.c),
        halfWidth,
        seamY: 0,
        jawPivot: { y: hinge.dot(up), z: hinge.dot(out) },
        jawAngle: theta,
      });
      mesh.add(this.interior.group);
    }

    const eyeUniform = (eye: FaceRig["eyes"]["left"]) => {
      const inner = v3(eye.inner);
      const outer = v3(eye.outer);
      const center = inner.clone().add(outer).multiplyScalar(0.5);
      const ef: Frame = { c: center, r: frame.r, u: frame.u, f: frame.f };
      const half = inner.distanceTo(outer) / 2;
      const upper = Math.max(...eye.upper.map((q) => local(ef, v3(q)).y));
      const lower = Math.min(...eye.lower.map((q) => local(ef, v3(q)).y));
      const a = local(ef, inner);
      const b = local(ef, outer);
      const dx = b.x - a.x;
      const slope = Math.abs(dx) > 1e-6 ? THREE.MathUtils.clamp((b.y - a.y) / dx, -0.6, 0.6) : 0;
      // The iris, relative to the centre of the eye, for moving the gaze.
      const offset = eye.iris ? v3(eye.iris.center).sub(center) : null;
      const iris = offset ? new THREE.Vector3(offset.dot(frame.r), offset.dot(frame.u), eye.iris!.radius) : new THREE.Vector3();
      return { center, half, upper: Math.max(upper, half * 0.25), lower: Math.min(lower, -half * 0.12), slope, iris };
    };
    const el = eyeUniform(rig.eyes.left);
    const er = eyeUniform(rig.eyes.right);

    const skin = new THREE.Color().setRGB(...rig.skinColor, THREE.SRGBColorSpace);
    const lid = rig.lidColor ? new THREE.Color().setRGB(...rig.lidColor, THREE.SRGBColorSpace) : skin.clone().multiplyScalar(0.93);
    const lip = new THREE.Color().setRGB(...rig.lipColor, THREE.SRGBColorSpace);

    this.uniforms = {
      uMouthCenter: { value: frame.c },
      uFaceRight: { value: frame.r },
      uFaceUp: { value: frame.u },
      uFaceForward: { value: frame.f },
      uMouthHalfWidth: { value: halfWidth },
      uUpperLine: { value: upperLine },
      uLowerLine: { value: lowerLine },
      uDropCenter: { value: dropCenter },
      uJaw: { value: 0 },
      uWide: { value: 0 },
      uRound: { value: 0 },
      uLipColor: { value: lip },
      uSkinColor: { value: skin },
      uLidColor: { value: lid },
      uMouthCut: { value: this.interior ? 1 : 0 },
      uHeadPivot: { value: headPivot },
      uHeadRot: { value: new THREE.Matrix3() },
      uNeck: { value: neck },
      uEyeL: { value: new THREE.Vector4(el.center.x, el.center.y, el.center.z, el.half) },
      uEyeLShape: { value: new THREE.Vector3(el.upper, el.lower, el.slope) },
      uEyeR: { value: new THREE.Vector4(er.center.x, er.center.y, er.center.z, er.half) },
      uEyeRShape: { value: new THREE.Vector3(er.upper, er.lower, er.slope) },
      uBlink: { value: new THREE.Vector2(0, 0) },
      uEyesOn: { value: options.eyes ? 1 : 0 },
      uEyeAtlas: { value: options.eyes?.texture ?? null },
      uEyeExtent: { value: new THREE.Vector2(...(options.eyes?.extent ?? [1, 1])) },
      uIrisL: { value: el.iris },
      uIrisR: { value: er.iris },
      uGaze: { value: new THREE.Vector2(0, 0) },
      uBlinkEnabled: { value: options.blinks === false ? 0 : 1 },
    };

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const patched = materials.map((m) => this.patchMaterial(m));
    mesh.material = Array.isArray(mesh.material) ? patched : patched[0];
  }

  private patchMaterial(original: THREE.Material): THREE.Material {
    const material = original.clone();
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      // The fragment shader paints the mouth and eyelids at fixed places on the
      // face, so it is given the position before expressions and head turns.
      const { smile, brow } = this.morphIndex;
      const facePos = `
vFacePos = transformed;
#ifdef USE_MORPHTARGETS
vFacePos -= getMorph(gl_VertexID, ${smile}, 0).xyz * morphTargetInfluences[${smile}];
vFacePos -= getMorph(gl_VertexID, ${brow}, 0).xyz * morphTargetInfluences[${brow}];
#endif`;
      const turn = this.headMotion
        ? "\ntransformed = mix(transformed, uHeadPivot + uHeadRot * (transformed - uHeadPivot), headWeight(position));"
        : "";
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${FACE_VERTEX_HEADER}`)
        .replace("#include <morphtarget_vertex>", `#include <morphtarget_vertex>${facePos}${turn}`);
      if (this.headMotion) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, uHeadRot * objectNormal, headWeight(position)));",
        );
      }
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FACE_FRAGMENT_HEADER}\n${EYE_FRAGMENT_HEADER}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${FACE_FRAGMENT_BODY}`);
    };
    material.customProgramCacheKey = () => `iident-face-v4-${this.morphIndex.smile}-${this.headMotion ? "head" : "rigged"}`;
    if (this.interior) {
      // The mouth opening is cut out of the skin. Alpha to coverage keeps the edge of the lips smooth.
      material.alphaTest = 0.5;
      material.alphaToCoverage = true;
      // Where the open lips fold away from the viewer, show their inner side rather than a hole.
      material.side = THREE.DoubleSide;
    }
    return material;
  }

  /** Frees what the driver added to the mesh (the material it patched belongs to the mesh and goes with it). */
  dispose() {
    this.interior?.dispose();
    this.interior = null;
  }

  /** Push the current state to the GPU. Call once per frame. */
  update() {
    const s = this.state;
    const infl = this.mesh.morphTargetInfluences;
    if (infl) {
      infl[this.morphIndex.jaw] = s.jaw;
      infl[this.morphIndex.wide] = s.wide;
      infl[this.morphIndex.round] = s.round;
      infl[this.morphIndex.smile] = s.smile;
      infl[this.morphIndex.brow] = s.brow;
    }
    if (this.headMotion) {
      const { r, u, f } = this.frame;
      _turn.setFromAxisAngle(u, s.head.yaw);
      _turn.multiply(_part.setFromAxisAngle(r, -s.head.pitch));
      _turn.multiply(_part.setFromAxisAngle(f, -s.head.roll));
      (this.uniforms.uHeadRot.value as THREE.Matrix3).setFromMatrix4(_matrix.makeRotationFromQuaternion(_turn));
      // The same turn, about the same pivot, for the parts that are separate meshes.
      const c = this.headPivot;
      _matrix.premultiply(_shift.makeTranslation(c.x, c.y, c.z)).multiply(_shift.makeTranslation(-c.x, -c.y, -c.z));
    }
    this.interior?.update(s.jaw, this.headMotion ? _matrix : null);
    this.uniforms.uJaw.value = s.jaw;
    this.uniforms.uWide.value = s.wide;
    this.uniforms.uRound.value = s.round;
    (this.uniforms.uBlink.value as THREE.Vector2).set(s.blinkLeft, s.blinkRight);
    (this.uniforms.uGaze.value as THREE.Vector2).set(s.gaze.x, s.gaze.y);
  }
}

const _turn = new THREE.Quaternion();
const _part = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _shift = new THREE.Matrix4();

const FACE_VERTEX_HEADER = /* glsl */ `
varying vec3 vFacePos;
uniform vec3 uMouthCenter;
uniform vec3 uFaceUp;
uniform vec3 uHeadPivot;
uniform mat3 uHeadRot;
uniform vec2 uNeck;
// How much of the head's turn a vertex takes: all of it above the chin, none at the shoulders.
float headWeight(vec3 p) {
  return smoothstep(uNeck.x, uNeck.y, dot(p - uMouthCenter, uFaceUp));
}
`;

const FACE_FRAGMENT_HEADER = /* glsl */ `
varying vec3 vFacePos;
uniform vec3 uMouthCenter;
uniform vec3 uFaceRight;
uniform vec3 uFaceUp;
uniform vec3 uFaceForward;
uniform float uMouthHalfWidth;
uniform float uUpperLine[${LINE_SAMPLES}];
uniform float uLowerLine[${LINE_SAMPLES}];
uniform float uDropCenter;
uniform float uJaw;
uniform float uWide;
uniform float uRound;
uniform vec3 uLipColor;
uniform vec3 uSkinColor;
uniform vec3 uLidColor;
uniform float uMouthCut;
uniform vec4 uEyeL;
uniform vec3 uEyeLShape;
uniform vec4 uEyeR;
uniform vec3 uEyeRShape;
uniform vec2 uBlink;
uniform float uBlinkEnabled;
uniform float uEyesOn;
uniform sampler2D uEyeAtlas;
uniform vec2 uEyeExtent;
uniform vec3 uIrisL;
uniform vec3 uIrisR;
uniform vec2 uGaze;

float faceLine(float values[${LINE_SAMPLES}], float x) {
  float t = clamp((x + uMouthHalfWidth) / (2.0 * uMouthHalfWidth), 0.0, 1.0) * float(${LINE_SAMPLES - 1});
  int i = int(min(floor(t), float(${LINE_SAMPLES - 2})));
  float f = t - float(i);
  float a = values[0];
  float b = values[1];
  for (int k = 0; k < ${LINE_SAMPLES - 1}; k++) {
    if (k == i) { a = values[k]; b = values[k + 1]; }
  }
  return mix(a, b, f);
}

// Returns paint colour in rgb and coverage in a.
vec4 eyelid(vec3 p, vec4 eye, vec3 shape, float blink) {
  if (blink < 0.01 || uBlinkEnabled < 0.5) return vec4(0.0);
  vec3 d = p - eye.xyz;
  float x = dot(d, uFaceRight);
  float y = dot(d, uFaceUp) - shape.z * x;
  float z = dot(d, uFaceForward);
  float half_w = eye.w * 1.12;
  if (abs(x) > half_w || abs(z) > eye.w * 0.9) return vec4(0.0);
  float prof = pow(max(0.0, 1.0 - (x * x) / (half_w * half_w)), 0.7);
  float top = shape.x * 1.25 * prof + eye.w * 0.05;
  float bottom = shape.y * 1.05 * prof;
  float lid = mix(top, bottom, smoothstep(0.0, 1.0, blink));
  float edge = eye.w * 0.035;
  float cover = smoothstep(lid - edge, lid + edge, y) * (1.0 - smoothstep(top, top + eye.w * 0.12, y));
  float lash = (1.0 - smoothstep(eye.w * 0.03, eye.w * 0.09, abs(y - lid))) * step(0.15, blink);
  // Slightly darker toward the lashes, like the fold of a real eyelid.
  vec3 lidColor = uLidColor * mix(0.82, 1.0, smoothstep(lid, top, y));
  vec3 col = mix(lidColor, vec3(0.08, 0.06, 0.06), lash);
  return vec4(col, max(cover, lash * 0.9) * smoothstep(0.0, 0.15, blink));
}
`;

/** Eyes redrawn from their own picture (see EyeAtlas): used instead of the painted eyelids when there is one. */
const EYE_FRAGMENT_HEADER = /* glsl */ `
// The picture of one eye at a point given from the centre of that eye. Alpha is 0 where there is no picture.
vec4 eyePicture(vec2 e, float extent, float side) {
  vec2 uv = 0.5 + e / (2.0 * extent);
  if (uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99) return vec4(0.0);
  return texture2D(uEyeAtlas, vec2((uv.x + side) * 0.5, uv.y));
}

void eyeTextured(inout vec3 color, vec3 p, vec4 eye, vec3 shape, vec3 iris, float extent, float side, float blink) {
  vec3 d = p - eye.xyz;
  float x = dot(d, uFaceRight);
  float yr = dot(d, uFaceUp);
  float z = dot(d, uFaceForward);
  float w = eye.w;
  if (abs(x) > w * 1.5 || abs(yr) > w * 1.6 || z > w * ${EYE_DEPTH} || z < -w * 0.9) return;
  // Height above the line through the corners of the eye.
  float y = yr - shape.z * x;
  float hw = w * 1.12;
  float prof = pow(max(0.0, 1.0 - (x * x) / (hw * hw)), 0.7);
  float upperLid = shape.x * prof;
  float lowerLid = shape.y * prof;

  // A glance: the iris redrawn a little to one side, eye white where it used to be.
  vec2 g = uGaze * w;
  if (iris.z > 0.0 && dot(g, g) > 1e-10) {
    vec2 e = vec2(x, yr);
    vec2 q = e - iris.xy;
    float R = iris.z;
    float opening = smoothstep(0.0, 0.14 * w, upperLid - y) * smoothstep(0.05 * w, 0.17 * w, y - lowerLid);
    float now = 1.0 - smoothstep(R * 0.96, R * 1.1, length(q - g));
    float before = 1.0 - smoothstep(R, R * 1.16, length(q));
    vec2 src = e - g;
    // The part of the iris a lid hides at rest was never seen: mirror the part that was.
    float sy = src.y - shape.z * src.x;
    float sprof = pow(max(0.0, 1.0 - (src.x * src.x) / (hw * hw)), 0.7);
    if (sy > shape.x * sprof * 0.88 || sy < shape.y * sprof * 0.88) src.y = 2.0 * iris.y - src.y;
    vec4 irisCol = eyePicture(src, extent, side);
    // The white of the eye, taken from just beside the iris on both sides.
    vec4 whiteA = eyePicture(iris.xy + vec2(-1.28 * R, 0.0), extent, side);
    vec4 whiteB = eyePicture(iris.xy + vec2(1.28 * R, 0.0), extent, side);
    vec3 white = (whiteA.rgb * whiteA.a + whiteB.rgb * whiteB.a) / max(whiteA.a + whiteB.a, 1e-3);
    float cover = opening * max(now, before) * irisCol.a * step(0.5, whiteA.a + whiteB.a);
    color = mix(color, mix(white, irisCol.rgb, now), cover);
  }

  // A blink: the skin above the lashes drawn down over the eye.
  if (blink > 0.01 && uBlinkEnabled > 0.5 && abs(x) < hw) {
    float lid = mix(upperLid, lowerLid + 0.04 * w, smoothstep(0.0, 1.0, blink));
    float from = upperLid + 0.1 * w;
    float band = 0.65 * w;
    if (y > lid && y < from + band) {
      float ySrc = from + (y - lid) * band / (from + band - lid);
      vec4 skin = eyePicture(vec2(x, ySrc + shape.z * x), extent, side);
      float lash = 1.0 - smoothstep(w * 0.02, w * 0.08, y - lid);
      // A little darker toward the lashes, where the lid curves under.
      vec3 skinCol = mix(uLidColor, skin.rgb, skin.a);
      vec3 lidCol = mix(skinCol * mix(0.86, 1.0, smoothstep(lid, lid + 0.35 * w, y)), vec3(0.07, 0.05, 0.05), lash * 0.85);
      color = mix(color, lidCol, smoothstep(0.0, 0.25, prof) * smoothstep(0.0, 0.2, blink));
    }
  }
}
`;

const FACE_FRAGMENT_BODY = /* glsl */ `
{
  vec3 fd = vFacePos - uMouthCenter;
  float fx = dot(fd, uFaceRight);
  float fy = dot(fd, uFaceUp);
  float fz = dot(fd, uFaceForward);
  float hw = uMouthHalfWidth * (1.0 + 0.12 * uWide - 0.26 * uRound - ${JAW_NARROW} * uJaw);
  if (uJaw > 0.015 && abs(fz) < uMouthHalfWidth * 0.9 && abs(fx) < hw) {
    float xs = fx / max(hw, 1e-5) * uMouthHalfWidth;
    float prof = pow(max(0.0, 1.0 - pow(fx / hw, 2.0)), ${CORNER_TAPER});
    float upper = faceLine(uUpperLine, xs) + (0.04 * uWide + ${JAW_LIP_LIFT} * uJaw) * uMouthHalfWidth * prof;
    float lower = faceLine(uLowerLine, xs) - uJaw * uDropCenter * prof * (1.0 + 0.25 * uRound);
    float soft = uMouthHalfWidth * 0.025;
    float inside = smoothstep(lower - soft, lower + soft, fy) * (1.0 - smoothstep(upper - soft, upper + soft, fy));
    // Toward the corners the gap gets thinner than its own soft edge: close it cleanly there.
    inside *= smoothstep(0.5 * soft, 3.0 * soft, upper - lower);
    if (uMouthCut > 0.5) {
      // Open the skin between the lips onto the modelled mouth behind it,
      // and shade the lips toward the opening, where they curve inward.
      diffuseColor.a *= 1.0 - inside;
      float gap = smoothstep(0.03, 0.25, (upper - lower) / uMouthHalfWidth);
      float rim = fy > 0.5 * (upper + lower)
        ? 1.0 - smoothstep(0.0, 0.16 * uMouthHalfWidth, fy - upper)
        : 1.0 - smoothstep(0.0, 0.16 * uMouthHalfWidth, lower - fy);
      diffuseColor.rgb *= 1.0 - 0.3 * rim * gap * prof;
    } else if (inside > 0.0) {
      float h = max(upper - lower, 1e-5);
      float t = clamp((fy - lower) / h, 0.0, 1.0);
      float xr = fx / hw;
      vec3 cavity = mix(vec3(0.16, 0.035, 0.04), vec3(0.32, 0.07, 0.08), 1.0 - abs(xr));
      cavity *= mix(0.55, 1.0, smoothstep(0.0, 0.5, abs(t - 0.45) * 2.0));
      float teethH = min(0.32 * h, 0.2 * uMouthHalfWidth);
      float teeth = smoothstep(1.0 - teethH / h - 0.02, 1.0 - teethH / h + 0.04, t) * (1.0 - smoothstep(0.82, 0.98, abs(xr)));
      // Off-white, shaded by the upper lip above and toward the corners, with faint gaps between teeth.
      vec3 teethCol = mix(vec3(0.8, 0.77, 0.72), vec3(0.6, 0.56, 0.53), smoothstep(1.0 - 0.5 * teethH / h, 1.0, t));
      teethCol *= mix(1.0, 0.6, smoothstep(0.3, 0.9, abs(xr)));
      teethCol *= 1.0 - 0.2 * smoothstep(0.38, 0.5, abs(fract(xr * 3.5 + 0.5) - 0.5));
      float tongue = (1.0 - smoothstep(0.18, 0.42, t)) * (1.0 - smoothstep(0.45, 0.85, abs(xr))) * smoothstep(0.12, 0.35, h / uMouthHalfWidth);
      vec3 col = mix(cavity, vec3(0.62, 0.25, 0.27), tongue * 0.85);
      col = mix(col, teethCol, teeth * smoothstep(0.1, 0.22, h / uMouthHalfWidth));
      diffuseColor.rgb = mix(diffuseColor.rgb, col, inside);
    }
  }
  if (uEyesOn > 0.5) {
    eyeTextured(diffuseColor.rgb, vFacePos, uEyeL, uEyeLShape, uIrisL, uEyeExtent.x, 0.0, uBlink.x);
    eyeTextured(diffuseColor.rgb, vFacePos, uEyeR, uEyeRShape, uIrisR, uEyeExtent.y, 1.0, uBlink.y);
  } else {
    vec4 lidL = eyelid(vFacePos, uEyeL, uEyeLShape, uBlink.x);
    vec4 lidR = eyelid(vFacePos, uEyeR, uEyeRShape, uBlink.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, lidL.rgb, lidL.a);
    diffuseColor.rgb = mix(diffuseColor.rgb, lidR.rgb, lidR.a);
  }
}
`;
