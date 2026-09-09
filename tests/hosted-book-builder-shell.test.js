import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createHostedBuilderCatalog,
  findHostedBuilderBook,
  findHostedBuilderComponent,
  hostedBuilderCatalog,
} from "../src/apps/book-builder/hosted/hostedBuilderCatalog.js";
import {
  hostedBuilderHash,
  hostedBuilderReviewHash,
  parseHostedBuilderHash,
} from "../src/apps/book-builder/hosted/hostedBuilderRouter.js";
import { PHASE_ONE_VISIBLE_COMPONENTS } from "../src/config/bookCatalogVisibility.js";

const read = (file) => readFile(file, "utf8");

test("hosted authoring catalog registers all known titles with explicit isolated B1/B1+ shells and unchanged B2 components", () => {
  assert.deepEqual(hostedBuilderCatalog.map(({ slug }) => slug), ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]);
  const book = findHostedBuilderBook("ultimate-b2");
  assert.deepEqual({ slug: book.slug, title: book.title, level: book.level, status: book.status }, {
    slug: "ultimate-b2", title: "Ultimate B2", level: "B2", status: "In authoring",
  });
  assert.deepEqual(book.components.map(({ slug, type }) => ({ slug, type })), [
    { slug: "ultimate-b2-students-book", type: "students_book" },
    { slug: "ultimate-b2-workbook", type: "workbook" },
    { slug: "ultimate-b2-grammar-book", type: "grammar_book" },
    { slug: "ultimate-b2-test-book", type: "test_book" },
  ]);
  assert.equal(findHostedBuilderComponent(book, "ultimate-b2-students-book").adapterId, "ultimate-b2-students-book");
  assert.equal(findHostedBuilderComponent(book, "ultimate-b2-workbook").adapterId, "ultimate-b2-workbook");
  assert.equal(findHostedBuilderComponent(book, "ultimate-b2-workbook").status, "In authoring");
  const grammar = findHostedBuilderComponent(book, "ultimate-b2-grammar-book");
  assert.equal(grammar.adapterId, "ultimate-b2-grammar-book");
  assert.equal(grammar.status, "In authoring");
  const testBook = findHostedBuilderComponent(book, "ultimate-b2-test-book");
  assert.equal(testBook.adapterId, null);
  assert.equal(testBook.status, "Authoring adapter pending");
  assert.deepEqual(book.packageTools.map(({ id, title, status }) => ({ id, title, status })), [
    { id: "ui", title: "Page UI Controller", status: "Editable" },
    { id: "sounds", title: "Sound Controller", status: "Read-only" },
  ]);
  for (const expected of [
    { slug: "ultimate-b1", title: "Ultimate English B1", level: "B1" },
    { slug: "ultimate-b1-plus", title: "Ultimate English B1+", level: "B1+" },
  ]) {
    const managedBook = findHostedBuilderBook(expected.slug);
    assert.deepEqual({ slug: managedBook.slug, title: managedBook.title, level: managedBook.level, status: managedBook.status }, { ...expected, status: "In authoring" });
    assert.deepEqual(managedBook.components.map(({ slug, type }) => ({ slug, type })), [
      { slug: `${expected.slug}-students-book`, type: "students_book" },
      { slug: `${expected.slug}-workbook`, type: "workbook" },
      { slug: `${expected.slug}-grammar-book`, type: "grammar_book" },
      { slug: `${expected.slug}-test-book`, type: "test_book" },
    ]);
    for (const component of managedBook.components.slice(0, 3)) {
      assert.equal(component.adapterId, component.slug);
      assert.equal(component.status, "In authoring");
    }
    assert.equal(managedBook.components[3].adapterId, null);
    assert.equal(managedBook.components[3].status, "Authoring adapter pending");
    assert.deepEqual(managedBook.packageTools.map(({ id, status }) => ({ id, status })), [
      { id: "ui", status: "Editable" },
      { id: "sounds", status: "Read-only" },
    ]);
  }
});

test("hosted authoring catalog is independent from LMS Phase One component hiding", () => {
  const builderSlugs = findHostedBuilderBook("ultimate-b2").components.map(({ slug }) => slug);
  assert.ok(builderSlugs.includes("ultimate-b2-grammar-book"));
  assert.ok(builderSlugs.includes("ultimate-b2-test-book"));
  assert.equal(PHASE_ONE_VISIBLE_COMPONENTS["ultimate-b2"].includes("ultimate-b2-grammar-book"), false);
  assert.equal(PHASE_ONE_VISIBLE_COMPONENTS["ultimate-b2"].includes("ultimate-b2-test-book"), false);
});

