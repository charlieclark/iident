import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type Call = { url: string; init: RequestInit };

function mockFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const call = { url: String(url), init };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}

/** A response body that arrives in the given chunks. */
function chunked(...parts: number[][]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(new Uint8Array(p));
      controller.close();
    },
  });
}

describe("Fish Audio client", () => {
  let fish: typeof import("../fish");

  beforeAll(async () => {
    process.env.FISH_API_KEY = "test-key";
    fish = await import("../fish");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads a recording as a private fast model", async () => {
    const calls = mockFetch(() => Response.json({ _id: "model-1", state: "trained" }, { status: 201 }));
    const id = await fish.createVoiceModel({
      title: "iident Sam",
      audio: new Uint8Array([1, 2, 3]),
      filename: "voice.wav",
      contentType: "audio/wav",
      description: "Voice for iident avatar a1",
    });
    expect(id).toBe("model-1");
    const { url, init } = calls[0];
    expect(url).toBe("https://api.fish.audio/model");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const form = init.body as FormData;
    expect(Object.fromEntries([...form.entries()].filter(([k]) => k !== "voices"))).toEqual({
      type: "tts",
      train_mode: "fast",
      visibility: "private",
      title: "iident Sam",
      description: "Voice for iident avatar a1",
    });
    expect((form.get("voices") as File).name).toBe("voice.wav");
  });

  it("rejects a model Fish could not build", async () => {
    mockFetch(() => Response.json({ _id: "model-1", state: "failed" }, { status: 201 }));
    await expect(
      fish.createVoiceModel({ title: "x", audio: new Uint8Array(1), filename: "v.wav", contentType: "audio/wav" }),
    ).rejects.toThrow(/could not build/);
  });

  it("streams 24 kHz PCM in whole samples from the model", async () => {
    const calls = mockFetch(() => new Response(chunked([1, 2, 3], [4, 5], [6])));
    const chunks: number[][] = [];
    for await (const c of fish.streamSpeech({ text: "Hello there.", voiceId: "model-1" })) chunks.push([...c]);
    expect(chunks).toEqual([[1, 2], [3, 4], [5, 6]]);
    const { url, init } = calls[0];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect((init.headers as Record<string, string>).model).toBe("s2.1-pro");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Hello there.",
      reference_id: "model-1",
      format: "pcm",
      sample_rate: 24000,
      latency: "balanced",
      normalize: true,
    });
  });

  it("tells a missing voice model apart from other failures", async () => {
    mockFetch(() => Response.json({ status: 404, message: "Model not found" }, { status: 404 }));
    const missing = await fish.speechMp3({ text: "Hi", voiceId: "gone" }).catch((e) => e);
    expect(missing.message).toContain("Model not found");
    expect(fish.isMissingVoice(missing)).toBe(true);

    mockFetch(() => Response.json({ status: 402, message: "Insufficient balance" }, { status: 402 }));
    const broke = await fish.speechMp3({ text: "Hi", voiceId: "model-1" }).catch((e) => e);
    expect(fish.isMissingVoice(broke)).toBe(false);
  });
});
