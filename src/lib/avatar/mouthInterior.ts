import * as THREE from "three";

/**
 * The inside of the mouth for a head-and-shoulders model: upper and lower
 * teeth, a tongue and a dark cavity, as real geometry behind the lips.
 *
 * The face mesh has a closed, painted-on mouth. When the jaw opens, the face
 * shader cuts the gap between the lips out of the skin (see FaceDriver) and
 * this shows through it. Being geometry, it has depth: teeth sit behind the
 * lips, the lower row drops with the jaw, and it all looks right as the head
 * turns, which a mouth painted on the surface cannot.
 *
 * Everything is built in "mouth space" (x to the face's right, y up, z out
 * of the face, origin on the lip seam) and sized from the width of the
 * mouth, so it fits any face.
 */

export type MouthLayout = {
  /** Mouth space -> the face mesh's geometry space. */
  toGeometry: THREE.Matrix4;
  /** Half the distance between the corners of the mouth. */
  halfWidth: number;
  /** Height of the lip seam at the centre. */
  seamY: number;
  /** Jaw hinge (y, z in mouth space) and how far it turns when fully open, in radians. */
  jawPivot: { y: number; z: number };
  jawAngle: number;
};

const TOOTH_WIDTHS = [8.5, 6.5, 7.5, 7, 7, 10, 10]; // mm, centre outwards: incisors, canine, premolars, molars
const ARCH_ANGLE = (86 * Math.PI) / 180;

