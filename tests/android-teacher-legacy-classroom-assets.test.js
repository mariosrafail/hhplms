import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { parseGaf } from "../src/apps/android-teacher-offline/legacyGaf.js";
import { ultimateB2TeacherAppDefaultAssets } from "../src/data/ultimate-b2/teacherAppAuthoring.js";

const assetRoot = path.resolve("src/assets/books/ultimate-b2/legacy-classroom-ui");
const manifestPath = path.join(assetRoot, "asset-manifest.json");
const sourceRoot = path.resolve("Ultimate English B2.app");
const baseline = [
  ["classroom-glacier-background", "backgrounds/classroom-glacier.png", "9e1de723dfec16d13826402d2049e10a9c673fda0b0d4b28384737a170dc30eb", 2695761],
  ["activity-hotspot", "controls/activity-hotspot.png", "675f4d14ddc054ab6290a16f724f7fd3571e3b38896228d5899cdc21b0385d95", 2131],
  ["navigation-back", "icons/back.png", "6b70fbd54fdb2a94d1f5b351b24f44c297a70c145243d398078de3caff275560", 7620],
  ["answer-check", "icons/check.png", "83492298d76f620e83e30c58d72063a0407b6b0ffce935c1dcb19fbcf275b635", 7349],
  ["navigation-home", "icons/home.png", "59795998ea3b910eaeaced939d02199386859467775ddf41a0a5f739c16da773", 7051],
  ["navigation-next", "icons/next.png", "f1578f85ec1c3db6ad8492b920117c379f59bba185f887e89443ad97c7188c56", 7124],
  ["navigation-previous", "icons/previous.png", "3f7cdb8f961a3c16698b8449a8f1d202117d93dc256367a1785a377bcd0ea22b", 7113],
  ["ui-button-sound", "audio/ui/button.mp3", "6c765ec221573c6eb10da4b4c9a4d6843ecfb2f22cb03594dfb9f960bc77a682", 2924],
  ["ui-correct-sound", "audio/ui/correct.mp3", "b004a9d41c0b67f67c3bee5bd455829e693d1345294902ceea6be708564c1bd4", 21490],
  ["ui-incorrect-sound", "audio/ui/incorrect.mp3", "3eb641113f49374c8d5381649d0158c5bc171db3b942bc570be08c32bad2ba06", 8817],
  ["ui-page-turn-sound", "audio/ui/page-turn.mp3", "ee4c27e4aa2efb64b7081d8e361b26c5acae6a7854dc55a7e5929729113b54b7", 48024],
];

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  }))).flat();
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function mp3Metadata(bytes) {
  const syncsafe = (offset) => (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3];
  let offset = bytes.toString("ascii", 0, 3) === "ID3" ? 10 + syncsafe(6) : 0;
  const bitrates1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitrates2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let samples = 0; let frameCount = 0; let sampleRateHz = 0; let channels = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) { offset += 1; continue; }
    const version = (bytes[offset + 1] >> 3) & 3; const layer = (bytes[offset + 1] >> 1) & 3;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 15; const rateIndex = (bytes[offset + 2] >> 2) & 3; const padding = (bytes[offset + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) { offset += 1; continue; }
    const rates = version === 3 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    const rate = rates[rateIndex]; const kbps = (version === 3 ? bitrates1 : bitrates2)[bitrateIndex];
    const length = Math.floor((version === 3 ? 144000 : 72000) * kbps / rate) + padding;
    if (offset + length > bytes.length) break;
    samples += version === 3 ? 1152 : 576; frameCount += 1; sampleRateHz = rate; channels = ((bytes[offset + 3] >> 6) & 3) === 3 ? 1 : 2; offset += length;
  }
  assert.ok(frameCount, "MP3 has no decodable frames");
  return { durationSeconds: samples / sampleRateHz, frameCount, sampleRateHz, channels };
}

