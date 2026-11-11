import { beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("rate limiting", () => {
  let http: typeof import("../http");
  let pg: typeof import("../pg");
  beforeAll(async () => {
    await freshDatabase("http");
    http = await import("../http");
    pg = await import("../pg");
  });

  const from = (ip: string) => new Request("http://localhost/x", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

  it("allows a burst up to the limit, then refuses until the bucket refills", async () => {
    const start = 1_800_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    for (let i = 0; i < 3; i++) await http.rateLimit(from("203.0.113.5"), "draw", 3);
    await expect(http.rateLimit(from("203.0.113.5"), "draw", 3)).rejects.toMatchObject({ status: 429 });
    // Other callers and other kinds of request have their own buckets.
    await http.rateLimit(from("203.0.113.6"), "draw", 3);
    await http.rateLimit(from("203.0.113.5"), "chat", 3);

    // A third of a minute later, one of three tokens is back.
    clock.mockReturnValue(start + 20_000);
    await http.rateLimit(from("203.0.113.5"), "draw", 3);
    await expect(http.rateLimit(from("203.0.113.5"), "draw", 3)).rejects.toMatchObject({ status: 429 });
    // Being refused doesn't push the refill back.
    clock.mockReturnValue(start + 40_000);
    await http.rateLimit(from("203.0.113.5"), "draw", 3);
    clock.mockRestore();
  });

  it("counts requests that arrive together against the same bucket", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => http.rateLimit(from("203.0.113.9"), "burst", 4)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
  });

  it("stores no addresses", async () => {
    const keys = await pg.query<{ key: string }>("SELECT key FROM rate_limits");
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.key.includes("203.0.113"))).toBe(false);
  });
});
