// Teacher shell navigation policy, independent of LMS visibility and release contracts.
// Enabling a flag requires a normal code change/deployment; runtime restrictions still win.
export const teacherEditionAvailability = Object.freeze({
  "ultimate-b1": Object.freeze({ "students-book": true, workbook: true, "grammar-book": false, extras: false }),
  "ultimate-b1-plus": Object.freeze({ "students-book": true, workbook: true, "grammar-book": false, extras: false }),
  "ultimate-b2": Object.freeze({ "students-book": true, workbook: true, "grammar-book": true, extras: true }),
});

const editionLabels = Object.freeze({ "students-book": "Students Book", workbook: "Workbook", "grammar-book": "Grammar Book", extras: "Extras" });

export function resolveTeacherEditionAvailability(bookSlug, runtimeUnavailable = {}, configuration = teacherEditionAvailability) {
  const flags = Object.hasOwn(configuration, bookSlug) ? configuration[bookSlug] : null;
  return Object.freeze(Object.fromEntries(Object.entries(editionLabels).map(([id, label]) => {
    const runtimeDisabled = Object.hasOwn(runtimeUnavailable, id);
    const configuredEnabled = flags != null && Object.hasOwn(flags, id) && flags[id] === true;
    const message = runtimeDisabled
      ? runtimeUnavailable[id] || `${label} was not included in this release.`
      : configuredEnabled ? "" : `${label} ${id === "extras" ? "are" : "is"} currently disabled for this package.`;
    return [id, Object.freeze({ enabled: configuredEnabled && !runtimeDisabled, message,
      ariaLabel: runtimeDisabled ? `${label} unavailable in this release` : message || label })];
  })));
}
