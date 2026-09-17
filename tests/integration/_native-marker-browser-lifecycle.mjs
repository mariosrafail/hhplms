import { createServer } from "node:http";

function ownedWork() {
 const pending = new Set(), errors = [];
 return {
  start(operation) {
   // The rejection handler is attached immediately, not at teardown time.
   const task = Promise.resolve().then(operation).catch((error) => { errors.push(error); });
   pending.add(task);
   void task.then(() => pending.delete(task));
  },
  async drain() {
   while (pending.size) await Promise.all([...pending]);
   if (errors.length) throw new AggregateError(errors, `Native marker fixture work failed: ${errors.map((error) => error.message).join("; ")}`);
  },
 };
}

export function captureNativeMarkerResponses(page) {
 const captures = ownedWork(), requests = new Map(), payloads = [];
 const onRequest = (request) => { requests.set(request, Promise.withResolvers()); };
 const onFinished = (request) => { requests.get(request)?.resolve(); requests.delete(request); };
 const onResponse = (response) => {
  if (response.url().includes("book-content") && response.headers()["content-type"]?.includes("json")) {
   captures.start(async () => { payloads.push(await response.text()); });
  }
 };
 page.on("request", onRequest);
 page.on("requestfinished", onFinished);
 page.on("requestfailed", onFinished);
 page.on("response", onResponse);
 return {
  payloads,
  async drain() {
   // A response event precedes requestfinished, so all body reads are owned
   // before this request barrier opens, including requests started during it.
   do {
    while (requests.size) await Promise.all([...requests.values()].map(({ promise }) => promise));
    await captures.drain();
   } while (requests.size);
  },
  detach() {
   page.off("request", onRequest);
   page.off("requestfinished", onFinished);
   page.off("requestfailed", onFinished);
   page.off("response", onResponse);
  },
 };
}

export function createNativeMarkerServer(handle) {
 const requests = ownedWork(); let closing = false;
 const server = createServer((req, res) => {
  if (closing) { res.writeHead(503); res.end("Fixture closing"); return; }
  requests.start(async () => {
   try { await handle(req, res); }
   catch (error) {
    if (!res.headersSent) res.writeHead(500);
    if (!res.destroyed) res.end("Isolated server error");
    throw error;
   }
  });
 });
 return {
  server,
  drain: () => requests.drain(),
  stopAccepting() { closing = true; },
  async close() {
   closing = true;
   // server.close alone does not own an async handler after a client abort.
   const closed = new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
   const outcomes = await Promise.allSettled([closed, requests.drain()]);
   const errors = outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
   if (errors.length) throw new AggregateError(errors, `Native marker server shutdown failed: ${errors.map((error) => error.message).join("; ")}`);
  },
 };
}

export async function closeNativeMarkerBrowser({ capture, bridge, browser }) {
 const errors = [];
 for (const operation of [() => capture?.drain(), () => bridge.drain()]) {
  try { await operation(); } catch (error) { errors.push(error); }
 }
 capture?.detach();
 bridge.stopAccepting();
 try { await browser?.close(); } catch (error) { errors.push(error); }
 try { await bridge.close(); } catch (error) { errors.push(error); }
 if (errors.length) throw new AggregateError(errors, `Native marker browser teardown failed: ${errors.map((error) => error.message).join("; ")}`);
}
