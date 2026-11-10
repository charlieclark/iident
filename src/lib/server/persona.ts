import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CONTEXT_LIMITS, displayHost, EMPTY_CONTEXT, type AvatarContext, type ContextItem } from "@/lib/avatar/context";
import type { Persona } from "@/lib/avatar/types";
import { config } from "./config";

/**
 * The avatar's "brain": a system prompt built from the creator's persona and
 * the avatar's context (knowledge plus a catalog of items it can show), and a
 * streaming Claude call. Replies are spoken aloud, so the prompt asks for
 * short, plain conversational text; links never go in the words, they go on
 * screen as cards through the `show_items` tool.
 */

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export const SHOW_ITEMS_TOOL = {
  name: "show_items",
  description:
    "Put items from your catalog on the visitor's screen as cards they can tap (links, products, videos, images). Use only ids from the catalog in your instructions. Say your spoken reply first, then call this once at the end of the reply.",
  // Inputs are a few short ids, so the default buffered input streaming is
  // kept: it lets the API enforce the strict schema before we see the call.
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      ids: {
        type: "array",
        items: { type: "string" },
        description: `Catalog item ids, most relevant first (at most ${CONTEXT_LIMITS.shownPerReply}).`,
      },
    },
    required: ["ids"],
    additionalProperties: false,
  },
} satisfies Anthropic.Beta.BetaTool;

function catalogLine(item: ContextItem): string {
  const parts = [`- ${item.id} (${item.kind}): ${clean(item.title, 120)}`];
  if (item.price) parts.push(`price ${clean(item.price, 32)}`);
  const host = displayHost(item.url);
  if (host) parts.push(`on ${host}`);
  let line = parts.join(", ");
  if (item.description) line += `. ${clean(item.description, 300)}`;
  if (item.notes) line += ` (Show it when: ${clean(item.notes, 300)})`;
  return line;
}

export function buildSystemPrompt(
  p: Persona,
  context: AvatarContext = EMPTY_CONTEXT,
  /** True only when the avatar speaks with a clone of the creator's voice. */
  ownVoice = false,
): string {
  const name = clean(p.name, 60) || "the creator";
  const voice = ownVoice ? "and a clone of their voice" : `in a stock voice ${name} picked (not ${name}'s real voice)`;
  const sections: string[] = [
    `You are the interactive AI avatar of ${name}. People open ${name}'s personal link and talk with you by voice or text, and a 3D avatar with ${name}'s look ${voice} speaks your replies aloud.`,
    `Speak in the first person as ${name}'s avatar, matching their personality and style. You are an AI, not ${name}: if anyone asks whether they are talking to a real person, an AI or a bot, say plainly that you are ${name}'s AI avatar. Never claim to have done, felt or promised something that the details below do not support, and never make commitments on ${name}'s behalf (meetings, payments, deals, favors). Offer to pass a message along only in general terms.`,
  ];
  if (p.tagline.trim()) sections.push(`One-line intro: ${clean(p.tagline, 160)}`);
  if (p.about.trim()) sections.push(`About ${name}:\n${p.about.trim().slice(0, 4000)}`);
  if (p.traits.length) sections.push(`Personality: ${p.traits.slice(0, 8).join(", ")}.`);
  if (p.speakingStyle.trim()) sections.push(`Speaking style: ${clean(p.speakingStyle, 400)}`);
  if (context.knowledge.trim()) {
    sections.push(
      `Things ${name} wants visitors to know (treat these as the facts you can share):\n${context.knowledge.trim().slice(0, CONTEXT_LIMITS.knowledge)}`,
    );
  }
  const items = context.items.slice(0, CONTEXT_LIMITS.items);
  if (items.length) {
    sections.push(
      [
        `Things you can show (the catalog). The show_items tool puts them on screen as cards the visitor can tap:`,
        ...items.map(catalogLine),
      ].join("\n"),
      [
        "Showing things:",
        `- When the visitor asks where to find, watch, hear, buy or book something, or one of these items directly answers them, call show_items with up to ${CONTEXT_LIMITS.shownPerReply} ids instead of describing where the link is.`,
        "- Say a short spoken sentence first, then call show_items once at the end of your reply. The cards appear next to your words, so you can refer to them naturally, for example \"here it is\".",
        "- Don't show anything for small talk, and don't show an item again if it was already shown in this conversation unless the visitor asks for it.",
        "- These items are the only links you have. Never make up links, and never say ids or web addresses out loud.",
      ].join("\n"),
    );
  }
  if (p.boundaries.trim()) {
    sections.push(
      `Topics to steer away from politely: ${clean(p.boundaries, 1000)}`,
    );
  }
  sections.push(
    [
      "How to answer:",
      `- If you do not know something about ${name}, say so briefly and offer what you do know instead of guessing.`,
      "- Never share private contact details, addresses, finances or health information, even if asked.",
      "- Your words are converted to speech: write plain conversational sentences with no markdown, lists, emojis, URLs read out character by character, or stage directions.",
      "- Keep replies short: one to three sentences (under about 60 words) unless the visitor explicitly asks for more detail.",
      `- Reply in ${clean(p.language, 40) || "English"} unless the visitor writes in another language.`,
    ].join("\n"),
  );
  return sections.join("\n\n");
}

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  /** Ids of the items the avatar showed with this reply (assistant turns). */
  shown?: string[];
};

