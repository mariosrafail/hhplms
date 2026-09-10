import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createServer } from "./_vite-test-server.mjs";

test("concurrent Vite test servers own independent caches until their watchers and plugins close", async (t) => {
  const closed = [];
  const servers = await Promise.all(["first", "second"].map(async (label) => {
    let cacheDir;
    const server = await createServer({
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false },
      plugins: [{
        name: `cache-lifecycle-${label}`,
        configResolved(config) { cacheDir = config.cacheDir; },
        resolveId(id) { if (id === "virtual:cache-probe") return `\0${id}`; },
        load(id) { if (id === "\0virtual:cache-probe") return `export const label = ${JSON.stringify(label)};`; },
        async closeBundle() {
          assert.equal(await readFile(path.join(cacheDir, "owner"), "utf8"), label);
          closed.push(label);
        },
      }],
    });
    t.after(() => server.close());
    await writeFile(path.join(cacheDir, "owner"), label);
    return server;
  }));
  const [first, second] = servers;
  assert.notEqual(first.config.cacheDir, second.config.cacheDir);
  for (const server of servers) {
    const relative = path.relative(server.config.root, server.config.cacheDir);
    assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "cache must be outside the repository");
  }
  assert.equal((await first.ssrLoadModule("virtual:cache-probe")).label, "first");
  await Promise.all([first.close(), first.close()]);
  assert.equal(first.watcher.closed, true);
  assert.deepEqual(first.watcher.getWatched(), {});
  await assert.rejects(access(first.config.cacheDir), { code: "ENOENT" });
  assert.equal(await readFile(path.join(second.config.cacheDir, "owner"), "utf8"), "second");
  assert.equal((await second.ssrLoadModule("virtual:cache-probe")).label, "second");
  await second.close();
  assert.equal(second.watcher.closed, true);
  await assert.rejects(access(second.config.cacheDir), { code: "ENOENT" });
  assert.ok(closed.includes("first") && closed.includes("second"));
});

test("Vite test server creation failures remove only their allocated cache and preserve the error", async () => {
  const failure = new Error("synthetic config failure");
  let cacheDir;
  await assert.rejects(createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [{ name: "reject-test-config", configResolved(config) { cacheDir = config.cacheDir; throw failure; } }],
  }), (error) => error === failure);
  assert.ok(cacheDir);
  await assert.rejects(access(cacheDir), { code: "ENOENT" });
});

test("Vite test teardown waits for an in-flight dependency bundle before cancelling environments", async (t) => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let optimizerFinished = false;
  const server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: {
      include: ["react"],
      entries: [],
      rolldownOptions: { plugins: [{
        name: "controlled-test-optimizer",
        async writeBundle() {
          started.resolve();
          await finish.promise;
          optimizerFinished = true;
        },
      }] },
    },
  });
  t.after(async () => { finish.resolve(); await server.close(); });
  await started.promise;
  const client = server.environments.client;
  const close = client.close.bind(client);
  let finishedAtCancellation;
  client.close = async () => {
    finishedAtCancellation = optimizerFinished;
    return close();
  };
  const closing = server.close();
  // Give teardown an event-loop turn while the real optimizer is held in writeBundle.
  await new Promise(setImmediate);
  finish.resolve();
  await closing;
  assert.equal(finishedAtCancellation, true, "dependency writes must finish before environment cancellation");
  await assert.rejects(access(server.config.cacheDir), { code: "ENOENT" });
});
