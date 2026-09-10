import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

const activityId = "ultimate-b2-sb-u1-p1-o99";
const titleSentinel = "INTERACTIVE_METADATA_TITLE_SENTINEL";
const instructionSentinel = "INTERACTIVE_METADATA_INSTRUCTION_SENTINEL";
const asset = { assetId: "10000000-0000-4000-8000-000000000099", slot: "asset-image" };

function imageDocument({ images = [], contentText } = {}) {
  return {
    activityId,
    kind: "image",
    metadata: { title: titleSentinel, visibleInstructionText: instructionSentinel },
    assets: images.length ? [asset] : [],
    parts: [{
      interaction: {
        kind: "image",
        surface: { width: 1024, height: 582 },
        images,
        ...(contentText === undefined ? {} : { contentText }),
      },
    }],
  };
}

function image(id, overrides = {}) {
  return {
    id,
    assetSlot: asset.slot,
    area: { x: 128, y: 100, width: 512, height: 291 },
    order: 2,
    altText: "Authored diagram",
    decorative: false,
    fit: "cover",
    locked: false,
    ...overrides,
  };
}

async function withVite(run) {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    await run(vite);
  } finally {
    await vite.close();
  }
}

test("Native Image uses neutral read-only layers while preserving authored image presentation", async () => {
  await withVite(async (vite) => {
    const { NativeImageSurface } = await vite.ssrLoadModule("/src/components/native-image/NativeImageSurface.jsx");
    const document = imageDocument({ images: [image("image-1"), image("image-2", { decorative: true, altText: "", fit: "contain", order: 3 })] });
    const surface = NativeImageSurface({ document, assetUrl: () => "/fixture.png" });
    const layers = surface.props.children[0];

    assert.equal(layers.length, 2);
    assert.equal(layers[0].type, "div");
    assert.equal(layers[0].props.disabled, undefined);
    assert.equal(layers[0].props.onClick, undefined);
    assert.equal(layers[0].props.style.position, "absolute");
    assert.equal(layers[0].props.style.pointerEvents, "none");
    assert.deepEqual(
      { left: layers[0].props.style.left, top: layers[0].props.style.top, width: layers[0].props.style.width, height: layers[0].props.style.height, zIndex: layers[0].props.style.zIndex },
      { left: "12.5%", top: `${(100 / 582) * 100}%`, width: "50%", height: "50%", zIndex: 3 },
    );
    assert.equal(layers[0].props.children.type, "img");
    assert.equal(layers[0].props.children.props.alt, "Authored diagram");
    assert.equal(layers[0].props.children.props.style.objectFit, "cover");
    assert.equal(layers[1].props.children.props.alt, "");
    assert.equal(layers[1].props.children.props.style.objectFit, "contain");

    const markup = renderToStaticMarkup(surface);
    assert.doesNotMatch(markup, /<button|disabled=/);
    assert.match(markup, /<img[^>]+alt="Authored diagram"/);
    assert.match(markup, /pointer-events:none/);
  });
});

test("Native Image Interactive presentation renders only the authored image composition", async () => {
  await withVite(async (vite) => {
    const { NativeImagePresentation } = await vite.ssrLoadModule("/src/components/native-image/NativeImageSurface.jsx");
    const contentText = "The library closes at 4:30 p.m.\nPlease return books first.";
    const document = imageDocument({ images: [image("image-1")], contentText });
    const markup = renderToStaticMarkup(React.createElement(NativeImagePresentation, { document, assetUrl: () => "/fixture.png" }));
    assert.match(markup, /native-image-surface/);
    assert.doesNotMatch(markup, /native-image-(?:content-text|learner-content)|aria-label="Activity content"/);
    assert.doesNotMatch(markup, /The library closes at 4:30 p\.m\.|Please return books first/);
    assert.doesNotMatch(markup, /hidden|display:\s*none|visibility:\s*hidden/);
    const oldMarkup = renderToStaticMarkup(React.createElement(NativeImagePresentation, { document: imageDocument({ images: [image("image-1")] }), assetUrl: () => "/fixture.png" }));
    assert.match(oldMarkup, /native-image-presentation/);
    assert.match(oldMarkup, /native-image-stage-slot/);
    assert.doesNotMatch(oldMarkup, /native-image-(?:content-text|learner-content)/);
  });
});

