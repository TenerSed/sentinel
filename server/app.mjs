import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { answerQuestion, liveStatus } from "./chat.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || 5173);
const json = (response, status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };

const vite = production ? null : await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/chat/status") return json(response, 200, { live: liveStatus() });
  if (request.method === "POST" && request.url === "/api/chat") {
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      const input = JSON.parse(body);
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["coverageId", "question"].includes(key))) return json(response, 400, { error: "invalid_request" });
      const result = await answerQuestion(input);
      return json(response, result.error === "invalid_request" || result.error === "invalid_coverage" ? 400 : 200, { answer: result.answer, packet: result.packet && { coverageId: result.packet.coverageId, coverageLabel: result.packet.coverageLabel, count: result.packet.records.length }, provider: result.provider, error: typeof result.error === "object" ? result.error : undefined });
    } catch { return json(response, 400, { error: "invalid_request" }); }
  }
  if (vite) return vite.middlewares(request, response, () => json(response, 404, { error: "not_found" }));
  const asset = request.url === "/" ? "index.html" : request.url?.replace(/^\//, "");
  const target = path.resolve(root, "dist", asset || "index.html");
  if (!target.startsWith(path.join(root, "dist") + path.sep) || !fs.existsSync(target)) return response.end(fs.readFileSync(path.join(root, "dist", "index.html")));
  response.end(fs.readFileSync(target));
});
server.listen(port, () => console.log(`Lamplighter listening on http://localhost:${port}`));
