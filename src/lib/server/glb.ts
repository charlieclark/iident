import "server-only";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

/**
 * Combines Meshy's rigged character with the separately generated animation
 * clips into a single GLB that the browser loads once:
 *   mesh + skeleton + named clips ("idle", "wave", "talk_open", ...)
 * Each clip file Meshy returns duplicates the full mesh and texture, so only
 * the animation tracks are copied over, retargeted by bone name.
 * The result is then shrunk with WebP textures and lossless meshopt buffer
 * compression. Positions are deliberately NOT quantized: the face rig stores
 * landmarks in the mesh's geometry space, which should stay in meters.
 */

async function io() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

function nodesByName(doc: Document) {
  const map = new Map<string, GltfNode>();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (name && !map.has(name)) map.set(name, node);
  }
  return map;
}

export async function mergeCharacter(params: {
  rigged: Uint8Array;
  clips: { name: string; data: Uint8Array }[];
  optimize?: boolean;
}): Promise<{ glb: Uint8Array; clips: string[] }> {
  const nodeIO = await io();
  const base = await nodeIO.readBinary(params.rigged);
  const root = base.getRoot();
  const buffer = root.listBuffers()[0] ?? base.createBuffer();

  // Meshy ships a one-frame bind-pose clip with the rig; it is not useful.
  for (const anim of root.listAnimations()) anim.dispose();

  const targets = nodesByName(base);
  const merged: string[] = [];

  for (const clip of params.clips) {
    const src = await nodeIO.readBinary(clip.data);
    const srcAnim = src.getRoot().listAnimations()[0];
    if (!srcAnim) continue;
    const anim = base.createAnimation(clip.name);
    let channels = 0;
    for (const channel of srcAnim.listChannels()) {
      const target = channel.getTargetNode();
      const path = channel.getTargetPath();
      const sampler = channel.getSampler();
      const input = sampler?.getInput();
      const output = sampler?.getOutput();
      const dest = target ? targets.get(target.getName()) : undefined;
      if (!dest || !path || !sampler || !input || !output) continue;
      // Only bones are animated; skip scale tracks to avoid squash artifacts.
      if (path === "scale") continue;
      const inArr = input.getArray();
      const outArr = output.getArray();
      if (!inArr || !outArr) continue;
      const newIn = base
        .createAccessor()
        .setType(input.getType())
        .setArray(inArr.slice() as typeof inArr)
        .setBuffer(buffer);
      const newOut = base
        .createAccessor()
        .setType(output.getType())
        .setArray(outArr.slice() as typeof outArr)
        .setBuffer(buffer);
      const newSampler = base
        .createAnimationSampler()
        .setInput(newIn)
        .setOutput(newOut)
        .setInterpolation(sampler.getInterpolation());
      const newChannel = base
        .createAnimationChannel()
        .setTargetNode(dest)
        .setTargetPath(path)
        .setSampler(newSampler);
      anim.addSampler(newSampler).addChannel(newChannel);
      channels++;
    }
    if (channels > 0) merged.push(clip.name);
    else anim.dispose();
  }

  if (params.optimize !== false) {
    await base.transform(
      dedup(),
      prune({ keepLeaves: true, keepAttributes: true }),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 88 }),
      reorder({ encoder: MeshoptEncoder, target: "size" }),
    );
    base
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  }

  return { glb: await nodeIO.writeBinary(base), clips: merged };
}

/** Basic facts about a GLB, used in tests and for sanity checks. */
export async function inspectGlb(data: Uint8Array) {
  const doc = await (await io()).readBinary(data);
  const root = doc.getRoot();
  return {
    animations: root.listAnimations().map((a) => a.getName()),
    joints: root.listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [],
    meshes: root.listMeshes().length,
    textures: root.listTextures().map((t) => t.getMimeType()),
  };
}