test("hosted catalog rejects duplicate book and component identities", () => {
  const book = findHostedBuilderBook("ultimate-b2");
  assert.throws(() => createHostedBuilderCatalog([book, book]), /duplicate hosted Builder book/i);
  assert.throws(() => createHostedBuilderCatalog([{ ...book, components: [book.components[0], book.components[0]] }]), /duplicate hosted Builder component/i);
});

test("generic hosted routing is deterministic and fails closed", () => {
  assert.deepEqual(parseHostedBuilderHash("#/books"), { kind: "library" });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2"), { kind: "book", bookSlug: "ultimate-b2" });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/components/ultimate-b2-students-book"), {
    kind: "workspace", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", tool: "pages",
  });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/components/ultimate-b2-workbook"), {
    kind: "workspace", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-workbook", tool: "pages",
  });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/components/ultimate-b2-students-book/activities"), {
    kind: "workspace", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", tool: "activities",
  });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/ui"), { kind: "package-tool", bookSlug: "ultimate-b2", tool: "ui" });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/sounds"), { kind: "package-tool", bookSlug: "ultimate-b2", tool: "sounds" });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/components/ultimate-b2-students-book/ui"), { kind: "legacy-package-tool", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", tool: "ui" });
  assert.equal(parseHostedBuilderHash("#/books/unknown").bookSlug, "unknown");
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/invalid"), { kind: "not-found" });
  assert.deepEqual(parseHostedBuilderHash("#/books/ultimate-b2/components/unknown/delete"), { kind: "not-found" });
  assert.equal(hostedBuilderHash({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", tool: "ui" }), "#/books/ultimate-b2/components/ultimate-b2-students-book/ui");
  assert.equal(hostedBuilderHash({ bookSlug: "ultimate-b2", packageTool: "ui" }), "#/books/ultimate-b2/ui");
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    for (const suffix of ["students-book", "workbook", "grammar-book"]) {
      const componentSlug = `${bookSlug}-${suffix}`;
      const hash = hostedBuilderHash({ bookSlug, componentSlug, tool: "activities" });
      assert.equal(hash, `#/books/${bookSlug}/components/${componentSlug}/activities`);
      assert.deepEqual(parseHostedBuilderHash(hash), { kind: "workspace", bookSlug, componentSlug, tool: "activities" });
    }
    assert.deepEqual(parseHostedBuilderHash(hostedBuilderHash({ bookSlug, packageTool: "ui" })), { kind: "package-tool", bookSlug, tool: "ui" });
  }
});

test("managed component adapters expose Pages, Hotspots, Activities, and atomic product publication without Teacher UI", async () => {
  const adapters = await read("src/apps/book-builder/hosted/hostedBuilderAdapters.jsx");
  assert.match(adapters, /"ultimate-b2-workbook": Object\.freeze/);
  assert.match(adapters, /props\.tool === "pages" \? <UltimateB2PagesHostedWorkspace/);
  for (const slug of ["ultimate-b2-workbook", "ultimate-b2-grammar-book"]) {
    const start = adapters.indexOf(`"${slug}": Object.freeze`);
    const end = adapters.indexOf("  }),", start) + 5;
    const block = adapters.slice(start, end);
    assert.match(block, /pages: Object\.freeze\(\{ readable: true, writable: true \}\)/);
    assert.match(block, /hotspots: Object\.freeze\(\{ readable: true, writable: true \}\)/);
    assert.match(block, /activities: Object\.freeze\(\{ readable: true, writable: true \}\)/);
    assert.match(block, /publication: Object\.freeze\(\{ readable: true, writable: true \}\)/);
    assert.doesNotMatch(block, /uiController:/);
  }
});

