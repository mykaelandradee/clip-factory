import { afterEach, describe, expect, it, vi } from "vitest";
import { getVideoStatistics } from "./youtube-upload";

afterEach(() => vi.unstubAllGlobals());

describe("getVideoStatistics", () => {
  it("queries in batches of 50 and maps views, likes and comments", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const ids = new URL(url).searchParams.get("id")!.split(",");
      return new Response(JSON.stringify({
        items: ids.map((id) => ({
          id,
          // "hidden" simula um canal que oculta as curtidas.
          statistics: id === "hiddenLikes1" ? { viewCount: "10", commentCount: "2" } : { viewCount: "100", likeCount: "7", commentCount: "3" },
        })),
      }), { status: 200 });
    }));

    const ids = Array.from({ length: 120 }, (_, i) => "video" + String(i).padStart(5, "0"));
    const stats = await getVideoStatistics("token", [...ids, "hiddenLikes1", "bad id!", ids[0]]);

    expect(calls).toHaveLength(3); // 121 IDs válidos e únicos → 3 lotes
    expect(stats.get("video00000")).toEqual({ views: 100, likes: 7, comments: 3 });
    expect(stats.get("hiddenLikes1")).toEqual({ views: 10, likes: null, comments: 2 });
    expect(stats.has("bad id!")).toBe(false);
  });

  it("classifies an expired authorization as auth error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: "authError" }], message: "x" } }), { status: 401 })));
    await expect(getVideoStatistics("token", ["video00001"])).rejects.toMatchObject({ kind: "auth" });
  });
});
