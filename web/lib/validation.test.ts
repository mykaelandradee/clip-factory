import { describe, expect, it } from "vitest";
import { isValidClipFilename, isValidJobId, parsePositiveInt, validateYoutubeUrl } from "./validation";

describe("validation", () => {
  it("aceita URLs HTTPS válidas do YouTube", () => {
    expect(validateYoutubeUrl("https://www.youtube.com/watch?v=eOrb93UZfPU")).toBe(true);
    expect(validateYoutubeUrl("https://youtu.be/eOrb93UZfPU")).toBe(true);
  });

  it("rejeita URLs que não pertencem ao YouTube", () => {
    expect(validateYoutubeUrl("http://www.youtube.com/watch?v=abc")).toBe(false);
    expect(validateYoutubeUrl("https://youtube.example.com/video")).toBe(false);
    expect(validateYoutubeUrl("https://evil-youtube.com/video")).toBe(false);
    expect(validateYoutubeUrl("https://example.com/?url=https://youtube.com/watch?v=abc")).toBe(false);
  });

  it("valida UUID de job e nome de clip", () => {
    expect(isValidJobId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidJobId("not-a-job")).toBe(false);
    expect(isValidClipFilename("clip-01.mp4")).toBe(true);
    expect(isValidClipFilename("clip-15.mp4")).toBe(true);
    expect(isValidClipFilename("clip-16.mp4")).toBe(false);
    expect(isValidClipFilename("../clip-01.mp4")).toBe(false);
  });

  it("normaliza inteiros dentro dos limites", () => {
    expect(parsePositiveInt("9.9", 5, 1, 15)).toBe(9);
    expect(parsePositiveInt("999", 5, 1, 15)).toBe(15);
    expect(parsePositiveInt("0", 5, 1, 15)).toBe(1);
    expect(parsePositiveInt("abc", 5, 1, 15)).toBe(5);
  });
});
