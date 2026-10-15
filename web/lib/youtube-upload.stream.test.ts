import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { uploadShort } from "./youtube-upload";

// Simula o R2 (HEAD + GET de um vídeo de 40 MB gerado em pedaços) e o upload
// resumable do YouTube, para garantir que o vídeo é transmitido sem ser
// carregado inteiro na memória e com o Content-Length correto.
const VIDEO_BYTES = 40 * 1024 * 1024;
const CHUNK = Buffer.alloc(64 * 1024, 7);
let server: http.Server;
let base = "";
const received = { bytes: 0, contentLength: "", sessionLength: "", auth: "" };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/video.mp4") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(VIDEO_BYTES) });
      if (req.method === "HEAD") return res.end();
      let sent = 0;
      const pump = () => {
        while (sent < VIDEO_BYTES) {
          const size = Math.min(CHUNK.length, VIDEO_BYTES - sent);
          sent += size;
          if (!res.write(CHUNK.subarray(0, size))) return res.once("drain", pump);
        }
        res.end();
      };
      return pump();
    }
    if (req.url === "/upload" && req.method === "POST") {
      received.sessionLength = String(req.headers["x-upload-content-length"] || "");
      req.resume();
      req.on("end", () => { res.writeHead(200, { Location: base + "/session/1" }); res.end(); });
      return;
    }
    if (req.url === "/session/1" && req.method === "PUT") {
      received.contentLength = String(req.headers["content-length"] || "");
      received.auth = String(req.headers.authorization || "");
      req.on("data", (chunk: Buffer) => { received.bytes += chunk.length; });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "abc123", status: { privacyStatus: "public" } }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("uploadShort streaming", () => {
  it("streams the whole video with the right Content-Length", async () => {
    const before = process.memoryUsage().rss;
    const result = await uploadShort({
      accessToken: "token",
      videoUrl: base + "/video.mp4",
      title: "Teste #Shorts",
      description: "",
      uploadUrl: base + "/upload",
    });
    const growth = process.memoryUsage().rss - before;

    expect(result).toEqual({ videoId: "abc123", privacyStatus: "public" });
    expect(received.sessionLength).toBe(String(VIDEO_BYTES));
    expect(received.contentLength).toBe(String(VIDEO_BYTES));
    expect(received.bytes).toBe(VIDEO_BYTES);
    expect(received.auth).toBe("Bearer token");
    // Um vídeo de 40 MB não pode aumentar a memória na mesma proporção.
    expect(growth).toBeLessThan(VIDEO_BYTES);
  }, 60_000);
});