test("B1/B1+ adapters are exact managed tuples with no publication and package tools retain scoped owner identities", async () => {
  const [adapters, shell] = await Promise.all([
    read("src/apps/book-builder/hosted/hostedBuilderAdapters.jsx"),
    read("src/apps/book-builder/hosted/HostedBookBuilderApp.jsx"),
  ]);
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    for (const suffix of ["students-book", "workbook", "grammar-book"]) {
      const slug = `${bookSlug}-${suffix}`;
      assert.match(adapters, new RegExp(`"${slug}": managedAdapter\\(\\{ id: "${slug}", bookSlug: "${bookSlug}"`));
    }
    assert.match(adapters, new RegExp(`"${bookSlug}-page-ui": Object\\.freeze\\(\\{ bookSlug: "${bookSlug}", componentSlug: "${bookSlug}-students-book", Tool: HostedTeacherUiController`));
    assert.match(adapters, new RegExp(`"${bookSlug}-sounds": Object\\.freeze\\(\\{ bookSlug: "${bookSlug}", componentSlug: "${bookSlug}-students-book", Tool: HostedSoundController`));
  }
  const managedCapabilities = adapters.slice(adapters.indexOf("const managedCapabilities"), adapters.indexOf("function managedAdapter"));
  assert.match(managedCapabilities, /pages:[\s\S]*hotspots:[\s\S]*activities:/);
  assert.doesNotMatch(managedCapabilities, /publication|uiController/);
  assert.match(adapters, /adapter\?\.bookSlug === book\?\.slug/);
  assert.match(shell, /<Tool bookSlug=\{resolved\.adapter\.bookSlug\} componentSlug=\{resolved\.adapter\.componentSlug\} bookTitle=\{book\.title\}/);
  assert.match(shell, /route\.kind !== "legacy-package-tool" \|\| !reviewComponent/);
  assert.match(shell, /route\.kind === "legacy-package-tool"[\s\S]*reviewComponent \? <PackageToolWorkspace[\s\S]*<NotFound/);
  assert.match(shell, /reviewPageState\.scope === reviewScope \? reviewPageState\.pages : \[\]/);
  assert.match(shell, /<HostedPackageReview key=\{reviewScope\}/);
});

test("neutral managed workspaces reuse scoped publication without B2 content or Extras", async () => {
  const sources = await Promise.all([
    "src/apps/book-builder/hosted/HostedManagedComponentWorkspace.jsx",
    "src/apps/book-builder/hosted/HostedActivityWorkspace.jsx",
    "src/apps/book-builder/hosted/HostedHotspotBuilder.jsx",
    "src/apps/book-builder/hosted/activityBuilderNavigation.js",
  ].map(read));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /android-content-packs\/ultimate-b2|data\/ultimate-b2|HostedOpenResponseEditor|UnitExtrasEditor/);
  assert.match(source, /No activities yet/);
  assert.match(source, /empty document remains valid/);
  assert.match(sources[0], /tool === "pages"[\s\S]*tool === "hotspots"[\s\S]*tool === "activities"/);
  assert.match(sources[0], /tool === "publication"[\s\S]*HostedPublicationWorkspace bookSlug=\{bookSlug\} componentSlug=\{componentSlug\}/);
});

test("generic hosted Review routing round-trips strict token-free Viewer intents", () => {
  const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  const productReleaseId = "10000000-0000-4000-8000-000000000012";
  const intents = [
    { view: "library" },
    { view: "page", unitNumber: 1, pageId: "ub2-sb-unit-1-part-1" },
    { view: "activity", activityId: "ultimate-b2-sb-u1-p1-o8" },
    { view: "activity", activityId: "ultimate-b2-sb-u1-p1-o8", unitNumber: 1, pageId: "ub2-sb-unit-1-part-1" },
    { view: "page", unitNumber: 1, pageId: "ub2-sb-unit-1-part-1", productReleaseId },
  ];
  for (const intent of intents) {
    const hash = hostedBuilderReviewHash({ ...identity, intent });
    assert.deepEqual(parseHostedBuilderHash(hash), { kind: "review", ...identity, intent });
    assert.doesNotMatch(hash, /previewAuthorization|token|secret/i);
  }
  assert.equal(hostedBuilderReviewHash({ ...identity, intent: intents[1] }), "#/books/ultimate-b2/components/ultimate-b2-students-book/review?view=page&unitNumber=1&pageId=ub2-sb-unit-1-part-1");
});

