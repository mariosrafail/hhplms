import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;

export function runFixedProcess(command, args, {
  cwd,
  env = process.env,
  maxOutputBytes = DEFAULT_MAX_OUTPUT,
  onOutput = () => {},
  signal,
  timeout = 0,
} = {}) {
  if (typeof command !== "string" || !command || !Array.isArray(args) || args.some((item) => typeof item !== "string")) {
    throw new TypeError("Fixed process execution requires a command and a string argument array.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, signal, timeout, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = { stdout: [], stderr: [] };
    let outputBytes = 0;
    const capture = (stream, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        reject(Object.assign(new Error("Process output exceeded the safe limit."), { code: "teacher_process_output_too_large" }));
        return;
      }
      chunks[stream].push(chunk);
      onOutput(stream, chunk.toString("utf8"));
    };
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      const result = {
        exitCode: exitCode ?? 1,
        signal: signal || null,
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
      };
      if (result.exitCode !== 0) {
        reject(Object.assign(new Error("Teacher project process failed."), { code: "teacher_process_failed", result }));
      } else resolve(result);
    });
  });
}