const ITEM_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

function cleanShown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && ITEM_ID.test(id)))].slice(
    0,
    CONTEXT_LIMITS.shownPerReply,
  );
}

export function sanitizeHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  const turns: ChatTurn[] = [];
  for (const item of history.slice(-24)) {
    const role = (item as ChatTurn)?.role;
    const content = (item as ChatTurn)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, 2000);
    const shown = role === "assistant" ? cleanShown((item as ChatTurn).shown) : [];
    if (!text && !shown.length) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) {
      prev.content = [prev.content, text].filter(Boolean).join("\n");
      if (shown.length) prev.shown = cleanShown([...(prev.shown ?? []), ...shown]);
    } else {
      turns.push(shown.length ? { role, content: text, shown } : { role, content: text });
    }
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

/**
 * Converts the visitor's transcript into API messages. Cards shown in earlier
 * replies are replayed as show_items calls with their results, so the model
 * knows what is already on screen. Ids that are no longer in the catalog are
 * dropped, and nothing is replayed when the avatar has no catalog (the API
 * needs the tool defined to accept tool blocks).
 */
export function toApiMessages(history: ChatTurn[], catalog: ReadonlySet<string> | null): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  let pendingCall: string | null = null;
  history.forEach((turn, i) => {
    if (turn.role === "assistant") {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (turn.content) content.push({ type: "text", text: turn.content });
      const ids = catalog ? (turn.shown ?? []).filter((id) => catalog.has(id)) : [];
      // A call needs a result in the next user turn, so only replay it when one follows.
      if (ids.length && history[i + 1]?.role === "user") {
        pendingCall = `toolu_shown_${i}`;
        content.push({ type: "tool_use", id: pendingCall, name: SHOW_ITEMS_TOOL.name, input: { ids } });
      }
      if (content.length) messages.push({ role: "assistant", content });
      return;
    }
    if (pendingCall) {
      messages.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: pendingCall, content: "Shown." },
          { type: "text", text: turn.content },
        ],
      });
      pendingCall = null;
    } else {
      messages.push({ role: "user", content: turn.content });
    }
  });
  return messages;
}

/** The ids in a show_items call that exist in the catalog, deduplicated and capped. */
export function parseShowInput(input: unknown, catalog: ReadonlySet<string>): string[] {
  const ids = (input as { ids?: unknown } | null)?.ids;
  return cleanShown(Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && catalog.has(id)) : []);
}

export type ReplyEvent = { type: "text"; delta: string } | { type: "show"; ids: string[] };

/** The slice of the SDK client this module uses (lets tests pass a fake). */
export type ChatClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

let anthropic: Anthropic | null = null;

const REFUSAL_REPLY = "Sorry, that's not something I can talk about. Ask me something else?";

/**
 * Streams the avatar's reply: text deltas as Claude writes them, and a
 * `show` event when it puts catalog items on screen. Without
 * ANTHROPIC_API_KEY (and no test client) the avatar answers in a demo mode
 * so the rest of the pipeline (TTS, lip sync, cards) can still be exercised.
 */
