import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLiveOdds } from "./liveOddsProviders.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8080);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

const sendJson = (response, statusCode, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) {
    return {};
  }
  return JSON.parse(buffer.toString("utf-8"));
};

const raceConfigIsValid = (raceConfig) => {
  if (!raceConfig || typeof raceConfig !== "object") {
    return false;
  }
  const { trackSlug, year, month, day, raceNumber } = raceConfig;
  return (
    typeof trackSlug === "string" &&
    trackSlug.trim().length > 0 &&
    Number.isFinite(Number(year)) &&
    Number.isFinite(Number(month)) &&
    Number.isFinite(Number(day)) &&
    Number.isFinite(Number(raceNumber))
  );
};

const serveStatic = async (request, response, pathname) => {
  const route = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, normalized);

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
};

const handleLiveOdds = async (request, response) => {
  try {
    const body = await readBody(request);
    const raceConfig = body?.raceConfig;
    const horseNames = Array.isArray(body?.horseNames) ? body.horseNames : [];

    if (!raceConfigIsValid(raceConfig)) {
      sendJson(response, 400, { error: "Invalid raceConfig payload." });
      return;
    }

    const result = await getLiveOdds(raceConfig, horseNames);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 502, {
      error: "Live odds fetch failed.",
      detail: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/live-odds" && request.method === "POST") {
    await handleLiveOdds(request, response);
    return;
  }

  await serveStatic(request, response, pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`HorseRace Demo server running at http://127.0.0.1:${PORT}`);
});
