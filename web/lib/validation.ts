export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FILE_PATTERN = /^clip-(?:0[1-9]|1[0-5])\\.mp4$/i;

export function validateYoutubeUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "youtube.com" ||
        parsed.hostname.endsWith(".youtube.com") ||
        parsed.hostname === "youtu.be");
  } catch {
    return false;
  }
}

export function isValidJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

export function isValidClipFilename(value: unknown): value is string {
  return typeof value === "string" && FILE_PATTERN.test(value);
}

export function parsePositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
