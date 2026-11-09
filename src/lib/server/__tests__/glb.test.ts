import { Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { inspectGlb, mergeCharacter } from "../glb";

/** A tiny "character": one triangle skinned to a two-bone chain. */
async function makeCharacter(withClip?: { name: string; yaw: number }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const hips = doc.createNode("Hips").setTranslation([0, 1, 0]);
  const head = doc.createNode("Head").setTranslation([0, 0.6, 0]);
  hips.addChild(head);
  const armature = doc.createNode("Armature").addChild(hips);
  const position = doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([0, 1, 0, 0.1, 1.6, 0, -0.1, 1.6, 0]));
  const joints = doc.createAccessor().setType("VEC4").setBuffer(buffer).setArray(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
  const weights = doc.createAccessor().setType("VEC4").setBuffer(buffer).setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("JOINTS_0", joints).setAttribute("WEIGHTS_0", weights);
  const skin = doc.createSkin("Armature").addJoint(hips).addJoint(head);
  const meshNode = doc.createNode("Mesh_0").setMesh(doc.createMesh("Mesh_0").addPrimitive(prim)).setSkin(skin);
  doc.createScene().addChild(armature).addChild(meshNode);
  if (withClip) {
    const times = doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Float32Array([0, 1]));
    const s = Math.sin(withClip.yaw / 2);
    const c = Math.cos(withClip.yaw / 2);
    const rots = doc.createAccessor().setType("VEC4").setBuffer(buffer).setArray(new Float32Array([0, 0, 0, 1, 0, s, 0, c]));
    const scales = doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([1, 1, 1, 2, 2, 2]));
    const anim = doc.createAnimation(`Armature|${withClip.name}|baselayer`);
    const rs = doc.createAnimationSampler().setInput(times).setOutput(rots);
    const ss = doc.createAnimationSampler().setInput(times).setOutput(scales);
    anim.addSampler(rs).addSampler(ss);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(head).setTargetPath("rotation").setSampler(rs));
    anim.addChannel(doc.createAnimationChannel().setTargetNode(head).setTargetPath("scale").setSampler(ss));
  }
  return new NodeIO().writeBinary(doc);
}

describe("mergeCharacter", () => {
  it("copies clips onto the rig by bone name and drops scale tracks", async () => {
    const rigged = await makeCharacter({ name: "clip0", yaw: 0 });
    const wave = await makeCharacter({ name: "Wave_One_Hand", yaw: 0.5 });
    const talk = await makeCharacter({ name: "Talk_with_Hands_Open", yaw: -0.3 });
    const out = await mergeCharacter({
      rigged,
      clips: [
        { name: "wave", data: wave },
        { name: "talk_open", data: talk },
      ],
      optimize: false,
    });
    expect(out.clips).toEqual(["wave", "talk_open"]);
    const info = await inspectGlb(out.glb);
    expect(info.animations).toEqual(["wave", "talk_open"]);
    expect(info.joints).toEqual(["Hips", "Head"]);

    const doc = await new NodeIO().readBinary(out.glb);
    const [waveAnim] = doc.getRoot().listAnimations();
    const channels = waveAnim.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].getTargetPath()).toBe("rotation");
    // The channel must target the rig's own Head node, not a copy.
    const rigHead = doc.getRoot().listNodes().filter((n) => n.getName() === "Head");
    expect(rigHead).toHaveLength(1);
    expect(channels[0].getTargetNode()).toBe(rigHead[0]);
    expect(Array.from(channels[0].getSampler()!.getOutput()!.getArray()!).slice(4, 8)[1]).toBeCloseTo(Math.sin(0.25), 5);
  });
});