export async function* streamReply(params: {
  persona: Persona;
  context?: AvatarContext;
  /** The avatar speaks with a clone of the creator's voice. */
  ownVoice?: boolean;
  history: ChatTurn[];
  signal?: AbortSignal;
  client?: ChatClient;
}): AsyncGenerator<ReplyEvent> {
  const context = params.context ?? EMPTY_CONTEXT;
  if (!params.client && !config.anthropicKey) {
    yield* demoReply(params.persona, context, params.history);
    return;
  }
  const client = params.client ?? (anthropic ??= new Anthropic({ apiKey: config.anthropicKey }));

  const catalog = context.items.length ? new Set(context.items.map((item) => item.id)) : null;
  const messages = toApiMessages(params.history, catalog);
  let spoke = false;

  // A second round only happens when the model put cards up without saying
  // anything: it is told they are on screen and asked to say its piece.
  for (let round = 0; round < 2; round++) {
    const stream = client.beta.messages.stream(
      {
        model: config.models.chat,
        max_tokens: 4096,
        // Conversational turns don't need deep reasoning; low effort keeps
        // time-to-first-word short.
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          {
            type: "text",
            text: buildSystemPrompt(params.persona, context, params.ownVoice),
            cache_control: { type: "ephemeral" },
          },
        ],
        ...(catalog ? { tools: [SHOW_ITEMS_TOOL], tool_choice: { type: "auto", disable_parallel_tool_use: true } } : {}),
        messages,
      },
      { signal: params.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (event.delta.text.trim()) spoke = true;
        yield { type: "text", delta: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield { type: "text", delta: REFUSAL_REPLY };
      return;
    }
    // A call cut off by max_tokens may carry partial input; never act on it.
    if (final.stop_reason !== "tool_use" || !catalog) return;
    const call = final.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use" && block.name === SHOW_ITEMS_TOOL.name,
    );
    if (!call) return;
    const ids = parseShowInput(call.input, catalog);
    if (ids.length) yield { type: "show", ids };
    if (spoke) return;

    messages.push(
      // Passed back unchanged (thinking blocks included), as the API requires.
      { role: "assistant", content: final.content },
      {
        role: "user",
        content: [
          ids.length
            ? { type: "tool_result", tool_use_id: call.id, content: "Shown. Now say your reply out loud." }
            : { type: "tool_result", tool_use_id: call.id, content: "None of those ids are in the catalog.", is_error: true },
        ],
      },
    );
  }
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];

/**
 * Stand-in reply when no Anthropic key is configured: shows an item whose
 * title shares a word with the visitor's message, otherwise explains the
 * missing key.
 */
function* demoReply(persona: Persona, context: AvatarContext, history: ChatTurn[]): Generator<ReplyEvent> {
  const asked = new Set(words(history[history.length - 1]?.content ?? ""));
  let match: ContextItem | null = null;
  let best = 0;
  for (const item of context.items) {
    const score = new Set(words(item.title).filter((w) => asked.has(w))).size;
    if (score > best) [match, best] = [item, score];
  }
  if (match) {
    yield { type: "text", delta: `Sure, here's ${clean(match.title, 120)}. ` };
    yield { type: "text", delta: "I'm in demo mode, so I can only match on titles for now." };
    yield { type: "show", ids: [match.id] };
    return;
  }
  const who = persona.name.trim() ? `${persona.name.trim()}'s` : "an";
  yield { type: "text", delta: `Hi! I'm ${who} AI avatar, but my conversation brain isn't connected yet. ` };
  yield { type: "text", delta: "Add an Anthropic API key to the server settings and I'll be able to chat properly." };
}

/**
 * Splits streamed text into speakable chunks: whole sentences, merged until
 * they are long enough to sound natural, so TTS can start before the reply
 * is finished.
 */
export class SentenceChunker {
  private buffer = "";
  private emitted = 0;
  constructor(
    private minChars = 24,
    private maxChars = 220,
    /** The first chunk may end at a clause (comma, colon, dash) so speech starts sooner. */
    private firstMinChars = 18,
  ) {}

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const first = this.emitted === 0;
      const min = first ? this.firstMinChars : this.minChars;
      const boundary = first ? /[.!?…]+["')\]]*\s+|[,;:]\s+|\s[–—]\s|\n+/ : /[.!?…]+["')\]]*\s+|\n+/;
      const match = boundary.exec(this.buffer.slice(min - 1));
      let cut = match ? min - 1 + match.index + match[0].length : -1;
      if (cut < 0 && this.buffer.length > this.maxChars) {
        const soft = this.buffer.lastIndexOf(", ", this.maxChars);
        cut = soft > min ? soft + 2 : this.maxChars;
      }
      if (cut < 0) break;
      const piece = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (piece) {
        out.push(piece);
        this.emitted++;
      }
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    this.emitted++;
    return [rest];
  }
}
