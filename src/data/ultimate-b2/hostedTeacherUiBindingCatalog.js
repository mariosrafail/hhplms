export const HOSTED_TEACHER_UI_SCHEMA_VERSION = "1.0";
export const HOSTED_TEACHER_UI_PACKAGE_ID = "ultimate-b2-students-book";
export const HOSTED_TEACHER_UI_TITLE_GROUP_ID = "title-animation";

const entry = (id, label, category, mediaFamily = "raster", atomicGroup = null) => Object.freeze({
  id,
  label,
  category,
  mediaFamily,
  atomicGroup,
});

const pairs = (prefix, items, category) => items.flatMap(({ id, label }) => [
  entry(`${prefix}.${id}.normal`, `${label} - normal`, category),
  entry(`${prefix}.${id}.active`, `${label} - active`, category),
]);

const units = Array.from({ length: 10 }, (_, index) => ({ id: String(index + 1), label: `Unit ${index + 1}` }));
const editions = [
  { id: "students-book", label: "Students Book" },
  { id: "workbook", label: "Workbook" },
  { id: "grammar-book", label: "Grammar Book" },
  { id: "extras", label: "Extras" },
];
const extras = [
  ["progress-checks", "Progress Checks"], ["reviews", "Reviews"], ["practice", "Practice"],
  ["videos", "Videos"], ["extra-videos", "Extra Videos"], ["word-lists", "Word Lists"],
  ["tests", "Tests"], ["games", "Games"], ["grammar-reference", "Grammar Reference"],
  ["irregular-verbs", "Irregular Verbs"], ["writing-bank", "Writing Bank"],
  ["speaking-bank", "Speaking Bank"], ["extra-tasks-for-early-finishers", "Extra Tasks for Early Finishers"],
  ["worksheets-for-videos", "Worksheets for Videos"],
].map(([id, label]) => ({ id, label }));
const toolbar = [
  ["mouse", "Mouse"], ["pencil", "Pencil"], ["marker", "Marker"], ["eraser", "Eraser"],
  ["clear", "Clear screen"], ["zoom", "Zoom"], ["hide", "Hide screen"], ["show", "Show screen"],
  ["undo", "Undo"], ["redo", "Redo"], ["text", "Text"], ["annotations", "Annotations"],
  ["url", "URL"], ["save", "Save"], ["load", "Load"], ["timer", "Timer"],
  ["score", "Scoreboard"], ["print", "Print"], ["keyboard", "On-screen keyboard"],
].map(([id, label]) => ({ id, label }));
const navigation = [
  ["back", "Back"], ["check", "Check"], ["home", "Home"], ["next", "Next"],
  ["previous", "Previous"], ["close", "Close"], ["minimize", "Minimize"], ["settings", "Settings"],
  ["video", "Video"], ["videoWorksheet", "Video Worksheet"], ["showText", "Show Text"], ["showTextPressed", "Show Text - pressed"],
  ["previousInternal", "Previous activity part"], ["previousInternalDisabled", "Previous activity part - disabled"],
  ["nextInternal", "Next activity part"], ["nextInternalDisabled", "Next activity part - disabled"],
];
const title = [
  entry("title.gaf", "Title animation GAF", "branding-title", "gaf", HOSTED_TEACHER_UI_TITLE_GROUP_ID),
  entry("title.sd.1", "Title SD atlas 1", "branding-title", "png", HOSTED_TEACHER_UI_TITLE_GROUP_ID),
  entry("title.sd.2", "Title SD atlas 2", "branding-title", "png", HOSTED_TEACHER_UI_TITLE_GROUP_ID),
  entry("title.hd.1", "Title HD atlas 1", "branding-title", "png", HOSTED_TEACHER_UI_TITLE_GROUP_ID),
  entry("title.hd.2", "Title HD atlas 2", "branding-title", "png", HOSTED_TEACHER_UI_TITLE_GROUP_ID),
];

