import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { assertLocalPath, createCollectionClient, selectPublishedRelease, materializeEdition } from "../../lib/offline-editions/materialize.js";
import { buildEditionApk } from "../../lib/offline-editions/build.js";

export async function launchExporter({ repositoryRoot, output }) {
  const root = await assertLocalPath(output); await fs.mkdir(root, { recursive: true });
  const marker = path.join(root, ".offline-export-root");
  const existing = await fs.readFile(marker, "utf8").catch(() => null);
  if (existing !== null && existing !== "offline-editions.v1") throw new Error("offline_output_owner");
  if (!existing) {
    if ((await fs.readdir(root)).length) throw new Error("offline_output_unowned_nonempty");
    await fs.writeFile(marker, "offline-editions.v1", { flag: "wx" });
  }
  const nonce = randomBytes(32).toString("hex"); let pending = null, running = false, status = { state: "idle" }, abort = null;
  const html = await fs.readFile(new URL("./launcher.html", import.meta.url), "utf8");
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const reply = (code, body) => { response.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) return reply(403, { error: "local_host_required" });
    if (request.method === "GET" && request.url === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'` }); return response.end(html.replaceAll("__NONCE__", nonce)); }
    if (request.headers["x-export-session"] !== nonce || request.headers.origin && request.headers.origin !== origin) return reply(403, { error: "local_session_required" });
    if (request.method === "GET" && request.url === "/status") return reply(200, status);
    if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new Error("request_too_large"); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (request.url === "/cancel") { abort?.abort(); pending = null; status = { state: running ? "cancelling" : "cancelled" }; return reply(200, status); }
      if (running) return reply(409, { error: "export_in_progress" });
      if (request.url === "/select") {
        pending = null; abort = new AbortController(); running = true;
        try {
          const collect = createCollectionClient({ origin: body.origin, access: body.access, credential: body.credential, signal: abort.signal });
          const result = await selectPublishedRelease({ editionId: body.editionId, releaseId: body.releaseId, collect });
          abort.signal.throwIfAborted();
          pending = { collect, selection: result.selection }; status = { state: "selected", ...result }; return reply(200, status);
        } finally { running = false; }
      }
      if (request.url === "/export" && pending) {
        const selected = pending; pending = null; running = true; status = { state: "running", stage: "collect" };
        reply(202, status);
        const taskRoot = path.join(root, `export-${randomUUID()}`);
        try {
          await fs.mkdir(taskRoot);
          const pack = await materializeEdition({ ...selected, repositoryRoot, output: path.join(taskRoot, "pack"), signal: abort.signal,
            onProgress: (progress) => { status = { state: "running", ...progress }; } });
          const result = await buildEditionApk({ repositoryRoot, packRoot: pack.root, output: path.join(taskRoot, "artifact"), signal: abort.signal,
            versionCode: Number(body.versionCode), versionName: body.versionName, onStage: (stage) => { status = { state: "running", stage }; } });
          status = { state: "complete", apkPath: result.apkPath, packSha256: pack.manifest.packSha256, apkSha256: result.receipt.verification.apkSha256 };
        } catch (error) { status = { state: "failed", error: error.code || error.message || "offline_export_failed" }; }
        finally { running = false; abort = null; }
        return;
      }
      reply(409, { error: "select_published_release_first" });
    } catch (error) { pending = null; reply(400, { error: error.code || error.message || "offline_request_failed" }); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  console.log(`Local offline edition exporter: http://127.0.0.1:${server.address().port}/`);
  process.once("SIGINT", () => { abort?.abort(); pending = null; server.close(); });
  return server;
}