test("legacy classroom manifest schema, files, hashes, dimensions, audio, and baseline are valid", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  const ids = new Set(); const hashes = new Set(); const declaredPaths = new Set();
  for (const asset of manifest.assets) {
    assert.ok(asset.id && !ids.has(asset.id), `duplicate or empty ID: ${asset.id}`); ids.add(asset.id);
    assert.ok(!hashes.has(asset.sha256), `${asset.id} duplicates a tracked payload`); hashes.add(asset.sha256);
    assert.ok(asset.outputPath && !declaredPaths.has(path.normalize(asset.outputPath)), `duplicate output: ${asset.outputPath}`); declaredPaths.add(path.normalize(asset.outputPath));
    assert.match(asset.sourceRelativePath, /^Contents\//); assert.doesNotMatch(asset.sourceRelativePath, /^[A-Za-z]:|^\\\\|\.\.[\\/]/);
    assert.doesNotMatch(asset.outputPath, /\.(?:swf|exe|dll|dylib|bat|cmd|sh|zip|flv|mp4)$/i);
    const absolute = path.resolve(assetRoot, asset.outputPath); assert.ok(absolute.startsWith(`${assetRoot}${path.sep}`), `${asset.id} escapes catalog root`);
    const bytes = await readFile(absolute); assert.equal((await stat(absolute)).size, asset.sizeBytes, `${asset.id} size`); assert.equal(sha256(bytes), asset.sha256, `${asset.id} hash`);
    if (/\.png$/i.test(asset.outputPath)) {
      const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, asset.width, `${asset.id} width`); assert.equal(metadata.height, asset.height, `${asset.id} height`);
      if (Object.hasOwn(asset, "hasAlpha")) assert.equal(metadata.hasAlpha, asset.hasAlpha, `${asset.id} alpha`);
    }
    if (/\.mp3$/i.test(asset.outputPath)) {
      const metadata = mp3Metadata(bytes); assert.ok(Math.abs(metadata.durationSeconds - asset.durationSeconds) < 0.001, `${asset.id} duration`);
      if (asset.sampleRateHz) assert.equal(metadata.sampleRateHz, asset.sampleRateHz, `${asset.id} sample rate`);
      if (asset.channels) assert.equal(metadata.channels, asset.channels, `${asset.id} channels`);
    }
    if (!asset.usedBy?.length) {
      for (const required of ["sourceSha256", "functionalRole", "state", "audience", "intendedConsumer", "evidence", "confidence", "sourceKind", "extractionDetails", "duplicateStatus", "nearDuplicateStatus", "recommendedAction"]) assert.ok(Object.hasOwn(asset, required), `${asset.id} missing ${required}`);
      assert.ok(["teacher", "student", "shared"].includes(asset.audience));
      assert.ok(["copied", "atlas-crop", "embedded-preview"].includes(asset.sourceKind));
    }
  }
  const canonicalById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const aliasIds = new Set();
  for (const alias of manifest.assetAliases) {
    assert.ok(alias.id && !ids.has(alias.id) && !aliasIds.has(alias.id), `duplicate alias ID: ${alias.id}`); aliasIds.add(alias.id);
    const canonical = canonicalById.get(alias.canonicalAssetId); assert.ok(canonical, `${alias.id} lacks canonical asset`);
    assert.equal(alias.sha256, canonical.sha256, `${alias.id} alias hash`);
    assert.match(alias.sourceRelativePath, /^Contents\//); assert.match(alias.reason, /Exact byte duplicate/);
  }
  assert.deepEqual(baseline.map(([id]) => {
    const asset = manifest.assets.find((candidate) => candidate.id === id);
    return [asset.id, asset.outputPath, asset.sha256, asset.sizeBytes];
  }), baseline, "original manifest entries changed");
  const actualAssets = (await filesBelow(assetRoot)).map((absolute) => path.relative(assetRoot, absolute)).filter((relative) => !["README.md", "asset-manifest.json"].includes(relative) && !relative.startsWith(path.join("icons", "navigation", "publisher-navibar") + path.sep));
  assert.deepEqual(new Set(actualAssets), declaredPaths);
});

