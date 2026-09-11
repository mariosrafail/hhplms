import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "./_vite-test-server.mjs";
import { resolveTeacherEditionAvailability, teacherEditionAvailability } from "../src/config/teacherEditionAvailability.js";

test("Teacher navigation executes enabled config callbacks and rejects config/runtime-disabled callbacks", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { default: Navigation } = await vite.ssrLoadModule("/src/apps/android-teacher-offline/TeacherBookNavigationCore.jsx");
    for (const book of ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]) {
      for (const configEnabled of [false, true]) {
        for (const runtimeUnavailable of [false, true]) {
          const configuration = { ...teacherEditionAvailability, [book]: { ...teacherEditionAvailability[book], "grammar-book": configEnabled } };
          const state = resolveTeacherEditionAvailability(book, runtimeUnavailable ? { "grammar-book": "Historical release does not include Grammar Book." } : {}, configuration)["grammar-book"];
          const calls = [];
          const tree = Navigation({
            renderIcon: () => null,
            bookSwitches: [{ id: "grammar-book", label: "Grammar Book" }],
            selectedBookId: "grammar-book",
            unavailableBookIds: new Set(state.enabled ? [] : ["grammar-book"]),
            unavailableBookMessages: new Map([["grammar-book", state.message]]),
            unavailableBookLabels: new Map([["grammar-book", state.ariaLabel]]),
            onBookSwitch: (id) => calls.push(id),
          });
          const button = tree.props.children.flat(Infinity).find((element) => element?.props?.["data-book-id"] === "grammar-book");
          assert.ok(button, "disabled editions remain rendered");
          assert.equal(button.props.disabled, !state.enabled);
          assert.equal(button.props["aria-current"], state.enabled ? "page" : undefined);
          button.props.onClick();
          assert.deepEqual(calls, state.enabled ? ["grammar-book"] : [], "even a direct callback invocation cannot bypass disabled navigation");
          if (runtimeUnavailable) {
            assert.equal(button.props.title, "Historical release does not include Grammar Book.");
            assert.equal(button.props["aria-label"], "Grammar Book unavailable in this release");
          }
        }
      }
    }
  } finally { await vite.close(); }
});