export const HOSTED_EDITABLE_UI_BINDINGS = Object.freeze([
  entry("background.main", "Main classroom background", "shell-background"),
  entry("background.students-book-parts", "Students Book parts background", "shell-background"),
  entry("background.workbook-parts", "Workbook parts background", "shell-background"),
  entry("background.grammar-book-parts", "Grammar Book parts background", "shell-background"),
  entry("branding.publisher-logo", "Publisher logo", "branding-title"),
  ...title,
  ...navigation.map(([id, label]) => entry(`navigation.${id}`, label, "navigation-window")),
  entry("navibar.sb.active", "Students Book switch", "book-switch"),
  entry("navibar.gb.active", "Grammar Book switch", "book-switch"),
  entry("navibar.workbook.active", "Workbook switch", "book-switch"),
  ...["reload", "show.all", "show.next"].flatMap((id) => ["active", "pressed", "disabled"].map((state) => entry(
    `navibar.${id}.${state}`,
    `${id === "reload" ? "Reload" : id === "show.all" ? "Show All" : "Show Next"} - ${state}`,
    "navigation-reveal",
  ))),
  ...pairs("unit", units, "units"),
  ...pairs("edition", editions, "editions"),
  ...pairs("extras", extras, "extras"),
  ...pairs("toolbar", toolbar, "teacher-toolbar"),
  entry("control.activity-hotspot", "Activity hotspot", "supporting-ui"),
  entry("media-player.background", "Media player background", "supporting-ui"),
  ...["play", "pause", "stop"].flatMap((control) => ["Active", "Pressed"].map((state) => entry(
    `media-player.${control}${state}`,
    `Media player ${control} - ${state.toLowerCase()}`,
    "supporting-ui",
  ))),
  ...[["button", "Button"], ["correct", "Correct answer"], ["incorrect", "Incorrect answer"], ["page-turn", "Page turn"]]
    .map(([id, label]) => entry(`sound.${id}`, `${label} sound`, "sounds", "audio")),
]);

export const HOSTED_EDITABLE_UI_BINDINGS_BY_ID = Object.freeze(Object.fromEntries(
  HOSTED_EDITABLE_UI_BINDINGS.map((binding) => [binding.id, binding]),
));

export const HOSTED_TEACHER_UI_TITLE_BINDING_IDS = Object.freeze(
  title.map((binding) => binding.id),
);

export const HOSTED_TEACHER_UI_CATEGORY_LABELS = Object.freeze({
  "shell-background": "Shell / Background",
  "branding-title": "Branding / Title",
  "navigation-window": "Navigation / Window Controls",
  "book-switch": "Book Switch Controls",
  "navigation-reveal": "Classroom Presentation Controls",
  units: "Units",
  editions: "Editions",
  extras: "Extras Menu",
  "teacher-toolbar": "Teacher Toolbar",
  sounds: "Sounds",
  "supporting-ui": "Supporting UI",
});

export const HOSTED_TEACHER_UI_MEDIA_POLICIES = Object.freeze({
  raster: Object.freeze({ mediaTypes: Object.freeze(["image/png", "image/jpeg", "image/webp"]), extensions: Object.freeze(["png", "jpg", "webp"]), maximumBytes: 16 * 1024 * 1024 }),
  png: Object.freeze({ mediaTypes: Object.freeze(["image/png"]), extensions: Object.freeze(["png"]), maximumBytes: 16 * 1024 * 1024 }),
  audio: Object.freeze({ mediaTypes: Object.freeze(["audio/mpeg", "audio/wav"]), extensions: Object.freeze(["mp3", "wav"]), maximumBytes: 12 * 1024 * 1024 }),
  gaf: Object.freeze({ mediaTypes: Object.freeze(["application/x-gaf"]), extensions: Object.freeze(["gaf"]), maximumBytes: 8 * 1024 * 1024 }),
});

if (new Set(HOSTED_EDITABLE_UI_BINDINGS.map(({ id }) => id)).size !== HOSTED_EDITABLE_UI_BINDINGS.length) {
  throw new Error("Hosted Teacher UI binding IDs must be unique.");
}