test("Native Image keeps selectable button behavior and locked state in authoring mode", async () => {
  await withVite(async (vite) => {
    const { NativeImageSurface } = await vite.ssrLoadModule("/src/components/native-image/NativeImageSurface.jsx");
    const selections = [];
    const onSelect = (id) => selections.push(id);
    const document = imageDocument({ images: [image("image-selected"), image("image-locked", { locked: true, order: 3 })] });
    const surface = NativeImageSurface({ document, assetUrl: () => "/fixture.png", onSelect, selectedId: "image-selected" });
    const layers = surface.props.children[0];

    assert.equal(layers[0].type, "button");
    assert.equal(layers[0].props.type, "button");
    assert.match(layers[0].props.className, /is-selected/);
    assert.equal(layers[0].props.style.pointerEvents, undefined);
    layers[0].props.onClick();
    assert.deepEqual(selections, ["image-selected"]);
    assert.equal(layers[1].type, "button");
    assert.equal(layers[1].props["data-locked"], true);
    assert.equal(layers[1].props.style.pointerEvents, "none");
    assert.match(layers[1].props["aria-label"], /\(locked\)$/);
  });
});

test("Native Open Response uses static preview layers and selectable authoring controls", async () => {
  await withVite(async (vite) => {
    const [{ NativeOpenResponseSurface }, { createNativeOpenResponseQuestion }] = await Promise.all([
      vite.ssrLoadModule("/src/components/native-open-response/NativeOpenResponseSurface.jsx"),
      vite.ssrLoadModule("/src/data/native-activities/nativeOpenResponse.js"),
    ]);
    const question = createNativeOpenResponseQuestion(`q-${"1".repeat(32)}`);
    question.prompt = "Static authored prompt";
    const document = {
      activityId,
      kind: "open-response",
      metadata: { title: titleSentinel, visibleInstructionText: instructionSentinel },
      assets: [asset],
      parts: [{ interaction: { kind: "open-response", surface: { width: 1024, height: 582 }, artwork: [{ id: `art-${"2".repeat(32)}`, assetSlot: asset.slot, area: { x: 20, y: 20, width: 300, height: 180 }, order: 0, altText: "Static diagram", decorative: false, fit: "contain", locked: false }], questions: [question] } }],
    };

    const preview = NativeOpenResponseSurface({ document, assetUrl: () => "/fixture.png" });
    assert.equal(preview.props["data-native-or-presentation"], "runtime");
    assert.equal(preview.props.children[0][0].type, "div");
    assert.equal(preview.props.children[0][0].props.disabled, undefined);
    assert.equal(preview.props.children[0][0].props.onClick, undefined);
    assert.equal(preview.props.children[1][0].type, "div");
    const previewMarkup = renderToStaticMarkup(preview);
    assert.doesNotMatch(previewMarkup, /<button[^>]+native-or-(?:artwork|prompt)/);
    assert.doesNotMatch(previewMarkup, /disabled=/);
    assert.match(previewMarkup, /<img[^>]+alt="Static diagram"/);

    const selections = [];
    const authoring = NativeOpenResponseSurface({ document, assetUrl: () => "/fixture.png", onSelect: (value) => selections.push(value) });
    assert.equal(authoring.props["data-native-or-presentation"], "authoring");
    assert.equal(authoring.props.children[0][0].type, "button");
    assert.equal(authoring.props.children[1][0].type, "button");
    authoring.props.children[0][0].props.onClick();
    const emptyTarget = {};
    authoring.props.onClick({ button: 0, target: emptyTarget, currentTarget: emptyTarget });
    assert.deepEqual(selections, [{ type: "artwork", id: `art-${"2".repeat(32)}` }, null]);
  });
});

test("generic public audio-focus cues render on Image and Open Response visual stages", async () => {
  await withVite(async (vite) => {
    const [{ NativeImageSurface }, { NativeOpenResponseStudentSurface }] = await Promise.all([
      vite.ssrLoadModule("/src/components/native-image/NativeImageSurface.jsx"),
      vite.ssrLoadModule("/src/components/native-open-response/NativeOpenResponseStudentSurface.jsx"),
    ]);
    const readableAsset = { assetId: "10000000-0000-4000-8000-000000000097", slot: "readable-text" };
    const audioAsset = { assetId: "10000000-0000-4000-8000-000000000096", slot: "audio-one" };
    const hotspot = { id: `aud-${"1".repeat(32)}`, panelId: null, activityArea: { x: 64, y: 64, width: 48, height: 48 }, readableFocusArea: { x: 20, y: 40, width: 600, height: 240 }, audioAssetSlot: audioAsset.slot, label: "Listen to public excerpt" };
    const presentation = { hotspots: [hotspot], activeHotspotId: hotspot.id, onToggle() {} };
    const imagePublic = imageDocument({ images: [image("image-1")] }); imagePublic.assets.push(readableAsset, audioAsset);
    const openPublic = { ...imagePublic, kind: "open-response", parts: [{ interaction: { kind: "open-response", surface: { width: 1024, height: 582 }, artwork: [], questions: [] } }] };
    for (const element of [
      React.createElement(NativeImageSurface, { document: imagePublic, assetUrl: () => "/managed", audioHotspotPresentation: presentation }),
      React.createElement(NativeOpenResponseStudentSurface, { document: openPublic, assetUrl: () => "/managed", audioHotspotPresentation: presentation }),
    ]) {
      const markup = renderToStaticMarkup(element);
      assert.match(markup, /aria-label="Listen to public excerpt"/);
      assert.match(markup, /aria-pressed="true"/);
      assert.match(markup, /audio-text-hotspot-pressed/);
      assert.doesNotMatch(markup, /teacher|correctAnswer|modelAnswer/i);
    }
  });
});

