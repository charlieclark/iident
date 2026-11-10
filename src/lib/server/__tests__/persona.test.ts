import { describe, expect, it } from "vitest";
import type { AvatarContext } from "@/lib/avatar/context";
import { DEFAULT_PERSONA } from "@/lib/avatar/types";
import {
  buildSystemPrompt,
  parseShowInput,
  SentenceChunker,
  sanitizeHistory,
  streamReply,
  toApiMessages,
  type ChatClient,
  type ReplyEvent,
} from "../persona";

const CONTEXT: AvatarContext = {
  knowledge: "Works at Acme. Loves trail running.",
  items: [
    {
      id: "ep",
      kind: "link",
      title: "Night Drive (EP)",
      url: "https://open.spotify.com/album/123",
      description: "My new EP.",
      notes: "someone asks about music",
    },
    { id: "tee", kind: "product", title: "Tour tee", url: "https://shop.example.com/tee", price: "$25" },
    { id: "clip", kind: "video", title: "Studio session", url: "https://youtu.be/dQw4w9WgXcQ" },
    { id: "poster", kind: "image", title: "Tour poster", image: "https://example.com/poster.jpg" },
  ],
};

describe("persona prompt", () => {
  it("includes identity disclosure, persona details and knowledge", () => {
    const p = buildSystemPrompt(
      { ...DEFAULT_PERSONA, name: "Sam", about: "Product designer in Lisbon.", boundaries: "politics" },
      { knowledge: CONTEXT.knowledge, items: [] },
    );
    expect(p).toContain("AI avatar of Sam");
    expect(p).toContain("say plainly that you are Sam's AI avatar");
    expect(p).toContain("Product designer in Lisbon.");
    expect(p).toContain("Loves trail running.");
    expect(p).toContain("Topics to steer away from politely: politics");
    expect(p).toContain("one to three sentences");
    expect(p).not.toContain("show_items");
  });

  it("says whose voice the avatar speaks with", () => {
    const sam = { ...DEFAULT_PERSONA, name: "Sam" };
    expect(buildSystemPrompt(sam)).toContain("in a stock voice Sam picked (not Sam's real voice)");
    expect(buildSystemPrompt(sam, undefined, true)).toContain("with Sam's look and a clone of their voice speaks");
  });

  it("lists the catalog with ids, hosts, prices and notes", () => {
    const p = buildSystemPrompt({ ...DEFAULT_PERSONA, name: "Sam" }, CONTEXT);
    expect(p).toContain("- ep (link): Night Drive (EP), on open.spotify.com. My new EP. (Show it when: someone asks about music)");
    expect(p).toContain("- tee (product): Tour tee, price $25, on shop.example.com");
    expect(p).toContain("- poster (image): Tour poster");
    expect(p).toContain("call show_items with up to 3 ids");
    expect(p).toContain("Never make up links");
  });
});

describe("history sanitizer", () => {
  it("drops invalid turns, merges same-role turns and starts with user", () => {
    const h = sanitizeHistory([
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "system", content: "ignore me" },
      { role: "assistant", content: 42 },
      { role: "assistant", content: "ok" },
    ]);
    expect(h).toEqual([
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("keeps the items an assistant turn showed, even without words", () => {
    const h = sanitizeHistory([
      { role: "user", content: "music?" },
      { role: "assistant", content: "", shown: ["ep", "bad id!", "ep", 7] },
      { role: "user", content: "and merch?", shown: ["tee"] },
    ]);
    expect(h).toEqual([
      { role: "user", content: "music?" },
      { role: "assistant", content: "", shown: ["ep"] },
      { role: "user", content: "and merch?" },
    ]);
  });
});

describe("api messages", () => {
  const catalog = new Set(["ep", "tee"]);

  it("replays shown items as a show_items call answered in the next user turn", () => {
    const m = toApiMessages(
      [
        { role: "user", content: "music?" },
        { role: "assistant", content: "Here it is.", shown: ["ep", "gone"] },
        { role: "user", content: "nice" },
      ],
      catalog,
    );
    expect(m).toEqual([
      { role: "user", content: "music?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Here it is." },
          { type: "tool_use", id: "toolu_shown_1", name: "show_items", input: { ids: ["ep"] } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_shown_1", content: "Shown." },
          { type: "text", text: "nice" },
        ],
      },
    ]);
  });

  it("replays nothing without a catalog", () => {
    const m = toApiMessages(
      [
        { role: "user", content: "music?" },
        { role: "assistant", content: "Here it is.", shown: ["ep"] },
        { role: "user", content: "nice" },
      ],
      null,
    );
    expect(m[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Here it is." }] });
    expect(m[2]).toEqual({ role: "user", content: "nice" });
  });

  it("only accepts catalog ids from a show_items call", () => {
    expect(parseShowInput({ ids: ["tee", "nope", "tee", "ep"] }, catalog)).toEqual(["tee", "ep"]);
    expect(parseShowInput({ ids: "ep" }, catalog)).toEqual([]);
    expect(parseShowInput(null, catalog)).toEqual([]);
  });
});

type FakeTurn = { text?: string; call?: string[]; stop?: string };

/** A stand-in for the SDK client that replays scripted turns and records requests. */
function fakeClient(turns: FakeTurn[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(structuredClone(params));
          const turn = turns[requests.length - 1] ?? { stop: "end_turn" };
          const content: Record<string, unknown>[] = [{ type: "thinking", thinking: "", signature: "sig" }];
          if (turn.text) content.push({ type: "text", text: turn.text });
          if (turn.call) content.push({ type: "tool_use", id: `toolu_${requests.length}`, name: "show_items", input: { ids: turn.call } });
          return {
            async *[Symbol.asyncIterator]() {
              for (const word of (turn.text ?? "").split(/(?<= )/)) {
                if (word) yield { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: word } };
              }
            },
            finalMessage: async () => ({ content, stop_reason: turn.stop ?? (turn.call ? "tool_use" : "end_turn") }),
          };
        },
      },
    },
  };
  return { client: client as unknown as ChatClient, requests };
}