test("generic hosted Review routing rejects malformed and over-scoped input", () => {
  const base = "#/books/ultimate-b2/components/ultimate-b2-students-book/review";
  const invalid = [
    `${base}`,
    `${base}?view=unknown`,
    `${base}?view=page&unitNumber=1`,
    `${base}?view=page&unitNumber=0&pageId=ub2-sb-unit-1-part-1`,
    `${base}?view=page&unitNumber=01&pageId=ub2-sb-unit-1-part-1`,
    `${base}?view=activity&activityId=javascript%3Aalert%281%29`,
    `${base}?view=activity&activityId=ultimate-b2-sb-u1-p1-o8&pageId=ub2-sb-unit-1-part-1`,
    `${base}?view=activity&activityId=ultimate-b2-sb-u1-p1-o8&unitNumber=1`,
    `${base}?view=library&view=page`,
    `${base}?view=library&unknown=value`,
    `${base}?view=library&previewAuthorization=secret`,
    `${base}?view=library&token=secret`,
    `${base}?view=library&releaseId=10000000-0000-4000-8000-000000000012`,
    `${base}?view=library&productReleaseId=latest`,
    `${base}?view=%E0%A4%A`,
    "#/books/%E0%A4%A/components/ultimate-b2-students-book/review?view=library",
  ];
  for (const hash of invalid) assert.deepEqual(parseHostedBuilderHash(hash), { kind: "not-found" }, hash);
  assert.throws(() => hostedBuilderReviewHash({ bookSlug: "ultimate-b2", componentSlug: "../secret", intent: { view: "library" } }), /identity is invalid/);
  assert.throws(() => hostedBuilderReviewHash({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", intent: { view: "activity", activityId: "valid-id", unitNumber: 1 } }), /incomplete/);
});

test("generic shell owns navigation while B2 imports stay inside the adapter boundary", async () => {
  const [shell, reviewPage, router, adapters, b2Workspace, entry, root] = await Promise.all([
    read("src/apps/book-builder/hosted/HostedBookBuilderApp.jsx"),
    read("src/apps/book-builder/hosted/HostedBuilderReviewPage.jsx"),
    read("src/apps/book-builder/hosted/hostedBuilderRouter.js"),
    read("src/apps/book-builder/hosted/hostedBuilderAdapters.jsx"),
    read("src/apps/ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx"),
    read("src/apps/book-builder/hosted/hostedBuilderEntry.jsx"),
    read("src/apps/book-builder/hosted/HostedAuthenticatedBookBuilderApp.jsx"),
  ]);
  assert.doesNotMatch(shell, /ultimate-b2|UltimateB2|StudentsBookActivity|runtime-hotspots|TeacherOffline/i);
  assert.doesNotMatch(reviewPage, /ultimate-b2|UltimateB2|TeacherOffline|android-teacher-offline|postMessage|localStorage|sessionStorage/i);
  assert.match(reviewPage, /HostedViewerPreview/);
  assert.match(adapters, /UltimateB2StudentsBookHostedWorkspace/);
  assert.doesNotMatch(b2Workspace, /NormalizedStudentsBookActivity|ACTIVITY_MODES/);
  assert.match(b2Workspace, /HostedUltimateB2HotspotBuilder/);
  assert.doesNotMatch(b2Workspace, /UnifiedBuilderReview|externalLauncher|reviewAction/);
  assert.doesNotMatch(b2Workspace, /TeacherOfflineLibrary|ClassroomToolsProvider|teacherBookMenuSkins|hostedReviewUiAssets|android-teacher-offline/);
  assert.match(adapters, /HostedTeacherUiController/);
  assert.match(adapters, /HostedSoundController/);
  assert.doesNotMatch(b2Workspace, /window\.location\.hash|history\.replaceState/);
  assert.match(router, /hashchange/);
  assert.match(entry, /HostedAuthenticatedBookBuilderApp/);
  assert.doesNotMatch(entry, /virtual:book-builder-app|Teacher|Listening|MultipleChoice|activityBuilderEntry/);
  assert.match(root, /<BuilderAuthGate>/);
  assert.match(root, /lazy\(\(\) => import\("\.\/HostedBookBuilderApp\.jsx"\)\)/);
});

test("disabled component routes render unavailable state and cannot resolve the Students Book adapter", async () => {
  const [shell, adapters] = await Promise.all([
    read("src/apps/book-builder/hosted/HostedBookBuilderApp.jsx"),
    read("src/apps/book-builder/hosted/hostedBuilderAdapters.jsx"),
  ]);
  assert.match(shell, /if \(!adapter\) return <UnavailableComponent/);
  assert.match(shell, /Authoring adapter pending/);
  assert.match(adapters, /if \(!component\?\.adapterId\) return null/);
  assert.match(adapters, /adapter\.bookSlug !== book\?\.slug/);
  assert.match(adapters, /adapter\.componentSlug !== component\.slug/);
});

test("hosted shell exposes only narrow content persistence and local authoring routes stay outside it", async () => {
  const hostedSources = await Promise.all([
    "src/apps/book-builder/hosted/HostedBookBuilderApp.jsx",
    "src/apps/book-builder/hosted/hostedBuilderCatalog.js",
    "src/apps/book-builder/hosted/hostedBuilderRouter.js",
    "src/apps/book-builder/hosted/hostedBuilderAdapters.jsx",
    "src/apps/ultimate-b2-builder/HostedUltimateB2BuilderApp.jsx",
  ].map(read));
  const source = hostedSources.join("\n");
  assert.doesNotMatch(source, /__hhplms|writeFile|FormData|repositoryFileTarget|write-capability/i);
  assert.doesNotMatch(source, /(?:\.\.\/)+(?:lms|components\/teacher|components\/student)|SoundContext|TeacherDashboard|StudentDashboard/);
  const local = await read("src/apps/ultimate-b2-builder/UltimateB2BuilderApp.jsx");
  assert.match(local, /__hhplms\/ultimate-b2-publisher-activities/);
});
