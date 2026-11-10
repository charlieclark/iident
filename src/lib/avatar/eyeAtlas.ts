import * as THREE from "three";
import type { FaceRig, Vec3 } from "./types";

/**
 * A straight-on picture of each eye and the skin around it, taken from the
 * model itself with its mouth closed and eyes open.
 *
 * A generated head has its eyes painted on its surface, so they cannot turn
 * and its eyelids cannot move. With this picture the face shader can redraw
 * the eye region: the iris a little to one side for a glance, or the skin
 * above the lashes pulled down over the eye for a blink, using the person's
 * own iris and eyelid instead of flat colours.
 *
 * The left half of the texture is the eye on the viewer's left. Each half
 * covers a square of `extent` (in the mesh's geometry units) to every side
 * of the eye's centre, seen along the face's forward axis.
 */

export type EyeAtlas = { texture: THREE.Texture; target: THREE.WebGLRenderTarget; extent: [number, number]; dispose: () => void };

/** How far the picture reaches from the centre of the eye, in half eye-widths. */
const REACH = 1.8;
const SIZE = 256;
/**
 * Nothing further than this in front of the corners of the eye (in half
 * eye-widths) is the eye itself: the eyeball and lids bulge about one half
 * eye-width forward, and glasses sit further out. The face shader leaves
 * anything beyond it alone.
 */
export const EYE_DEPTH = 1.35;

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

export function bakeEyeAtlas(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, rig: FaceRig): EyeAtlas {
  const target = new THREE.WebGLRenderTarget(SIZE * 2, SIZE, { depthBuffer: true });
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  target.scissorTest = true;

  // The model as it was made: no expressions, no head turn, no lighting.
  const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  // Glasses stand in front of the eyes and would be photographed instead of
  // them. So within the thin slab of space the eye occupies, the surface
  // furthest from the camera is kept, not the nearest: the skin behind the
  // frames.
  const flat = new THREE.MeshBasicMaterial({
    map: source.map ?? null,
    color: source.map ? 0xffffff : source.color,
    toneMapped: false,
    depthFunc: THREE.GreaterDepth,
  });
  const copy = new THREE.Mesh(mesh.geometry, flat);
  copy.matrixAutoUpdate = false;
  mesh.updateWorldMatrix(true, false);
  copy.matrix.copy(mesh.matrixWorld);
  copy.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(copy);

  const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld).x;
  const up = v3(rig.up).transformDirection(mesh.matrixWorld);
  const forward = v3(rig.forward).transformDirection(mesh.matrixWorld);
  const extent: [number, number] = [0, 0];

  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  // "Furthest wins" starts from the nearest possible depth.
  renderer.state.buffers.depth.setClear(0);
  [rig.eyes.left, rig.eyes.right].forEach((eye, i) => {
    const half = v3(eye.inner).distanceTo(v3(eye.outer)) / 2;
    extent[i] = REACH * half;
    const centre = v3(eye.inner).add(v3(eye.outer)).multiplyScalar(0.5).applyMatrix4(mesh.matrixWorld);
    const reach = extent[i] * scale;
    const distance = reach * 6;
    // The slab starts far enough out to include the brow, which stands well
    // forward of the eye (a blink draws on the skin under it), and ends just
    // behind the eye, before the hair and ears at the side of the head.
    const camera = new THREE.OrthographicCamera(-reach, reach, reach, -reach, distance - 3.5 * half * scale, distance + 1.5 * half * scale);
    camera.position.copy(centre).addScaledVector(forward, distance);
    camera.up.copy(up);
    camera.lookAt(centre);
    target.viewport.set(i * SIZE, 0, SIZE, SIZE);
    target.scissor.set(i * SIZE, 0, SIZE, SIZE);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
  });
  renderer.state.buffers.depth.setClear(1);
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, clearAlpha);
  flat.dispose();

  return { texture: target.texture, target, extent, dispose: () => target.dispose() };
}
