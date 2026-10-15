import { describe, expect, it } from "vitest";
import { safeEqual, safeRedirectPath } from "./security";

describe("safeEqual", () => {
  it("accepts identical secrets", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("rejects different, empty or missing secrets", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc", "abc123")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
    expect(safeEqual("abc", undefined)).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("keeps internal paths", () => {
    expect(safeRedirectPath("/influencer-manager?tab=1")).toBe("/influencer-manager?tab=1");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("blocks external and malformed destinations", () => {
    for (const value of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "/%0d%0aSet-Cookie", "evil.com", "", null]) {
      const result = safeRedirectPath(value as string | null);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(new URL(result, "https://app.test").origin).toBe("https://app.test");
    }
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("//evil.com")).toBe("/");
  });
});
