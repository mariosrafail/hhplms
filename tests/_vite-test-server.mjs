import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createViteServer } from "vite";

// Concurrent test workers must never invalidate another server's dependency cache.
export async function createServer(options = {}) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "hhplms-vite-test-"));
  let server;
  try {
    server = await createViteServer({ ...options, cacheDir });
  } catch (error) {
    await rm(cacheDir, { recursive: true, force: true });
    throw error;
  }
  const close = server.close.bind(server);
  let closing;
  server.close = () => {
    closing ??= (async () => {
      // Vite 8 cancellation can return while Rolldown still writes deps_temp_*.
      // Drain actual scan/crawl/optimization work before closing and removing it.
      await Promise.all(Object.values(server.environments).map(async (environment) => {
        await environment.waitForRequestsIdle();
        const optimizer = environment.depsOptimizer;
        await optimizer?.scanProcessing;
        await Promise.all(Object.values(optimizer?.metadata.discovered || {}).map((dependency) => dependency.processing));
      }));
      await close();
      await rm(cacheDir, { recursive: true, force: true });
    })();
    return closing;
  };
  return server;
}