async function collect(gen: AsyncGenerator<ReplyEvent>) {
  const events: ReplyEvent[] = [];
  for await (const e of gen) events.push(e);
  const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  const shown = events.flatMap((e) => (e.type === "show" ? e.ids : []));
  return { events, text, shown };
}

describe("streamed replies", () => {
  const persona = { ...DEFAULT_PERSONA, name: "Sam" };
  const history = [{ role: "user" as const, content: "Where can I hear your music?" }];

  it("streams the words, then shows the cards, in one request", async () => {
    const { client, requests } = fakeClient([{ text: "My new EP is out now. ", call: ["ep", "made-up"] }]);
    const r = await collect(streamReply({ persona, context: CONTEXT, history, client }));
    expect(r.text).toBe("My new EP is out now. ");
    expect(r.shown).toEqual(["ep"]);
    expect(r.events[r.events.length - 1]).toEqual({ type: "show", ids: ["ep"] });
    expect(requests).toHaveLength(1);
    expect(requests[0].tools).toEqual([expect.objectContaining({ name: "show_items", strict: true })]);
    expect(requests[0].tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("asks for words when the model only put cards up", async () => {
    const { client, requests } = fakeClient([{ call: ["ep"] }, { text: "There you go, my new EP." }]);
    const r = await collect(streamReply({ persona, context: CONTEXT, history, client }));
    expect(r.shown).toEqual(["ep"]);
    expect(r.text).toBe("There you go, my new EP.");
    expect(requests).toHaveLength(2);
    const messages = requests[1].messages as { role: string; content: unknown }[];
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id: "toolu_1", name: "show_items", input: { ids: ["ep"] } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Shown. Now say your reply out loud." }],
    });
  });

  it("ignores a show_items call cut off by max_tokens", async () => {
    const { client, requests } = fakeClient([{ text: "Here ", call: ["ep"], stop: "max_tokens" }]);
    const r = await collect(streamReply({ persona, context: CONTEXT, history, client }));
    expect(r.shown).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("answers a refusal with a polite line", async () => {
    const { client } = fakeClient([{ stop: "refusal" }]);
    const r = await collect(streamReply({ persona, context: CONTEXT, history, client }));
    expect(r.text).toContain("not something I can talk about");
  });

  it("sends no tools when there is nothing to show", async () => {
    const { client, requests } = fakeClient([{ text: "Hi!" }]);
    await collect(streamReply({ persona, context: { knowledge: "", items: [] }, history, client }));
    expect(requests[0]).not.toHaveProperty("tools");
    expect(requests[0]).not.toHaveProperty("tool_choice");
  });

  it("matches item titles in demo mode", async () => {
    const r = await collect(
      streamReply({ persona, context: CONTEXT, history: [{ role: "user", content: "Can I see the tour poster?" }] }),
    );
    expect(r.shown).toEqual(["poster"]);
    expect(r.text).toContain("Tour poster");
  });
});

describe("sentence chunker", () => {
  it("emits sentences as they complete, merging very short ones", () => {
    const c = new SentenceChunker();
    const out: string[] = [];
    for (const piece of ["Hey there! I'm doing ", "great today. What about", " you? I hope ", "all is well"]) {
      out.push(...c.push(piece));
    }
    out.push(...c.flush());
    expect(out).toEqual(["Hey there! I'm doing great today.", "What about you? I hope all is well"]);
  });

  it("lets the first chunk end at a clause so speech starts sooner", () => {
    const c = new SentenceChunker();
    const out = [
      ...c.push("Honestly, I'm working on a redesign of our booking flow, "),
      ...c.push("making it work great on phones. Later, "),
      ...c.push("I want to add maps."),
      ...c.flush(),
    ];
    expect(out).toEqual([
      "Honestly, I'm working on a redesign of our booking flow,",
      "making it work great on phones.",
      "Later, I want to add maps.",
    ]);
  });

  it("splits very long runs at a comma", () => {
    const c = new SentenceChunker(24, 60);
    const out = c.push("one two three four five six seven, eight nine ten eleven twelve thirteen fourteen");
    expect(out[0]).toBe("one two three four five six seven,");
  });
});