test("source-present validation reproduces exact copies and every atlas crop", async (t) => {
  try { await stat(sourceRoot); } catch { t.skip("canonical .app is intentionally unavailable in CI"); return; }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ultimate-b2-swf-static-")); t.after(() => rm(temporary, { recursive: true, force: true }));
  execFileSync("python", ["scripts/ultimate-b2/legacy-swf-static-extract.py", path.join(sourceRoot, "Contents/Resources/UltimateB2.swf"), "--output", temporary, "--write"], { stdio: "ignore" });
  const embedded = JSON.parse(await readFile(path.join(temporary, "index.json"), "utf8"));
  const menuBranding = JSON.parse(execFileSync("node", ["scripts/ultimate-b2/recover-menu-branding.mjs", sourceRoot], { encoding: "utf8" }));
  const menuBrandingEntries = new Map(menuBranding.entries.map((entry) => [entry.source, entry]));
  const embeddedById = new Map(embedded.resources.map((resource) => [resource.characterId, resource]));
  const canonicalById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const asset of manifest.assets) {
    const tracked = await readFile(path.join(assetRoot, asset.outputPath));
    if (asset.sourceKind === "copied") assert.ok(tracked.equals(await readFile(path.join(sourceRoot, ...asset.sourceRelativePath.split("/")))), `${asset.id} is not byte-exact`);
    if (asset.sourceKind === "extracted") {
      const match = asset.conversionDetails.match(/x=(\d+), y=(\d+), (\d+)x(\d+)/); assert.ok(match, `${asset.id} crop coordinates`);
      const raw = await sharp(path.join(sourceRoot, ...asset.sourceRelativePath.split("/"))).extract({ left: +match[1], top: +match[2], width: +match[3], height: +match[4] }).raw().toBuffer();
      assert.ok(raw.equals(await sharp(tracked).raw().toBuffer()), `${asset.id} pixel mismatch`);
    }
    if (asset.sourceKind === "atlas-crop") {
      const details = asset.extractionDetails;
      const atlas = details.characterId ? path.join(temporary, embeddedById.get(details.characterId).fileName) : path.join(sourceRoot, ...details.atlasImagePath.split("/"));
      const raw = await sharp(atlas).extract({ left: details.x, top: details.y, width: details.width, height: details.height }).raw().toBuffer();
      assert.ok(raw.equals(await sharp(tracked).raw().toBuffer()), `${asset.id} atlas pixels`);
    }
    if (asset.sourceKind === "embedded-preview") {
      const resource = embeddedById.get(asset.extractionDetails.characterId); assert.ok(resource, `${asset.id} embedded character`);
      assert.ok(tracked.equals(await readFile(path.join(temporary, resource.fileName))), `${asset.id} embedded payload`);
    }
    if (asset.sourceKind === "archive-entry") {
      const entry = menuBrandingEntries.get(asset.sourceArchiveEntry);
      assert.ok(entry, `${asset.id} archive entry`);
      assert.equal(entry.sha256, asset.sha256, `${asset.id} archive-entry hash`);
      assert.equal(entry.sizeBytes, asset.sizeBytes, `${asset.id} archive-entry size`);
      assert.equal(menuBranding.sourceArchive, asset.sourceRelativePath, `${asset.id} source archive`);
      assert.equal(menuBranding.sourceArchiveSha256, asset.sourceSha256, `${asset.id} source archive hash`);
    }
  }
  for (const alias of manifest.assetAliases) {
    const canonical = await readFile(path.join(assetRoot, canonicalById.get(alias.canonicalAssetId).outputPath));
    if (alias.sourceKind === "copied") assert.ok(canonical.equals(await readFile(path.join(sourceRoot, ...alias.sourceRelativePath.split("/")))), `${alias.id} copied alias`);
    if (alias.sourceKind === "atlas-crop") {
      const details = alias.extractionDetails;
      const atlas = details.characterId ? path.join(temporary, embeddedById.get(details.characterId).fileName) : path.join(sourceRoot, ...details.atlasImagePath.split("/"));
      const raw = await sharp(atlas).extract({ left: details.x, top: details.y, width: details.width, height: details.height }).raw().toBuffer();
      assert.ok(raw.equals(await sharp(canonical).raw().toBuffer()), `${alias.id} alias pixels`);
    }
    if (alias.sourceKind === "embedded-preview") {
      const resource = embeddedById.get(alias.extractionDetails.characterId); assert.ok(resource, `${alias.id} embedded alias character`);
      assert.ok(canonical.equals(await readFile(path.join(temporary, resource.fileName))), `${alias.id} embedded alias payload`);
    }
  }
});

