import * as THREE from "three";
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
 *     stretches open when the jaw drops, is painted as a mouth interior with
 *     teeth and tongue;
 *  3. paint eyelids over the eyes during blinks.
 * Everything is expressed in the mesh's bind-pose geometry space, before
 * skinning, so it follows the head through every animation.
 */

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const LINE_SAMPLES = 9;

export type FaceState = {
  jaw: number;
  wide: number;
  round: number;
  blinkLeft: number;
  blinkRight: number;
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

function interpLine(line: number[], w: number, x: number) {
  const t = ((x + w) / (2 * w)) * (LINE_SAMPLES - 1);
  const i = Math.min(LINE_SAMPLES - 2, Math.max(0, Math.floor(t)));
  const f = Math.min(1, Math.max(0, t - i));
  return line[i] + f * (line[i + 1] - line[i]);
}

export class FaceDriver {
  readonly state: FaceState = { jaw: 0, wide: 0, round: 0, blinkLeft: 0, blinkRight: 0 };
  private uniforms: Record<string, THREE.IUniform>;
  private morphIndex = { jaw: -1, wide: -1, round: -1 };

  constructor(
    private mesh: THREE.SkinnedMesh,
    rig: FaceRig,
    options: { blinks?: boolean } = {},
  ) {
    const frame: Frame = { c: v3(rig.mouth.center), r: v3(rig.right), u: v3(rig.up), f: v3(rig.forward) };
    const halfWidth = v3(rig.mouth.left).distanceTo(v3(rig.mouth.right)) / 2;
    const chin = local(frame, v3(rig.chin));
    const chinDepth = Math.max(halfWidth * 1.2, -chin.y);

    const upperLine = sampleContour(frame, rig.mouth.upperInner, halfWidth);
    const lowerLine = sampleContour(frame, rig.mouth.lowerInner, halfWidth);
    const midLine = upperLine.map((y, i) => (y + lowerLine[i]) / 2);

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
    const p = new THREE.Vector3();
    const eps = 0.06 * halfWidth;
    const reach = 3.2 * halfWidth;

    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, i);
      const { x, y, z } = local(frame, p);
      if (Math.abs(x) > reach * 1.4 || z < -2.6 * chinDepth || y > 2 * halfWidth || y < -2.6 * chinDepth) continue;
      const ax = Math.abs(x);

      // --- jaw ---------------------------------------------------------
      const lineY = interpLine(midLine, halfWidth, THREE.MathUtils.clamp(x, -halfWidth, halfWidth));
      const d = y - lineY;
      const band = eps + 0.35 * Math.max(0, ax - halfWidth);
      const below = 1 - smoothstep(-band, band, d);
      const lateral = 1 - smoothstep(1.15 * halfWidth, reach, ax);
      const depth = smoothstep(-2.2 * chinDepth, -0.9 * chinDepth, z);
      const neck = 1 - smoothstep(-1.15 * chinDepth, -1.9 * chinDepth, y);
      const profile = Math.sqrt(Math.max(0, 1 - (x / (halfWidth * 1.08)) ** 2));
      const taper = THREE.MathUtils.lerp(profile, 1, smoothstep(0, 0.55 * chinDepth, -d));
      const wJaw = below * lateral * depth * neck * taper;
      if (wJaw > 1e-4) {
        const qy = y - pivot.y;
        const qz = z - pivot.z;
        const ny = qy * cosT - qz * sinT;
        const nz = qy * sinT + qz * cosT;
        const dy = (ny - qy) * wJaw;
        const dz = (nz - qz) * wJaw;
        jaw[i * 3] = frame.u.x * dy + frame.f.x * dz;
        jaw[i * 3 + 1] = frame.u.y * dy + frame.f.y * dz;
        jaw[i * 3 + 2] = frame.u.z * dy + frame.f.z * dz;
      }

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
    ];
    geom.morphTargetsRelative = true;
    this.morphIndex = { jaw: base, wide: base + 1, round: base + 2 };
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences = new Array(base + 3).fill(0);

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
      return { center, half, upper: Math.max(upper, half * 0.25), lower: Math.min(lower, -half * 0.12), slope };
    };
    const el = eyeUniform(rig.eyes.left);
    const er = eyeUniform(rig.eyes.right);

    const skin = new THREE.Color().setRGB(...rig.skinColor, THREE.SRGBColorSpace);
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
      uEyeL: { value: new THREE.Vector4(el.center.x, el.center.y, el.center.z, el.half) },
      uEyeLShape: { value: new THREE.Vector3(el.upper, el.lower, el.slope) },
      uEyeR: { value: new THREE.Vector4(er.center.x, er.center.y, er.center.z, er.half) },
      uEyeRShape: { value: new THREE.Vector3(er.upper, er.lower, er.slope) },
      uBlink: { value: new THREE.Vector2(0, 0) },
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
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFacePos;")
        .replace("#include <morphtarget_vertex>", "#include <morphtarget_vertex>\nvFacePos = transformed;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FACE_FRAGMENT_HEADER}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${FACE_FRAGMENT_BODY}`);
    };
    material.customProgramCacheKey = () => "iident-face-v1";
    return material;
  }

  /** Push the current state to the GPU. Call once per frame. */
  update() {
    const s = this.state;
    const infl = this.mesh.morphTargetInfluences;
    if (infl) {
      infl[this.morphIndex.jaw] = s.jaw;
      infl[this.morphIndex.wide] = s.wide;
      infl[this.morphIndex.round] = s.round;
    }
    this.uniforms.uJaw.value = s.jaw;
    this.uniforms.uWide.value = s.wide;
    this.uniforms.uRound.value = s.round;
    (this.uniforms.uBlink.value as THREE.Vector2).set(s.blinkLeft, s.blinkRight);
  }
}

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
uniform vec4 uEyeL;
uniform vec3 uEyeLShape;
uniform vec4 uEyeR;
uniform vec3 uEyeRShape;
uniform vec2 uBlink;
uniform float uBlinkEnabled;

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
  vec3 lidColor = uSkinColor * 0.93;
  vec3 col = mix(lidColor, vec3(0.08, 0.06, 0.06), lash);
  return vec4(col, max(cover, lash * 0.9) * smoothstep(0.0, 0.15, blink));
}
`;

const FACE_FRAGMENT_BODY = /* glsl */ `
{
  vec3 fd = vFacePos - uMouthCenter;
  float fx = dot(fd, uFaceRight);
  float fy = dot(fd, uFaceUp);
  float fz = dot(fd, uFaceForward);
  float hw = uMouthHalfWidth * (1.0 + 0.12 * uWide - 0.26 * uRound);
  if (uJaw > 0.015 && abs(fz) < uMouthHalfWidth * 0.9 && abs(fx) < hw) {
    float xs = fx / max(hw, 1e-5) * uMouthHalfWidth;
    float prof = sqrt(max(0.0, 1.0 - pow(fx / hw, 2.0)));
    float upper = faceLine(uUpperLine, xs) + 0.04 * uMouthHalfWidth * uWide * prof;
    float lower = faceLine(uLowerLine, xs) - uJaw * uDropCenter * prof * (1.0 + 0.25 * uRound);
    float soft = uMouthHalfWidth * 0.025;
    float inside = smoothstep(lower - soft, lower + soft, fy) * (1.0 - smoothstep(upper - soft, upper + soft, fy));
    if (inside > 0.0) {
      float h = max(upper - lower, 1e-5);
      float t = clamp((fy - lower) / h, 0.0, 1.0);
      float xr = fx / hw;
      vec3 cavity = mix(vec3(0.16, 0.035, 0.04), vec3(0.32, 0.07, 0.08), 1.0 - abs(xr));
      cavity *= mix(0.55, 1.0, smoothstep(0.0, 0.5, abs(t - 0.45) * 2.0));
      float teethH = min(0.32 * h, 0.2 * uMouthHalfWidth);
      float teeth = smoothstep(1.0 - teethH / h - 0.02, 1.0 - teethH / h + 0.04, t) * (1.0 - smoothstep(0.82, 0.98, abs(xr)));
      vec3 teethCol = mix(vec3(0.82, 0.8, 0.76), vec3(0.96, 0.95, 0.92), smoothstep(1.0 - teethH / h, 1.0, t));
      float tongue = (1.0 - smoothstep(0.18, 0.42, t)) * (1.0 - smoothstep(0.45, 0.85, abs(xr))) * smoothstep(0.12, 0.35, h / uMouthHalfWidth);
      vec3 col = mix(cavity, vec3(0.62, 0.25, 0.27), tongue * 0.85);
      col = mix(col, teethCol, teeth * smoothstep(0.1, 0.22, h / uMouthHalfWidth));
      diffuseColor.rgb = mix(diffuseColor.rgb, col, inside);
    }
  }
  vec4 lidL = eyelid(vFacePos, uEyeL, uEyeLShape, uBlink.x);
  vec4 lidR = eyelid(vFacePos, uEyeR, uEyeRShape, uBlink.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, lidL.rgb, lidL.a);
  diffuseColor.rgb = mix(diffuseColor.rgb, lidR.rgb, lidR.a);
}
`;
