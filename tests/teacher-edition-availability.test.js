import assert from "node:assert/strict";
import test from "node:test";
import { teacherEditionAvailability, resolveTeacherEditionAvailability } from "../src/config/teacherEditionAvailability.js";
import { createTeacherEditionControls } from "../src/apps/android-teacher-offline/teacherEditionControls.js";

for (const book of ["ultimate-b1", "ultimate-b1-plus"]) {
  test(`${book} enables Students Book/Workbook and disables visible Grammar/Extras shell entries`, () => {
    const availability = resolveTeacherEditionAvailability(book);
    assert.deepEqual(Object.fromEntries(Object.entries(availability).map(([id, state]) => [id, state.enabled])), {
      "students-book": true, workbook: true, "grammar-book": false, extras: false,
    });
    assert.equal(availability["grammar-book"].message, "Grammar Book is currently disabled for this package.");
    assert.equal(availability.extras.message, "Extras are currently disabled for this package.");
    assert.ok(Object.isFrozen(teacherEditionAvailability[book]));
    assert.ok(Object.isFrozen(availability) && Object.values(availability).every(Object.isFrozen));
  });

  test(`${book} explicit configuration enables the synthetic available Grammar/Extras fixture`, () => {
    const enabled = { ...teacherEditionAvailability, [book]: { ...teacherEditionAvailability[book], "grammar-book": true, extras: true } };
    for (const id of ["grammar-book", "extras"]) {
      assert.deepEqual(resolveTeacherEditionAvailability(book, {}, enabled)[id], { enabled: true, message: "", ariaLabel: id === "extras" ? "Extras" : "Grammar Book" });
      const runtime = { [id]: "This edition is unavailable in the immutable release." };
      assert.deepEqual(resolveTeacherEditionAvailability(book, runtime, enabled)[id], { enabled: false, message: runtime[id], ariaLabel: `${id === "extras" ? "Extras" : "Grammar Book"} unavailable in this release` });
      assert.equal(resolveTeacherEditionAvailability(book, runtime)[id].message, runtime[id], "runtime message wins over configuration");
    }
    assert.equal(teacherEditionAvailability[book].extras, false, "synthetic input never mutates the repository defaults");
  });
}

test("B2 keeps all four shell editions enabled and preserves immutable member restrictions", () => {
  assert.ok(Object.values(resolveTeacherEditionAvailability("ultimate-b2")).every((state) => state.enabled));
  const state = resolveTeacherEditionAvailability("ultimate-b2", { workbook: "Workbook was not included in this release.", "grammar-book": undefined });
  assert.equal(state.workbook.enabled, false);
  assert.equal(state.workbook.message, "Workbook was not included in this release.");
  assert.equal(state["grammar-book"].enabled, false);
  assert.match(state["grammar-book"].message, /not included in this release/);
  assert.equal(state.extras.enabled, true);
});

test("unknown books/editions, inherited flags and non-boolean values fail closed", () => {
  for (const book of [undefined, null, "unknown", "__proto__", "constructor"]) assert.ok(Object.values(resolveTeacherEditionAvailability(book)).every((state) => !state.enabled));
  assert.equal(Object.hasOwn(resolveTeacherEditionAvailability("ultimate-b1"), "unknown"), false);
  const malformed = { "ultimate-b1": Object.assign(Object.create({ "grammar-book": true }), { extras: "true", workbook: 1 }) };
  assert.ok(Object.values(resolveTeacherEditionAvailability("ultimate-b1", {}, malformed)).every((state) => !state.enabled));
  assert.ok(Object.isFrozen(teacherEditionAvailability));
});

test("Teacher controls reject disabled editions and recheck the latest runtime state before selection", () => {
  const packageRuntimes = [{ key: "grammar", component: { teacherEditionId: "grammar-book" } }];
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2", undefined]) {
    let states = {};
    const messages = [];
    const controls = createTeacherEditionControls({ bookSlug, packageRuntimes, componentStates: states,
      readComponentStates: () => states, onUnavailable: (message) => messages.push(message) });
    for (const id of ["grammar-book", "extras"]) {
      assert.equal(controls.allowTeacherEdition(id), bookSlug === "ultimate-b2");
      assert.equal(controls.unavailableEditionIds.has(id), bookSlug !== "ultimate-b2");
    }
    assert.equal(controls.allowTeacherEdition("unknown"), false);
    states = { grammar: { status: "unavailable", message: "Grammar is absent from this immutable release." } };
    assert.equal(controls.allowTeacherEdition("grammar-book"), false, "even an existing callback checks the latest state");
    assert.equal(messages.at(-1), states.grammar.message, "runtime feedback wins over package configuration");
    const refreshed = createTeacherEditionControls({ bookSlug, packageRuntimes, componentStates: states,
      readComponentStates: () => states, onUnavailable: () => {} });
    assert.equal(refreshed.unavailableEditionMessages.get("grammar-book"), states.grammar.message);
    assert.equal(refreshed.unavailableEditionLabels.get("grammar-book"), "Grammar Book unavailable in this release");
  }
});
