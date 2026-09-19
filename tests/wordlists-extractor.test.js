import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("Python 3.11+ with LZMA is required; bounded synthetic ZWS/FWS/CWS extraction never silently skips", () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const prerequisite = spawnSync(python, ["-c", "import sys,lzma,zlib; assert sys.version_info >= (3,11)"], { encoding: "utf8" });
  assert.equal(prerequisite.status, 0, `Install Python 3.11+ with lzma: ${prerequisite.error || prerequisite.stderr}`);
  const result = spawnSync(python, ["scripts/wordlists/test_extractor.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
