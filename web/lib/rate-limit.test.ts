import { describe, expect, it } from "vitest";
import { __bucketCountForTests, getClientIp, getClientKey, rateLimit } from "./rate-limit";

const req = (headers: Record<string, string>) => new Request("https://app.test/api", { headers });

describe("getClientIp", () => {
  it("prefers the Cloudflare header over a spoofable X-Forwarded-For", () => {
    expect(getClientIp(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
    expect(getClientIp(req({ "true-client-ip": "2001:db8::1", "x-forwarded-for": "1.2.3.4" }))).toBe("2001:db8::1");
  });

  it("falls back to the first X-Forwarded-For entry", () => {
    expect(getClientIp(req({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
  });

  it("ignores values that are not IP addresses", () => {
    expect(getClientIp(req({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "evil" }))).toBe("unknown");
  });

  it("uses the user id when authenticated", () => {
    expect(getClientKey(req({ "cf-connecting-ip": "203.0.113.7" }), "u1")).toBe("user:u1");
  });
});

describe("rateLimit", () => {
  it("permite requisições dentro do limite", () => {
    expect(rateLimit("test-limit-a", 2, 60_000).allowed).toBe(true);
    expect(rateLimit("test-limit-a", 2, 60_000).allowed).toBe(true);
  });

  it("bloqueia a requisição que excede o limite", () => {
    rateLimit("test-limit-b", 2, 60_000);
    rateLimit("test-limit-b", 2, 60_000);
    const result = rateLimit("test-limit-b", 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("never grows beyond its cap, even with many distinct keys", () => {
    for (let i = 0; i < 12_000; i++) rateLimit("flood:" + i, 5, 60_000);
    expect(__bucketCountForTests()).toBeLessThanOrEqual(5000);
  });
});
