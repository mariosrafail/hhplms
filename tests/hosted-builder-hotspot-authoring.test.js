import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(file, "utf8");
const hostedHotspotSource = async () => [
  await read("src/apps/ultimate-b2-builder/HostedUltimateB2HotspotBuilder.jsx"),
  await read("src/apps/book-builder/hosted/HostedHotspotBuilder.jsx"),
].join("\n");

test("hosted Hotspot Builder reuses the proven editor and exposes explicit persistence state", async () => {
  const editor = await hostedHotspotSource();
  assert.match(editor, /EditableHotspotLayer/);
  assert.doesNotMatch(editor, /ultimateB2StudentsBookPageUnits/);
  assert.doesNotMatch(editor, /android-content-packs\/ultimate-b2-students-book\/catalog\.json/);
  assert.match(editor, /const managed = true/);
  assert.match(editor, /managed=\{managed\}/);
  assert.match(editor, /getBuilderPages/);
  assert.match(editor, /setStatus\("Loading"\)/);
  assert.match(editor, /setStatus\("Ready"\)/);
  assert.match(editor, /setStatus\("Unsaved changes"\)/);
  assert.match(editor, /setStatus\("Saving"\)/);
  assert.match(editor, /setStatus\("Saved"\)/);
  assert.match(editor, /setStatus\("Save failed"\)/);
  assert.match(editor, /setStatus\("Conflict"\)/);
  assert.match(editor, /beforeunload/);
  assert.match(editor, /Reload latest/);
  assert.match(editor, /expectedRevision: revision/);
  assert.match(editor, /clientMutationId: mutationId\.current/);
  assert.match(editor, /disabled=\{!dirty \|\| status === "Saving"\}/);
  assert.match(editor, /Drag on the page to create a hotspot/);
  assert.match(editor, /Delete hotspot/);
  assert.match(editor, /registerToolContext\("hotspots"/);
  assert.match(editor, /view: "page"/);
  assert.match(editor, /pageId: page\.id/);
  assert.match(editor, /refreshKey: viewerRefreshKey/);
  assert.doesNotMatch(editor, /<HostedViewerPreview\b/);
});

test("hosted conflict handling retains local edits until explicit reload", async () => {
  const editor = await hostedHotspotSource();
  const conflict = editor.match(/if \(requestError instanceof BuilderContentApiError[\s\S]*?\n\s*\} else/)?.[0] || "";
  assert.match(conflict, /setConflictRevision/);
  assert.match(conflict, /setStatus\("Conflict"\)/);
  assert.match(conflict, /Your unsaved changes are still here/);
  assert.doesNotMatch(conflict, /setManifest|setDirty\(false\)|loadLatest/);
  assert.match(editor, /onClick=\{\(\) => loadLatest\(\)/);
});

test("Viewer refresh advances only after a successful persisted hotspot save", async () => {
  const editor = await hostedHotspotSource();
  const saveBody = editor.match(/async function save\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const success = saveBody.match(/setManifest\(payload\.document\)[\s\S]*?setViewerRefreshKey\(\(value\) => value \+ 1\)/)?.[0] || "";
  assert.match(success, /setStatus\("Saved"\)/);
  assert.equal([...saveBody.matchAll(/setViewerRefreshKey/g)].length, 1);
  assert.doesNotMatch(saveBody.match(/if \(payload\.currentRevision > payload\.revision\) \{[\s\S]*?return;\n      \}/)?.[0] || "", /setViewerRefreshKey/);
  assert.doesNotMatch(saveBody.match(/status === 409[\s\S]*?\} else/)?.[0] || "", /setViewerRefreshKey/);
});

test("Students adapter exposes component tools while the UI Controller is package-owned", async () => {
  const [adapters, shell, b2Workspace, activityWorkspace] = await Promise.all([
    read("src/apps/book-builder/hosted/hostedBuilderAdapters.jsx"),
    read("src/apps/book-builder/hosted/HostedBookBuilderApp.jsx"),
    read("src/apps/ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"),
    read("src/apps/book-builder/hosted/HostedActivityWorkspace.jsx"),
  ]);
  const workspace = `${b2Workspace}\n${activityWorkspace}`;
  assert.match(adapters, /pages: Object\.freeze\(\{ readable: true, writable: true \}\)/);
  assert.match(adapters, /hotspots: Object\.freeze\(\{ readable: true, writable: true \}\)/);
  assert.match(adapters, /activities: Object\.freeze\(\{ readable: true, writable: true \}\)/);
  assert.doesNotMatch(adapters.match(/"ultimate-b2-students-book":[\s\S]*?Workspace: UltimateB2StudentsBookWorkspace/)?.[0] || "", /uiController/);
  assert.match(adapters, /"ultimate-b2-page-ui": Object\.freeze\(\{ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", Tool: HostedTeacherUiController \}\)/);
  assert.match(shell, /tools\.filter\(\(\{ capability \}\) => adapter\.capabilities\[capability\]\?\.readable\)/);
  assert.match(shell, /adapter\.capabilities\[capability\]\.writable \? "Editable" : "Read-only"/);
  assert.doesNotMatch(workspace, /HostedTeacherUiController/);
  assert.match(workspace, /Editable canonical activity/);
  assert.match(workspace, /Read-only canonical activity/);
  assert.doesNotMatch(workspace, /b2-hosted-review-banner/);
  assert.doesNotMatch(workspace, /ReadOnlyBanner|persistence pending/);
  assert.match(workspace, /Add Activity/);
  assert.match(workspace, /NativeActivityFoundationEditor/);
  assert.doesNotMatch(workspace, /Content complete|Content incomplete/);
  assert.doesNotMatch(workspace, /upload|FormData/i);
});

test("hosted and local hotspot persistence transports stay deliberately separate", async () => {
  const [hostedClient, hostedEditor, localEditor, localPlugin] = await Promise.all([
    read("src/apps/book-builder/hosted/builderContentApi.js"),
    read("src/apps/book-builder/hosted/HostedHotspotBuilder.jsx"),
    read("src/apps/ultimate-b2-builder/UltimateB2HotspotBuilder.jsx"),
    read("scripts/ultimate-b2/hotspot-builder-vite-plugin.mjs"),
  ]);
  assert.match(hostedClient, /\/builder\/api\/content/);
  assert.match(hostedClient, /method: "PUT"/);
  assert.doesNotMatch(`${hostedClient}\n${hostedEditor}`, /__hhplms|repositoryFileTarget|writeAuthoringJson/);
  assert.match(localEditor, /\/__hhplms\/ultimate-b2-hotspots/);
  assert.match(localEditor, /\/__hhplms\/book-menu-skin-selection/);
  assert.match(localPlugin, /writeAuthoringJson/);
  assert.match(localPlugin, /loopbackAddresses/);
  assert.doesNotMatch(`${localEditor}\n${localPlugin}`, /\/builder\/api\/content/);
});
