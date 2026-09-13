import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const textExtensions = new Set([".html", ".js", ".css", ".json", ".map", ".txt", ".xml"]);

const prohibitedPatterns = [
  ["Publisher Review Studio client", /Hamilton House Publisher Review Studio|Read-only Milestone 4A|__hhplms\/book-builder/gi],
  ["publisher resource path", /Contents[\\/]Resources[\\/]/gi],
  ["publisher application path", /Ultimate English B2\.app/gi],
  ["publisher IWB reference", /\.iwb\b/gi],
  ["publisher SWF reference", /\.swf\b/gi],
  ["local Windows user path", /[A-Za-z]:[\\/]Users[\\/]/g],
  ["local Nextcloud path", /\bNextcloud\b/gi],
  ["local worktree path", /\bCodexWorktrees\b/gi],
  ["publisher provenance field", /\b(?:sourceRelativePath|sourceProvenance|localDevelopmentPath|decodedSourceSelector)\b/g],
  ["database connection string", /postgres(?:ql)?:\/\/[^\s"'`]+/gi],
  ["Neon database hostname", /[a-z0-9.-]+\.neon\.tech\b/gi],
  ["known test or staging password", /\b(?:password123|qa[-_ ]?password|staging[-_ ]?password)\b/gi],
  ["IWB XOR key material", /EA3DC7D7-6954-471A-8399-E217B522F5F2|IWB_XOR_KEY/gi],
  ["Ruffle runtime", /@ruffle-rs|RufflePlayer|ruffle_web/gi],
  ["AIR runtime", /Adobe AIR|AIR runtime/gi],
  ["answer record field", /\b(?:normalizedAnswerRecords|answerRecords|explicitAnswerEvidence|publisherAnswerValue|decodedPublisherValue)\b/g],
  ["serialized answer-key field", /["'](?:acceptedAnswers|acceptedAnswer|correctAnswers|correctAnswer|correctWordIds|correctTargetIds)["']\s*:/g],
  ["hardcoded correct-word ID array", /\bcorrectWordIds\s*:\s*\[\s*["']word-/g],
  ["hardcoded answer value", /(?:\{|,)answer\s*:\s*(?:`[^`]+`|"[^"]+"|'[^']+')/g],
  ["hardcoded accepted-answer array", /\bacceptedAnswers\s*:\s*\[\s*(?:`[^`]+`|"[^"]+"|'[^']+')/g],
  ["known legacy listening answer", /three point five/gi],
  ["known legacy quiz answer", /C\. producer|D\. radar/gi],
  ["known Teacher-only Page 5 model answer", /Films are an art form which involve many artistic processes/gi],
];

const teacherAnswerPatternLabels = new Set([
  "answer record field",
  "serialized answer-key field",
  "hardcoded correct-word ID array",
  "hardcoded answer value",
  "hardcoded accepted-answer array",
  "known legacy listening answer",
  "known legacy quiz answer",
  "known Teacher-only Page 5 model answer",
]);

async function filesUnder(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(absolute));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output.sort();
}

export async function scanWebBundle(root, { allowTeacherAnswers = false } = {}) {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`Standard web build directory not found: ${root}`);
  const files = await filesUnder(root);
  const findings = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const [label, pattern] of prohibitedPatterns) {
      if (allowTeacherAnswers && teacherAnswerPatternLabels.has(label)) continue;
      pattern.lastIndex = 0;
      const matches = [...content.matchAll(pattern)].filter((match) => {
        if (label !== "hardcoded answer value") return true;
        // Course-authoring scaffolds use these exact, non-authoritative placeholder
        // values. Any other static answer value remains a release-blocking finding.
        return !/answer\s*:\s*(?:`(?:Option A|Word 1|Word 2)`|"(?:Option A|Word 1|Word 2)"|'(?:Option A|Word 1|Word 2)')/.test(match[0]);
      });
      if (matches.length) findings.push({ file: path.relative(root, file).replaceAll("\\", "/"), label, count: matches.length });
    }
  }
  return { filesScanned: files.length, findings, matchCount: findings.reduce((sum, finding) => sum + finding.count, 0) };
}

async function main() {
  const root = path.resolve(process.argv[2] || "dist");
  const result = await scanWebBundle(root);
  if (result.findings.length) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ...result, status: "safe" }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) await main();
