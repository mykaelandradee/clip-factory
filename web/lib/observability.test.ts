import { describe, expect, it } from "vitest";
import { redactValue, sanitizeContext } from "./observability";

describe("sanitizeContext", () => {
  it("removes sensitive keys regardless of casing or format", () => {
    const result = sanitizeContext({
      Authorization: "Bearer abc",
      refreshToken: "x",
      access_token: "y",
      "x-api-key": "z",
      CLIENT_SECRET: "w",
      jobId: "123",
    });
    expect(result).toEqual({ jobId: "123" });
  });

  it("redacts credential-looking values in allowed keys", () => {
    expect(redactValue("header was Bearer abc.def-123")).toBe("header was [REDACTED]");
    expect(redactValue("token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("token [REDACTED]");
  });
});
