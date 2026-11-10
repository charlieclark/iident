import "server-only";

/**
 * Speech streams to the browser as 16-bit little-endian mono PCM at this
 * rate, whichever provider synthesizes it.
 */
export const PCM_SAMPLE_RATE = 24000;

/** Re-chunks a byte stream so no 16-bit sample is split across chunks. */
export async function* wholeSamples(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let carry: number | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      let bytes = value;
      if (carry !== null) {
        const merged = new Uint8Array(bytes.length + 1);
        merged[0] = carry;
        merged.set(bytes, 1);
        bytes = merged;
        carry = null;
      }
      if (bytes.length % 2) {
        carry = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      if (bytes.length) yield bytes;
    }
  } finally {
    reader.releaseLock();
  }
}
