"use client";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { FaceDriver } from "./faceDriver";
import { findCharacterMesh } from "./faceRigger";
import { LipSync } from "./lipsync";
import type { FaceRig } from "./types";

export type AvatarMood = "idle" | "listening" | "thinking" | "talking";
export type Framing = "full" | "portrait";

export type PlayerOptions = {
  framing?: Framing;
  /** Let the viewer orbit and zoom. */
  controls?: boolean;
  /** Paint eyelid blinks (disable for characters wearing glasses). */
  blinks?: boolean;
};

const TALK_CLIPS = ["talk_open", "talk_right", "agree", "talk_open", "talk_right", "shrug"];
const ONE_SHOT = new Set(["wave", "agree", "shrug", "talk_open", "talk_right"]);

/**
 * Renders a generated character and brings it to life: animation state
 * machine, procedural look-at, blinks, and audio-driven lip sync.
 * Framework agnostic; the React wrapper only mounts and disposes it.
 */
export class AvatarPlayer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  private controls: OrbitControls | null = null;
  private clock = new THREE.Clock();
  private frame = 0;
  private resizeObserver: ResizeObserver;

  private root: THREE.Object3D | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private bones: Record<string, THREE.Bone | undefined> = {};
  private face: FaceDriver | null = null;
  private height = 1.7;
  private headHeight = 1.55;

  private mood: AvatarMood = "idle";
  private framing: Framing;
  private camFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private camTo = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private camT = 1;

  private look = { yaw: 0, pitch: 0 };
  private blink = { next: 2, t: -1, double: false };
  private talkIndex = 0;

  private audio: AudioContext | null = null;
  private lipsync: LipSync | null = null;
  private expected = new Set<number>();
  private ready = new Map<number, AudioBuffer | null>();
  private replyDone = false;
  private generation = 0;
  private nextChunk = 0;
  private activeSource: AudioBufferSourceNode | null = null;
  private speechEndTimer: ReturnType<typeof setTimeout> | null = null;
  private speaking = false;
  private gain: GainNode | null = null;

  private speakingListeners = new Set<(speaking: boolean) => void>();

  /** Subscribe to speaking state changes; returns an unsubscribe function. */
  onSpeaking(listener: (speaking: boolean) => void) {
    this.speakingListeners.add(listener);
    return () => {
      this.speakingListeners.delete(listener);
    };
  }
  /** Developer override for the mouth shape (testing the face rig). */
  debugMouth: { jaw: number; wide: number; round: number } | null = null;
  debugBlink: number | null = null;

  constructor(
    private container: HTMLElement,
    private options: PlayerOptions = {},
  ) {
    this.framing = options.framing ?? "full";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff4e8, 1.9);
    key.position.set(1.2, 2.6, 2.4);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 1.1);
    rim.position.set(-1.6, 2.2, -1.8);
    const fill = new THREE.HemisphereLight(0xffffff, 0xd9cbbd, 0.6);
    this.scene.add(key, rim, fill);
    this.scene.add(contactShadow());

    if (options.controls) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.enablePan = false;
      this.controls.minPolarAngle = Math.PI * 0.32;
      this.controls.maxPolarAngle = Math.PI * 0.58;
      this.controls.minAzimuthAngle = -Math.PI * 0.45;
      this.controls.maxAzimuthAngle = Math.PI * 0.45;
      this.controls.addEventListener("start", () => (this.camT = 1));
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- loading

  async load(url: string, opts: { faceRig?: FaceRig | null; heightMeters?: number } = {}) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    this.unload();

    const root = gltf.scene;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.map) std.map.anisotropy = 4;
          if ("roughness" in std) std.roughness = Math.max(std.roughness, 0.65);
          if ("metalness" in std) std.metalness = 0;
        }
      }
      const b = o as THREE.Bone;
      if (b.isBone) {
        this.bones[b.name] = b;
        this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
      }
    });
    this.scene.add(root);
    this.root = root;
    this.mesh = findCharacterMesh(root);

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    this.height = Math.max(0.5, box.max.y - box.min.y);
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
    const head = this.bones.Head ?? this.bones.head;
    this.headHeight = head ? head.getWorldPosition(new THREE.Vector3()).y : this.height * 0.88;

    const hips = this.bones.Hips ?? this.bones.hips;
    for (const clip of gltf.animations) {
      stabilizeRootMotion(clip);
      if (hips) this.withRestPose(() => faceViewer(root, clip, hips));
    }

    this.mixer = new THREE.AnimationMixer(root);
    this.mixer.addEventListener("finished", (e) => this.onClipFinished(e.action as THREE.AnimationAction));
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }

    if (opts.faceRig) this.applyFaceRig(opts.faceRig);
    this.setFraming(this.framing, true);
    this.setMood("idle", true);
    return root;
  }

  /** Root of the loaded character, in bind pose until animations start. */
  get character() {
    return this.root;
  }

  applyFaceRig(rig: FaceRig) {
    if (!this.mesh || this.face) return;
    this.face = new FaceDriver(this.mesh, rig, { blinks: this.options.blinks !== false });
  }

  get hasFace() {
    return !!this.face;
  }

  get clips() {
    return [...this.actions.keys()];
  }

  private unload() {
    this.stopSpeech();
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat.dispose());
        }
      });
    }
    this.root = null;
    this.restPose.clear();
    this.rest.clear();
    this.headRestInv = null;
    this.mesh = null;
    this.face = null;
    this.mixer = null;
    this.actions.clear();
    this.current = null;
    this.bones = {};
  }

  // -------------------------------------------------------------- animation

  private play(name: string, fade = 0.45) {
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next || next === this.current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    next.play();
    if (this.current) next.crossFadeFrom(this.current, fade, true);
    this.current = next;
  }

  private onClipFinished(action: THREE.AnimationAction) {
    if (action !== this.current) return;
    if (this.mood === "talking") this.play(this.nextTalkClip(), 0.5);
    else this.play(this.moodClip(), 0.6);
  }

  private moodClip() {
    if (this.mood === "thinking" && this.actions.has("think")) return "think";
    // Meshy's "Listening_Gesture" is a calm, square stance: a better resting
    // loop for conversation than its "Idle", which leans away from camera.
    if (this.actions.has("listen")) return "listen";
    return "idle";
  }

  private nextTalkClip() {
    for (let i = 0; i < TALK_CLIPS.length; i++) {
      const name = TALK_CLIPS[this.talkIndex++ % TALK_CLIPS.length];
      if (this.actions.has(name)) return name;
    }
    return "idle";
  }

  private thinkTimer: ReturnType<typeof setTimeout> | null = null;

  setMood(mood: AvatarMood, force = false) {
    if (mood === this.mood && !force) return;
    this.mood = mood;
    if (this.thinkTimer) clearTimeout(this.thinkTimer);
    this.thinkTimer = null;
    if (mood === "thinking") {
      // Only scratch the head if the reply is slow to arrive.
      this.thinkTimer = setTimeout(() => {
        this.thinkTimer = null;
        if (this.mood === "thinking") this.play(this.moodClip(), 0.6);
      }, 1200);
      return;
    }
    if (mood === "talking") {
      if (!this.current || !ONE_SHOT.has(this.current.getClip().name) || force) this.play(this.nextTalkClip(), 0.4);
    } else {
      this.play(this.moodClip(), mood === "idle" ? 0.7 : 0.5);
    }
  }

  wave() {
    if (this.actions.has("wave")) this.play("wave", 0.35);
  }

  // ----------------------------------------------------------------- camera

  setFraming(framing: Framing, instant = false) {
    this.framing = framing;
    const h = this.height;
    const target = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const aspect = this.camera.aspect || 1;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    if (framing === "portrait") {
      const span = Math.max(0.62, (h * 0.42) / Math.min(1, aspect * 1.1));
      target.set(0, this.headHeight - h * 0.08, 0);
      const dist = span / 2 / Math.tan(vfov / 2);
      pos.set(0, target.y + 0.03, dist);
    } else {
      const span = (h * 1.12) / Math.min(1, aspect * 1.6);
      target.set(0, h * 0.5, 0);
      const dist = span / 2 / Math.tan(vfov / 2);
      pos.set(0, h * 0.55, dist);
    }
    this.camFrom.pos.copy(this.camera.position);
    this.camFrom.target.copy(this.controls?.target ?? this.camTo.target);
    this.camTo.pos.copy(pos);
    this.camTo.target.copy(target);
    this.camT = instant ? 1 : 0;
    if (instant) {
      this.camera.position.copy(pos);
      this.controls?.target.copy(target);
      this.camera.lookAt(target);
    }
    if (this.controls) {
      this.controls.minDistance = framing === "portrait" ? pos.length() * 0.5 : 1.2;
      this.controls.maxDistance = pos.distanceTo(target) * 1.6 + 0.5;
    }
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.root) this.setFraming(this.framing, true);
  }

  // ----------------------------------------------------------------- speech

  /** Must be called from a user gesture before audio can play. */
  async unlockAudio() {
    if (!this.audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audio = new Ctx();
      this.lipsync = new LipSync(this.audio);
      this.gain = this.audio.createGain();
      this.lipsync.analyser.connect(this.gain);
      this.gain.connect(this.audio.destination);
    }
    if (this.audio.state === "suspended") await this.audio.resume();
  }

  /** Announce that speech chunk `index` is coming (keeps playback in order). */
  expectSpeech(index: number) {
    if (index >= this.nextChunk && !this.ready.has(index)) this.expected.add(index);
  }

  /**
   * Queue a chunk of speech. Chunks play strictly in index order even if
   * their audio arrives out of order.
   */
  enqueueSpeech(url: string, index: number) {
    if (!this.audio) return;
    const ctx = this.audio;
    const generation = this.generation;
    this.expected.add(index);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`audio ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => ctx.decodeAudioData(buf))
      .catch((err) => {
        console.warn("Speech chunk failed", err);
        return null;
      })
      .then((buffer) => {
        if (generation !== this.generation) return;
        this.expected.delete(index);
        this.ready.set(index, buffer);
        this.pump();
      });
  }

  /** Skip a chunk whose speech could not be produced. */
  skipSpeech(index: number) {
    this.expected.delete(index);
    this.ready.set(index, null);
    this.pump();
  }

  /** Resets the chunk counter for a new reply. */
  beginReply() {
    this.stopSpeech();
    this.nextChunk = 0;
  }

  private pump() {
    if (!this.audio || !this.lipsync || this.activeSource) return;
    while (this.ready.has(this.nextChunk) && this.ready.get(this.nextChunk) === null) {
      this.ready.delete(this.nextChunk);
      this.nextChunk++;
    }
    const buffer = this.ready.get(this.nextChunk);
    if (!buffer) {
      if (this.replyDone && this.expected.size === 0 && this.ready.size === 0) this.finishSpeechSoon();
      return;
    }
    this.ready.delete(this.nextChunk);
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    source.connect(this.lipsync.analyser);
    source.onended = () => {
      if (this.activeSource !== source) return;
      this.activeSource = null;
      this.nextChunk++;
      this.pump();
    };
    this.activeSource = source;
    if (this.speechEndTimer) clearTimeout(this.speechEndTimer);
    this.speechEndTimer = null;
    this.setSpeaking(true);
    source.start();
  }

  private finishSpeechSoon() {
    if (this.speechEndTimer) return;
    this.speechEndTimer = setTimeout(() => {
      this.speechEndTimer = null;
      if (!this.activeSource && this.expected.size === 0 && this.ready.size === 0) {
        this.setSpeaking(false);
        if (this.mood === "thinking") this.setMood("idle");
      }
    }, 350);
  }

  /** Called when the server says the reply is complete. */
  endReply() {
    this.replyDone = true;
    this.pump();
  }

  stopSpeech() {
    this.generation++;
    if (this.activeSource) {
      this.activeSource.onended = null;
      try {
        this.activeSource.stop();
      } catch {}
    }
    this.activeSource = null;
    this.expected.clear();
    this.ready.clear();
    this.replyDone = false;
    if (this.speechEndTimer) clearTimeout(this.speechEndTimer);
    this.speechEndTimer = null;
    this.setSpeaking(false);
  }

  private setSpeaking(on: boolean) {
    if (on === this.speaking) return;
    this.speaking = on;
    this.setMood(on ? "talking" : "idle");
    for (const l of this.speakingListeners) l(on);
  }

  get isSpeaking() {
    return this.speaking;
  }

  // ------------------------------------------------------------------ frame

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    // Undo last frame's procedural offsets so bones a clip doesn't animate
    // don't accumulate rotation.
    for (const [bone, q] of this.restPose) bone.quaternion.copy(q);
    this.mixer?.update(dt);
    this.animateCamera(dt);
    this.proceduralHead(dt, t);
    this.animateFace(dt, t);
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  };

  private animateCamera(dt: number) {
    if (this.camT >= 1) return;
    this.camT = Math.min(1, this.camT + dt / 0.9);
    const k = 1 - Math.pow(1 - this.camT, 3);
    this.camera.position.lerpVectors(this.camFrom.pos, this.camTo.pos, k);
    const target = new THREE.Vector3().lerpVectors(this.camFrom.target, this.camTo.target, k);
    if (this.controls) this.controls.target.copy(target);
    this.camera.lookAt(target);
  }

  private level = 0;
  private restPose = new Map<THREE.Object3D, THREE.Quaternion>();
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();

  /**
   * Runs `fn` with every bone in its rest (bind) pose, then restores the
   * animated pose. Used to measure the character, e.g. for face rigging.
   */
  withRestPose = <T,>(fn: () => T): T => {
    const saved = [...this.rest.keys()].map((b) => ({ b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    this.root?.updateMatrixWorld(true);
    try {
      return fn();
    } finally {
      for (const { b, p, q, s } of saved) {
        b.position.copy(p);
        b.quaternion.copy(q);
        b.scale.copy(s);
      }
      this.root?.updateMatrixWorld(true);
    }
  };

  private headRestInv: THREE.Quaternion | null = null;

  /**
   * Turns the head toward the viewer on top of the animation. The animated
   * head direction is measured each frame and the remaining yaw/pitch error
   * is corrected (partly by the neck), so clips that look away still end up
   * making eye contact.
   */
  private proceduralHead(dt: number, t: number) {
    const head = this.bones.Head ?? this.bones.head;
    const neck = this.bones.neck ?? this.bones.Neck;
    if (!head || !this.root) return;
    for (const bone of [head, neck]) {
      if (!bone) continue;
      const saved = this.restPose.get(bone);
      if (saved) saved.copy(bone.quaternion);
      else this.restPose.set(bone, bone.quaternion.clone());
    }
    if (!this.headRestInv) {
      this.headRestInv = this.withRestPose(() => head.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    this.root.updateMatrixWorld(true);
    const q = head.getWorldQuaternion(new THREE.Quaternion()).multiply(this.headRestInv);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const toCam = this.camera.position.clone().sub(head.getWorldPosition(new THREE.Vector3()));
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const errYaw = wrap(Math.atan2(toCam.x, toCam.z) - Math.atan2(fwd.x, fwd.z));
    const errPitch =
      Math.atan2(toCam.y, Math.hypot(toCam.x, toCam.z)) - Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));

    const gesturing = this.current && ["wave", "think", "shrug"].includes(this.current.getClip().name);
    const weight = gesturing ? 0.35 : 0.85;
    const targetYaw = THREE.MathUtils.clamp(errYaw, -0.7, 0.7) * weight;
    const targetPitch = THREE.MathUtils.clamp(errPitch, -0.3, 0.3) * weight;
    const k = 1 - Math.exp(-5 * dt);
    this.look.yaw += (targetYaw - this.look.yaw) * k;
    this.look.pitch += (targetPitch - this.look.pitch) * k;

    const nod = this.speaking ? Math.sin(t * 7.3) * 0.03 * this.level + Math.sin(t * 2.1) * 0.012 : 0;
    const sway = Math.sin(t * 0.7) * 0.015;
    const side = new THREE.Vector3(toCam.z, 0, -toCam.x).normalize();
    rotateBoneWorld(neck ?? head, new THREE.Vector3(0, 1, 0), this.look.yaw * 0.4);
    rotateBoneWorld(head, new THREE.Vector3(0, 1, 0), this.look.yaw * 0.6 + sway);
    rotateBoneWorld(head, side, -(this.look.pitch + nod));
  }

  private animateFace(dt: number, t: number) {
    const face = this.face;
    // mouth
    let shape = { jaw: 0, wide: 0, round: 0, level: 0 };
    if (this.lipsync) shape = this.speaking ? this.lipsync.sample() : this.lipsync.rest(dt);
    if (this.debugMouth) shape = { ...this.debugMouth, level: this.debugMouth.jaw };
    this.level = shape.level;
    if (!face) return;
    face.state.jaw = shape.jaw;
    face.state.wide = shape.wide;
    face.state.round = shape.round;

    // blinks
    const b = this.blink;
    if (b.t < 0 && t > b.next) b.t = 0;
    let lid = 0;
    if (b.t >= 0) {
      b.t += dt;
      const close = 0.07;
      const hold = 0.03;
      const open = 0.1;
      if (b.t < close) lid = b.t / close;
      else if (b.t < close + hold) lid = 1;
      else if (b.t < close + hold + open) lid = 1 - (b.t - close - hold) / open;
      else {
        b.t = -1;
        const again = !b.double && Math.random() < 0.18;
        b.double = again;
        b.next = t + (again ? 0.12 : 2.2 + Math.random() * 3.6);
      }
    }
    if (this.debugBlink !== null) lid = this.debugBlink;
    face.state.blinkLeft = lid;
    face.state.blinkRight = lid;
    face.update();
  }

  /** PNG snapshot of the current view (used for share thumbnails). */
  snapshot(width = 600, height = 800): string {
    const prev = this.renderer.getSize(new THREE.Vector2());
    const prevAspect = this.camera.aspect;
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prev.x, prev.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    if (this.thinkTimer) clearTimeout(this.thinkTimer);
    this.resizeObserver.disconnect();
    this.unload();
    this.controls?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.audio?.close().catch(() => {});
  }
}

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

/** Rotate a bone about a world-space axis, on top of its animated pose. */
function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!angle) return;
  const parent = bone.parent;
  if (parent) parent.getWorldQuaternion(_pq);
  else _pq.identity();
  _q.setFromAxisAngle(axis, angle);
  // local delta = parent^-1 * world delta * parent
  const delta = _pq.clone().invert().multiply(_q).multiply(_pq);
  bone.quaternion.premultiply(delta);
}

/** Keeps clips in place: removes horizontal drift from the hips track. */
function stabilizeRootMotion(clip: THREE.AnimationClip) {
  for (const track of clip.tracks) {
    if (!/hips\.position$/i.test(track.name)) continue;
    const v = track.values;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
}

/**
 * Library clips often turn the whole body away from the camera (the idle
 * stands at ~40 degrees). Measures the average yaw of the hips over the clip
 * and rotates the hips track back so the character faces the viewer.
 */
function faceViewer(root: THREE.Object3D, clip: THREE.AnimationClip, hips: THREE.Bone) {
  const quatTrack = clip.tracks.find((t) => t.name === `${hips.name}.quaternion`);
  if (!quatTrack || !hips.parent) return;
  root.updateMatrixWorld(true);
  const restInv = hips.getWorldQuaternion(new THREE.Quaternion()).invert();
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  let sx = 0;
  let sz = 0;
  const q = new THREE.Quaternion();
  const f = new THREE.Vector3();
  const samples = 12;
  for (let k = 0; k < samples; k++) {
    mixer.setTime((clip.duration * k) / samples);
    root.updateMatrixWorld(true);
    hips.getWorldQuaternion(q).multiply(restInv);
    f.set(0, 0, 1).applyQuaternion(q);
    sx += f.x;
    sz += f.z;
  }
  action.stop();
  mixer.uncacheRoot(root);
  const yaw = Math.atan2(sx, sz);
  if (Math.abs(yaw) < 0.03) return;

  // Rotate about world up, expressed in the hips' parent space.
  const parentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(parentQ.clone().invert()).normalize();
  const fix = new THREE.Quaternion().setFromAxisAngle(up, -yaw);
  const v = quatTrack.values;
  for (let i = 0; i < v.length; i += 4) {
    q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(fix).normalize();
    v[i] = q.x;
    v[i + 1] = q.y;
    v[i + 2] = q.z;
    v[i + 3] = q.w;
  }
  const posTrack = clip.tracks.find((t) => t.name === `${hips.name}.position`);
  if (posTrack) {
    const pv = posTrack.values;
    const p = new THREE.Vector3();
    for (let i = 0; i < pv.length; i += 3) {
      p.set(pv[i], pv[i + 1], pv[i + 2]).applyQuaternion(fix);
      pv[i] = p.x;
      pv[i + 1] = p.y;
      pv[i + 2] = p.z;
    }
  }
}

function contactShadow() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.32)");
  g.addColorStop(0.45, "rgba(0,0,0,0.14)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.002;
  plane.renderOrder = -1;
  return plane;
}
