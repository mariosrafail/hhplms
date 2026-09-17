import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { request } from "node:http";
import test from "node:test";
import { captureNativeMarkerResponses, createNativeMarkerServer, closeNativeMarkerBrowser } from "./integration/_native-marker-browser-lifecycle.mjs";

const nextTurn = () => new Promise((done) => setImmediate(done));
const response = (body) => ({ url: () => "http://localhost/book-content?action=assignment", headers: () => ({ "content-type": "application/json" }), text: () => body });

test("native marker teardown awaits request and body completion before detaching and closing", async () => {
 const page = new EventEmitter(), capture = captureNativeMarkerResponses(page);
 const body = Promise.withResolvers(), requestToken = {}, order = [];
 page.emit("request", requestToken);
 page.emit("response", response(body.promise));
 const bridge = { drain: async () => order.push("server drained"), stopAccepting: () => order.push("stop accepting"), close: async () => order.push("server closed") };
 const browser = { close: async () => { assert.equal(page.listenerCount("response"), 0); order.push("browser closed"); } };
 const closing = closeNativeMarkerBrowser({ capture, bridge, browser });
 await nextTurn(); assert.deepEqual(order, []);
 body.resolve('{"selectedIds":["target"]}');
 await nextTurn(); assert.deepEqual(order, []);
 page.emit("requestfinished", requestToken);
 await closing;
 assert.deepEqual(capture.payloads, ['{"selectedIds":["target"]}']);
 assert.deepEqual(order, ["server drained", "stop accepting", "browser closed", "server closed"]);
 for (const event of ["request", "requestfinished", "requestfailed", "response"]) assert.equal(page.listenerCount(event), 0);
});

test("a body rejection is immediately owned and fails awaited teardown after resources close", async () => {
 const page = new EventEmitter(), capture = captureNativeMarkerResponses(page);
 const body = Promise.withResolvers(), failure = new Error("response body unavailable"), order = [];
 page.emit("response", response(body.promise));
 // Let the rejection occur before drain is called. node:test also detects
 // unhandled rejections; the rejection must already have an owner here.
 await nextTurn(); body.reject(failure); await nextTurn();
 await assert.rejects(closeNativeMarkerBrowser({ capture,
  bridge: { drain: async () => {}, stopAccepting() {}, close: async () => order.push("server") },
  browser: { close: async () => order.push("browser") },
 }), (error) => error instanceof AggregateError && error.errors[0].errors[0] === failure);
 assert.deepEqual(order, ["browser", "server"]);
 assert.equal(page.listenerCount("response"), 0);
});

test("requests started while a previous response body settles are also drained", async () => {
 const page = new EventEmitter(), capture = captureNativeMarkerResponses(page), body = Promise.withResolvers();
 page.emit("response", response(body.promise));
 let drained = false;
 const completion = capture.drain().then(() => { drained = true; });
 await nextTurn();
 const lateRequest = {}; page.emit("request", lateRequest); body.resolve("{}");
 await nextTurn(); assert.equal(drained, false);
 page.emit("requestfinished", lateRequest);
 await completion; capture.detach(); assert.equal(drained, true);
});

test("late captured Teacher answers remain visible to the payload leak assertion", async () => {
 const page = new EventEmitter(), capture = captureNativeMarkerResponses(page), body = Promise.withResolvers();
 page.emit("response", response(body.promise));
 const drained = capture.drain();
 body.resolve('{"correctTargetIds":["private-target"]}');
 await drained; capture.detach();
 assert.throws(() => assert.doesNotMatch(capture.payloads.join("\n"), /correctTargetIds|correctWordIds/), assert.AssertionError);
});

test("an aborted HTTP client cannot release SQL ownership while its handler is still running", async () => {
 const entered = Promise.withResolvers(), finish = Promise.withResolvers(), order = [];
 let sqlDisposed = false;
 const bridge = createNativeMarkerServer(async (_req, res) => {
  entered.resolve(); await finish.promise;
  assert.equal(sqlDisposed, false); order.push("SQL handler completed"); res.end();
 });
 bridge.server.listen(0, "127.0.0.1"); await once(bridge.server, "listening");
 const req = request(`http://127.0.0.1:${bridge.server.address().port}`);
 req.on("error", (error) => assert.equal(error.code, "ECONNRESET")); req.end();
 await entered.promise;
 const disconnected = once(req, "close"); req.destroy();
 // events.once rejects on error; request close is observed separately below.
 await disconnected.catch((error) => assert.equal(error.code, "ECONNRESET"));
 const closing = closeNativeMarkerBrowser({ bridge, browser: { close: async () => order.push("browser closed") } }).then(() => { sqlDisposed = true; order.push("SQL disposed"); });
 await nextTurn(); assert.deepEqual(order, []);
 finish.resolve(); await closing;
 assert.deepEqual(order, ["SQL handler completed", "browser closed", "SQL disposed"]);
 assert.equal(bridge.server.listening, false);
});

test("HTTP handler failures are surfaced after server shutdown, not lost by its callback", async () => {
 const failure = new Error("Worker fixture failure");
 const bridge = createNativeMarkerServer(async () => { throw failure; });
 bridge.server.listen(0, "127.0.0.1"); await once(bridge.server, "listening");
 const result = await fetch(`http://127.0.0.1:${bridge.server.address().port}`);
 assert.equal(result.status, 500); await result.text();
 await assert.rejects(bridge.close(), (error) => error.errors[0].errors[0] === failure);
 assert.equal(bridge.server.listening, false);
});