/** One row of teeth with gums at the root side, drawn once and wrapped around the arch. */
function teethTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // Gums along the top third; below them only teeth are opaque.
  const gum = ctx.createLinearGradient(0, 0, 0, h * 0.42);
  gum.addColorStop(0, "#7a3d42");
  gum.addColorStop(1, "#96504f");
  ctx.fillStyle = gum;
  ctx.fillRect(0, 0, w, h * 0.42);

  const side = TOOTH_WIDTHS.reduce((a, b) => a + b, 0);
  const scale = w / (2 * side);
  const drawTooth = (x0: number, width: number, index: number) => {
    const gap = 1.2;
    const top = h * (0.3 + (index === 2 ? -0.03 : 0.02)); // canines sit a little higher in the gum
    const bottom = h * (index >= 5 ? 0.88 : index >= 3 ? 0.92 : index === 1 ? 0.94 : 0.985); // only the front teeth reach the edge
    const r = Math.min(width * (index === 2 ? 0.46 : 0.3), 18); // canines come to more of a point
    // Darker under the lip and at the gum, lighter toward the biting edge.
    const shade = ctx.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, "#a89c8c");
    shade.addColorStop(0.55, "#cfc5b6");
    shade.addColorStop(1, "#e2dacd");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(x0 + gap, top + r * 0.6);
    ctx.quadraticCurveTo(x0 + width / 2, top - r * 0.5, x0 + width - gap, top + r * 0.6);
    ctx.lineTo(x0 + width - gap, bottom - r);
    ctx.quadraticCurveTo(x0 + width - gap, bottom, x0 + width - gap - r, bottom);
    ctx.lineTo(x0 + gap + r, bottom);
    ctx.quadraticCurveTo(x0 + gap, bottom, x0 + gap, bottom - r);
    ctx.closePath();
    ctx.fill();
    // A soft shadow down each side gives the teeth some roundness.
    const edge = ctx.createLinearGradient(x0, 0, x0 + width, 0);
    edge.addColorStop(0, "rgba(70,50,45,0.4)");
    edge.addColorStop(0.22, "rgba(70,50,45,0)");
    edge.addColorStop(0.78, "rgba(70,50,45,0)");
    edge.addColorStop(1, "rgba(70,50,45,0.4)");
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = edge;
    ctx.fillRect(x0, top - r, width, bottom - top + r);
    ctx.globalCompositeOperation = "source-over";
  };
  let left = w / 2;
  let right = w / 2;
  TOOTH_WIDTHS.forEach((mm, i) => {
    const width = mm * scale;
    drawTooth(right, width, i);
    drawTooth(left - width, width, i);
    right += width;
    left -= width;
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A strip following the dental arch between two heights. `v` runs from the gum (1) to the biting edge (0). */
function archStrip(halfWidth: number, front: number, gumY: number, edgeY: number): THREE.BufferGeometry {
  const a = 1.15 * halfWidth;
  const b = 1.5 * halfWidth;
  const columns = 64;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const points = Array.from({ length: columns + 1 }, (_, i) => {
    const phi = ((i / columns) * 2 - 1) * ARCH_ANGLE;
    return { phi, x: a * Math.sin(phi), z: front - b * (1 - Math.cos(phi)) };
  });
  // The texture runs along the arch by distance, so every tooth keeps its width around the curve.
  const along = [0];
  for (let i = 1; i <= columns; i++) along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  for (let i = 0; i <= columns; i++) {
    const s = along[i] / along[columns];
    const { phi, x, z } = points[i];
    // Teeth further back get less light.
    const light = THREE.MathUtils.lerp(1, 0.28, Math.pow(Math.abs(phi) / ARCH_ANGLE, 1.4));
    for (const [y, v] of [
      [gumY, 1],
      [edgeY, 0],
    ]) {
      positions.push(x, y, z);
      uvs.push(s, v);
      colors.push(light, light, light);
    }
    if (i < columns) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

export class MouthInterior {
  /** Add this to the face mesh: its children live in the mesh's geometry space. */
  readonly group = new THREE.Group();
  private jaw = new THREE.Group();
  /** The tongue follows the jaw only part of the way: it is a muscle, not a bone. */
  private tongueJaw = new THREE.Group();
  private teeth: THREE.MeshBasicMaterial[] = [];
  private tongue: THREE.MeshBasicMaterial;
  private pivot: THREE.Vector3;
  private jawAngle: number;

  constructor(layout: MouthLayout) {
    const hw = layout.halfWidth;
    const y0 = layout.seamY;
    const front = -0.3 * hw; // the front teeth sit a lip's thickness behind the lips
    this.pivot = new THREE.Vector3(0, layout.jawPivot.y, layout.jawPivot.z);
    this.jawAngle = layout.jawAngle;

    const space = new THREE.Group();
    space.matrixAutoUpdate = false;
    space.matrix.copy(layout.toGeometry);
    this.group.add(space);
    this.group.matrixAutoUpdate = false;
    this.jaw.matrixAutoUpdate = false;
    this.tongueJaw.matrixAutoUpdate = false;
    space.add(this.jaw, this.tongueJaw);

    const texture = teethTexture();
    const teeth = () => {
      const m = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
      this.teeth.push(m);
      return m;
    };
    // Upper teeth: fixed to the skull, their edge just below the lip seam so they show first when the lips part.
    space.add(new THREE.Mesh(archStrip(hw, front, y0 + 0.5 * hw, y0 - 0.08 * hw), teeth()));
    // Lower teeth: just behind the upper ones, moving with the jaw.
    this.jaw.add(new THREE.Mesh(archStrip(hw, front - 0.1 * hw, y0 - 0.55 * hw, y0 - 0.03 * hw), teeth()));

    const tongueMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.tongue = tongueMaterial;
    const tongueGeometry = new THREE.SphereGeometry(1, 28, 18);
    const tp = tongueGeometry.attributes.position;
    const tc = new Float32Array(tp.count * 3);
    for (let i = 0; i < tp.count; i++) {
      // Lit from the front and above; dark toward the throat.
      const light = THREE.MathUtils.clamp(0.42 + 0.4 * tp.getZ(i) + 0.3 * tp.getY(i), 0.15, 1);
      tc.set([light, light, light], i * 3);
    }
    tongueGeometry.setAttribute("color", new THREE.BufferAttribute(tc, 3));
    const tongue = new THREE.Mesh(tongueGeometry, tongueMaterial);
    tongue.scale.set(0.78 * hw, 0.3 * hw, 0.95 * hw);
    // It fills the floor of the mouth, so an open mouth shows tongue behind the lower teeth, not a black hole.
    tongue.position.set(0, y0 - 0.07 * hw - 0.3 * hw, front - 1.1 * hw);
    this.tongueJaw.add(tongue);

    // Whatever else is seen through the lips is the dark of the mouth. Only
    // the far inside wall of this shell is drawn, deep within the head.
    const cavity = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x1c0708, side: THREE.BackSide, toneMapped: false }),
    );
    cavity.scale.set(1.5 * hw, 1.25 * hw, 1.1 * hw);
    cavity.position.set(0, y0 - 0.2 * hw, front - 0.95 * hw);
    space.add(cavity);

    this.update(0, null);
  }

  /** `jaw` is 0 (closed) to 1; `head` is the head's turn in geometry space, if it has one. */
  update(jaw: number, head: THREE.Matrix4 | null) {
    if (head) this.group.matrix.copy(head);
    else this.group.matrix.identity();
    this.group.matrixWorldNeedsUpdate = true;
    const hinge = (group: THREE.Group, angle: number) => {
      group.matrix
        .makeTranslation(this.pivot.x, this.pivot.y, this.pivot.z)
        .multiply(_rotation.makeRotationX(angle))
        .multiply(_back.makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z));
      group.matrixWorldNeedsUpdate = true;
    };
    hinge(this.jaw, this.jawAngle * jaw);
    hinge(this.tongueJaw, this.jawAngle * jaw * 0.6);
    // Less light reaches the teeth through barely parted lips.
    const light = THREE.MathUtils.lerp(0.42, 0.78, Math.min(1, jaw * 1.6));
    for (const m of this.teeth) m.color.setScalar(light);
    this.tongue.color.setRGB(0.62 * light, 0.29 * light, 0.31 * light, THREE.SRGBColorSpace);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const material = m.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    });
    this.group.removeFromParent();
  }
}

const _rotation = new THREE.Matrix4();
const _back = new THREE.Matrix4();
