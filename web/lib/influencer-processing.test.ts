import { describe, expect, it } from "vitest";
import { formatClipRange, normalizeCaptionStyle, normalizeClipCount, normalizeProcessingMode, normalizeSubtitleLanguage, parseManifest } from "./influencer-processing";

const prefix = "influencer/u/libraries/lib/item";

describe("normalizers", () => {
  it("falls back to safe defaults", () => {
    expect(normalizeProcessingMode("clips")).toBe("clips");
    expect(normalizeProcessingMode("rm -rf")).toBe("original");
    expect(normalizeCaptionStyle("fire")).toBe("fire");
    expect(normalizeCaptionStyle("x", "beasty")).toBe("beasty");
    expect(normalizeClipCount(0)).toBe(1);
    expect(normalizeClipCount(42)).toBe(10);
    expect(normalizeClipCount("abc")).toBe(5);
    expect(normalizeSubtitleLanguage("en")).toBe("en");
    expect(normalizeSubtitleLanguage("fr")).toBe("pt-BR");
    expect(normalizeSubtitleLanguage(undefined, "original")).toBe("original");
  });
});

describe("parseManifest", () => {
  const valid = {
    version: 1, item_id: "item", mode: "clips", caption_style: "fire", subtitle_language: "en",
    source_title: "Podcast", source_description: "", source_duration: 600, transcript: "olá",
    outputs: [
      { index: 2, key: `${prefix}/clip-02.mp4`, start: 60, end: 95, transcript: "b", title: "" },
      { index: 1, key: `${prefix}/clip-01.mp4`, start: 10, end: 42, transcript: "a", title: "" },
    ],
  };

  it("accepts a manifest within the item folder and sorts outputs", () => {
    const manifest = parseManifest(valid, prefix);
    expect(manifest?.outputs.map(o => o.index)).toEqual([1, 2]);
    expect(manifest?.outputs[0].duration).toBe(32);
    expect(manifest?.mode).toBe("clips");
    expect(manifest?.subtitle_language).toBe("en");
  });

  it("rejects keys outside the item folder", () => {
    for (const key of ["influencer/other/libraries/lib/item/clip-01.mp4", `${prefix}/../x/clip.mp4`, `${prefix}/notes.txt`]) {
      expect(parseManifest({ ...valid, outputs: [{ index: 1, key, start: 0, end: 30 }] }, prefix)).toBeNull();
    }
  });

  it("rejects empty or oversized outputs", () => {
    expect(parseManifest({ ...valid, outputs: [] }, prefix)).toBeNull();
    expect(parseManifest({ ...valid, outputs: Array.from({ length: 11 }, (_, i) => ({ index: i + 1, key: `${prefix}/clip-${i}.mp4`, start: 0, end: 30 })) }, prefix)).toBeNull();
    expect(parseManifest(null, prefix)).toBeNull();
  });
});

describe("formatClipRange", () => {
  it("formats minutes and seconds", () => {
    expect(formatClipRange(65, 125.4)).toBe("1:05–2:05");
    expect(formatClipRange(null, 10)).toBe("");
  });
});