test("teacher registry imports only in-use baseline and catalog remains outside Student source", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const registryPath = path.resolve("src/apps/android-teacher-offline/legacyClassroomAssets.js");
  const canonicalRegistryPath = path.resolve("src/data/ultimate-b2/teacherAppAuthoring.js");
  const canonicalResolverPath = path.resolve("src/data/ultimate-b2/ultimateB2AuthoredAssetUrls.js");
  const builderVisualResolverPath = path.resolve("src/data/ultimate-b2/ultimateB2BuilderVisualAssetUrls.js");
  const registry = await readFile(registryPath, "utf8");
  const legacyPrefix = "src/assets/books/ultimate-b2/legacy-classroom-ui/";
  const importedOutputs = Object.values(ultimateB2TeacherAppDefaultAssets)
    .filter((asset) => asset.repositoryPath.startsWith(legacyPrefix) && !asset.repositoryPath.includes("/publisher-navibar/"))
    .map((asset) => path.normalize(asset.repositoryPath.slice(legacyPrefix.length)));
  const editionArtworkNowAliasedToStudentsBook = new Set([
    "book-menu/editions/workbook-normal.png",
    "book-menu/editions/workbook-hover-pressed.png",
    "book-menu/editions/grammar-book-normal.png",
    "book-menu/editions/grammar-book-hover-pressed.png",
  ].map((outputPath) => path.normalize(outputPath)));
  const inUse = manifest.assets
    .filter((asset) => asset.usedBy?.length && !editionArtworkNowAliasedToStudentsBook.has(path.normalize(asset.outputPath)))
    .map((asset) => path.normalize(asset.outputPath));
  assert.deepEqual(new Set(importedOutputs), new Set(inUse));
  assert.match(registry, /teacherAppAuthoring/);
  assert.doesNotMatch(registry, /legacy-classroom-ui\//);
  const sourceFiles = await filesBelow(path.resolve("src"));
  for (const sourceFile of sourceFiles) {
    if (sourceFile.startsWith(`${path.resolve("src/apps/android-teacher-offline")}${path.sep}`)) continue;
    if (sourceFile === canonicalRegistryPath || sourceFile === canonicalResolverPath || sourceFile === builderVisualResolverPath) continue;
    // The edition classroom deliberately consumes the same provider as the
    // Teacher shell; its build resolves only the bounded visual defaults.
    if (sourceFile === path.resolve("src/components/wordlists/EditionClassroom.jsx")) continue;
    if (!/\.(?:js|jsx|ts|tsx|css)$/.test(sourceFile)) continue;
    assert.doesNotMatch(await readFile(sourceFile, "utf8"), /legacyClassroomAssets|legacy-classroom-ui/);
  }
  const builderVisualResolver = await readFile(builderVisualResolverPath, "utf8");
  assert.match(builderVisualResolver, /\{png,jpg,jpeg,webp\}/);
  assert.doesNotMatch(builderVisualResolver, /\.(?:mp3|wav|gaf)["']/i);
  assert.equal(execFileSync("git", ["ls-files", "--", "Ultimate English B2.app/**"], { encoding: "utf8" }).trim(), "");
});

test("recovered Ultimate B2 book-menu controls preserve every required HD atlas region", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const controls = manifest.assets.filter((asset) => asset.id.startsWith("book-menu-button-"));
  const extras = manifest.assets.filter((asset) => asset.id.startsWith("book-menu-extra-"));
  assert.equal(controls.length, 28);
  assert.equal(extras.length, 30);
  assert.deepEqual(new Set(controls.map((asset) => asset.state)), new Set(["normal", "hover-pressed"]));
  assert.equal(controls.filter((asset) => asset.category === "book-menu/units").length, 20);
  assert.equal(controls.filter((asset) => asset.category === "book-menu/editions").length, 8);
  for (const asset of controls) {
    assert.equal(asset.extractionDetails.atlasMetadataPath, "Contents/Resources/assets/books/book1/book_menu/HD/book_atlas.xml");
    assert.equal(asset.extractionDetails.atlasImageSha256, "1f776a9c6b452ab677e5afb4c1dbb2084f44a7e27121b59e5fa23dd297744ed7");
    assert.match(asset.extractionDetails.regionName, /^button_(?:0[1-9]|10|1[2345])[ab]$/);
    assert.equal(asset.width, asset.category.endsWith("units") ? 360 : 301);
    assert.equal(asset.height, asset.category.endsWith("units") ? 93 : 99);
  }
  for (const asset of extras) {
    assert.equal(asset.category, "book-menu/units-extras");
    assert.equal(asset.width, 320);
    assert.equal(asset.height, 81);
    assert.match(asset.extractionDetails.regionName, /^extra_(?:01|04|05|06|07|08|09|10|12|13|14|15|16|17|18)[ab]$/);
  }
  assert.equal(extras.filter((asset) => asset.extractionDetails.regionName.startsWith("extra_09")).every((asset) => asset.usedBy.length === 0), true, "Companion Exercises remains cataloged but outside the requested Extras launcher");
});

test("recovered central menu GAF is parseable as the exact authored timeline", async () => {
  const bytes = await readFile(path.join(assetRoot, "branding/menu-title-animation/logo.gaf"));
  const config = await parseGaf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(config.version, "5.8");
  assert.deepEqual(config.stage, { fps: 24, color: -1, width: 1024, height: 768 });
  assert.equal(config.timeline.linkage, "rootTimeline");
  assert.equal(config.timeline.frameCount, 334);
  assert.equal(config.frames.length, 334);
  assert.equal(config.objects.size, 79);
  assert.equal(config.atlas.elements.size, 79);
  assert.equal(config.timeline.bounds.width, 432.07501220703125);
  assert.equal(config.timeline.bounds.height, 295.6000061035156);
});

test("UI audio does not duplicate educational media and Teacher build emits files", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const educationalRoots = ["src/assets/books/ultimate-b2/media", "src/assets/books/ultimate-b2/teacher-offline-media"];
  const educationalHashes = new Set();
  for (const root of educationalRoots) for (const file of await filesBelow(path.resolve(root))) educationalHashes.add(sha256(await readFile(file)));
  for (const asset of manifest.assets.filter((candidate) => candidate.outputPath.endsWith(".mp3"))) assert.ok(!educationalHashes.has(asset.sha256), `${asset.id} duplicates educational media`);
  const viteConfig = await readFile("vite.config.js", "utf8");
  assert.match(viteConfig, /assetsInlineLimit:\s*isAndroidTeacherOffline\s*\?\s*0\s*:\s*isAndroidTeacherProject\s*\?\s*0\s*:\s*4096/);
});

