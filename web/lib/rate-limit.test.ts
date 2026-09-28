import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

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
});
