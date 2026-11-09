import { describe, expect, it } from "vitest";
import { wholeSamples } from "../elevenlabs";

function streamOf(chunks: number[][]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      controller.close();
    },
  });
}

describe("wholeSamples", () => {
  it("never splits a 16-bit sample across chunks", async () => {
    const out: number[][] = [];
    for await (const chunk of wholeSamples(streamOf([[1, 2, 3], [4], [5, 6, 7], [], [8]]))) {
      expect(chunk.length % 2).toBe(0);
      out.push(Array.from(chunk));
    }
    expect(out.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
