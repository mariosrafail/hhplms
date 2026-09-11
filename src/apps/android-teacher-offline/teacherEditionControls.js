import { resolveTeacherEditionAvailability } from "../../config/teacherEditionAvailability.js";

// Adapt the package policy to React controls while checking fresh runtime state on every attempt.
export function createTeacherEditionControls({ bookSlug, packageRuntimes, componentStates, readComponentStates, onUnavailable }) {
  const resolve = (states) => resolveTeacherEditionAvailability(bookSlug, Object.fromEntries(packageRuntimes
    .filter((runtime) => states[runtime.key]?.status === "unavailable")
    .map((runtime) => [runtime.component.teacherEditionId, states[runtime.key].message])));
  const unavailable = Object.entries(resolve(componentStates)).filter(([, state]) => !state.enabled);
  return {
    unavailableEditionIds: new Set(unavailable.map(([id]) => id)),
    unavailableEditionMessages: new Map(unavailable.map(([id, state]) => [id, state.message])),
    unavailableEditionLabels: new Map(unavailable.map(([id, state]) => [id, state.ariaLabel])),
    allowTeacherEdition(editionId) {
      const availability = resolve(readComponentStates())[editionId];
      if (availability?.enabled === true) return true;
      onUnavailable(availability?.message || "The requested edition is unavailable.");
      return false;
    },
  };
}
