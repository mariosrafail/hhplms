import { studentsBookCurrentNativeActivityAdapter } from "./_students-book-native-activity-adapter.js";
import { listBuilderServerComponents } from "./_builder-component-registry.js";
import { createManagedNativeActivityAdapter } from "./_managed-native-activity-adapter.js";

const adapters = Object.freeze({
  "ultimate-b2/ultimate-b2-students-book": studentsBookCurrentNativeActivityAdapter,
  ...Object.fromEntries(listBuilderServerComponents()
    .filter((registration) => registration.mode === "managed")
    .map((registration) => [
      `${registration.bookSlug}/${registration.componentSlug}`,
      createManagedNativeActivityAdapter(registration),
    ])),
});

export function resolveNativeActivityAdapter(bookSlug, componentSlug) {
  return adapters[`${bookSlug}/${componentSlug}`] || null;
}

export const nativeActivityAdapters = adapters;
