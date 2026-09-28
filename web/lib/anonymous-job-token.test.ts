import { describe, expect, it } from "vitest";
import { createAnonymousAccessToken, isValidAnonymousAccessToken } from "./anonymous-job-token";

describe("anonymous job access token", () => {
  const jobId = "550e8400-e29b-41d4-a716-446655440000";
  const secret = "test-secret";

  it("gera token determinístico e aceita o token correto", () => {
    const token = createAnonymousAccessToken(jobId, secret);
    expect(token).toBe(createAnonymousAccessToken(jobId, secret));
    expect(isValidAnonymousAccessToken(jobId, token, secret)).toBe(true);
  });

  it("rejeita token alterado, job diferente ou segredo diferente", () => {
    const token = createAnonymousAccessToken(jobId, secret);
    expect(isValidAnonymousAccessToken(jobId, token + "x", secret)).toBe(false);
    expect(isValidAnonymousAccessToken("550e8400-e29b-41d4-a716-446655440001", token, secret)).toBe(false);
    expect(isValidAnonymousAccessToken(jobId, token, "other-secret")).toBe(false);
    expect(isValidAnonymousAccessToken(jobId, null, secret)).toBe(false);
  });
});