test("native runner metadata is default-on and can be suppressed without removing the activity surface", async () => {
  await withVite(async (vite) => {
    const [{ HostedNativeDraftActivityRunner }, { PublishedNativeActivityRunner }] = await Promise.all([
      vite.ssrLoadModule("/src/components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx"),
      vite.ssrLoadModule("/src/components/lms/activities/ultimate-b2/PublishedNativeActivityRunner.jsx"),
    ]);
    const contentSentinel = "LMS_PUBLIC_IMAGE_CONTENT_SENTINEL";
    const teacherSentinel = "PRIVATE_TEACHER_IMAGE_SENTINEL";
    const document = imageDocument({ images: [image("image-1")], contentText: contentSentinel });
    const state = { kind: "ready", entry: { kind: "image", document }, teacher: { kind: "ready", document: { privateValue: teacherSentinel } } };
    const entry = { kind: "image", document };
    const publication = { releaseId: "10000000-0000-4000-8000-000000000098" };

    const hostedDefault = renderToStaticMarkup(React.createElement(HostedNativeDraftActivityRunner, { activityId, state }));
    const hostedInteractive = renderToStaticMarkup(React.createElement(HostedNativeDraftActivityRunner, { activityId, state, showMetadataHeader: false }));
    assert.match(hostedDefault, new RegExp(titleSentinel));
    assert.match(hostedDefault, new RegExp(instructionSentinel));
    assert.equal(hostedDefault.match(new RegExp(contentSentinel, "g"))?.length, 1);
    assert.match(hostedDefault, /class="native-image-learner-content" aria-label="Activity content"/);
    assert.doesNotMatch(hostedDefault, new RegExp(teacherSentinel));
    assert.doesNotMatch(hostedInteractive, new RegExp(`${titleSentinel}|${instructionSentinel}|${contentSentinel}|${teacherSentinel}`));
    assert.match(hostedInteractive, /hosted-native-draft-activity/);
    assert.match(hostedInteractive, /native-image-surface/);
    assert.doesNotMatch(hostedInteractive, /native-image-learner-content/);

    const publishedDefault = renderToStaticMarkup(React.createElement(PublishedNativeActivityRunner, { entry, publication }));
    const publishedInteractive = renderToStaticMarkup(React.createElement(PublishedNativeActivityRunner, { entry, publication, showMetadataHeader: false }));
    assert.match(publishedDefault, new RegExp(titleSentinel));
    assert.match(publishedDefault, new RegExp(instructionSentinel));
    assert.equal(publishedDefault.match(new RegExp(contentSentinel, "g"))?.length, 1);
    assert.match(publishedDefault, /class="native-image-learner-content" aria-label="Activity content"/);
    assert.doesNotMatch(publishedInteractive, new RegExp(`${titleSentinel}|${instructionSentinel}|${contentSentinel}`));
    assert.match(publishedInteractive, /published-native-activity/);
    assert.match(publishedInteractive, /native-image-surface/);
    assert.doesNotMatch(publishedInteractive, /native-image-learner-content/);

    const publishedTeacherDefault = renderToStaticMarkup(React.createElement(PublishedNativeActivityRunner, { entry, publication, teacherMode: true }));
    assert.equal(publishedTeacherDefault.match(new RegExp(contentSentinel, "g"))?.length, 1);
    assert.doesNotMatch(publishedTeacherDefault, new RegExp(teacherSentinel));

    const legacyDefault = renderToStaticMarkup(React.createElement(PublishedNativeActivityRunner, { entry: { kind: "image", document: imageDocument({ images: [image("legacy-image")] }) }, publication }));
    assert.doesNotMatch(legacyDefault, /native-image-learner-content|aria-label="Activity content"/);
  });
});

test("canonical Interactive opts out of both metadata headers while LMS assignment keeps the safe default", async () => {
  const [interactive, assignment] = await Promise.all([
    readFile(new URL("../src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/student/portal/StudentAssignmentWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(interactive, /<PublishedNativeActivityRunner[^>]+showMetadataHeader=\{false\}/);
  assert.match(interactive, /<HostedNativeDraftActivityRunner[^>]+showMetadataHeader=\{false\}/);
  assert.match(assignment, /<PublishedNativeActivityRunner/);
  assert.match(assignment, /PublishedNativeStudentActivityRunner as PublishedNativeActivityRunner/);
  assert.doesNotMatch(assignment, /PublishedNativeTeacherActivityRunner/);
  assert.doesNotMatch(assignment, /showMetadataHeader/);
});
