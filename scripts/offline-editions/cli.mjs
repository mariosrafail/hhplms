import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { assertLocalPath, createCollectionClient, materializeEdition, selectPublishedRelease, verifyPackDirectory } from "../../lib/offline-editions/materialize.js";
import { buildEditionApk } from "../../lib/offline-editions/build.js";
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) { if (!/^--[a-z-]+$/.test(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Invalid CLI options"); options[args[i]] = args[i + 1]; }
const allowed = new Set(["--origin", "--edition", "--release", "--output", "--selection", "--pack", "--version-code", "--version-name", "--access"]);
if (Object.keys(options).some((key) => !allowed.has(key))) throw new Error("Unsupported CLI option. Credentials are accepted only through hidden stdin.");
const abort = new AbortController(); process.once("SIGINT", () => abort.abort());
async function credential() {
  process.stderr.write("Session cookie (transient; input hidden): ");
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = readline.createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) });
  try { return await input.question(""); } finally { input.close(); process.stderr.write("\n"); }
}
try {
  if (command === "verify") console.log((await verifyPackDirectory(options["--pack"])).verification.packSha256);
  else if (command === "build") {
    const result = await buildEditionApk({ repositoryRoot, packRoot: options["--pack"], output: options["--output"],
      versionCode: options["--version-code"] ? Number(options["--version-code"]) : 1, versionName: options["--version-name"] || "1.0", signal: abort.signal, onStage: console.log });
    console.log(result.apkPath);
  } else if (["select", "collect"].includes(command)) {
    const collect = createCollectionClient({ origin: options["--origin"], access: options["--access"] || "builder", credential: await credential(), signal: abort.signal });
    if (command === "select") {
      const result = await selectPublishedRelease({ editionId: options["--edition"], releaseId: options["--release"], collect });
      const output = await assertLocalPath(options["--output"]);
      await fs.writeFile(output, JSON.stringify(result.selection, null, 2), { flag: "wx" }); console.log(JSON.stringify(result));
    } else {
      const selection = JSON.parse(await fs.readFile(options["--selection"], "utf8"));
      const result = await materializeEdition({ selection, collect, repositoryRoot, output: options["--output"], signal: abort.signal }); console.log(result.manifest.packSha256);
    }
  } else if (command === "launcher") {
    const { launchExporter } = await import("./launcher.mjs"); await launchExporter({ repositoryRoot, output: options["--output"] });
  } else console.log("Offline Teacher editions: select --origin URL --edition greek|international --release UUID --output HANDOFF; collect --origin URL --selection HANDOFF --output PACK; verify --pack PACK; build --pack PACK --output NEW_FOLDER; launcher --output NEW_EXPORT_ROOT");
} catch (error) { console.error(error.code || error.message || "Offline export failed"); process.exitCode = 1; }