test("static extractors are explicit, dry by default, and reject writes into the app", async () => {
  const [catalog, swf, menuBranding, bookMenu] = await Promise.all([
    readFile("scripts/ultimate-b2/legacy-ui-catalog.mjs", "utf8"),
    readFile("scripts/ultimate-b2/legacy-swf-static-extract.py", "utf8"),
    readFile("scripts/ultimate-b2/recover-menu-branding.mjs", "utf8"),
    readFile("scripts/ultimate-b2/recover-book-menu-assets.mjs", "utf8"),
  ]);
  assert.match(catalog, /if \(!sourceArg\)/); assert.match(catalog, /const write = args\.includes\("--write"\)/); assert.match(catalog, /Refusing to write inside source bundle/);
  assert.match(menuBranding, /const write = args\.includes\("--write"\)/);
  assert.match(menuBranding, /Refusing to write inside source bundle/);
  assert.doesNotMatch(menuBranding, /C:\\Users\\/);
  assert.match(bookMenu, /const write = args\.includes\("--write"\)/);
  assert.match(bookMenu, /Refusing to write inside source bundle/);
  assert.doesNotMatch(bookMenu, /C:\\Users\\/);
  assert.match(swf, /requires both an explicit source SWF and --write/); assert.match(swf, /Refusing to write inside the source application bundle/); assert.doesNotMatch(catalog, /C:\\Users\\/);
});
