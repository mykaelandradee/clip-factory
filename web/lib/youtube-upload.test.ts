import { describe, expect, it } from "vitest";
import { buildShortDescription, buildShortTitle } from "./youtube-upload";

describe("buildShortTitle", () => {
  it("appends #Shorts and strips characters YouTube rejects", () => {
    expect(buildShortTitle("Meu <vídeo> legal")).toBe("Meu vídeo legal #Shorts");
  });

  it("keeps an existing #shorts tag", () => {
    expect(buildShortTitle("Já tem #shorts")).toBe("Já tem #shorts");
  });

  it("never exceeds 100 characters", () => {
    const title = buildShortTitle("a".repeat(300));
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith("#Shorts")).toBe(true);
  });

  it("falls back to a default title", () => {
    expect(buildShortTitle("   ")).toBe("Novo vídeo #Shorts");
  });
});

describe("buildShortDescription", () => {
  it("strips angle brackets and limits length", () => {
    expect(buildShortDescription("<b>oi</b>")).toBe("boi/b");
    expect(buildShortDescription("x".repeat(6000)).length).toBe(4500);
  });
});
