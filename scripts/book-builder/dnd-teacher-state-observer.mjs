// Read-only observation in the component fixture only. No product hook, state
// setter, event substitution or altered presentation callback is introduced.
export function dndTeacherStateObserver() {
  return { name: 'dnd-teacher-state-observer', enforce: 'pre', transform(source, id) {
    const path = id.replaceAll('\\', '/');
    if (path.endsWith('/native-drag-drop/NativeDragDropTeacherSurface.jsx')) {
      const anchor = 'presentation?.onStateChange?.(';
      if (source.split(anchor).length !== 2) throw new Error('Unique DnD presentation reporter required');
      return { code: source.replace(anchor, '((state) => { globalThis.dndTeacherProbe.reports.push(structuredClone({ state, responses })); globalThis.dndTeacherProbe.child = state; presentation?.onStateChange?.(state); })('), map: null };
    }
    if (path.endsWith('/native-drag-drop/NativeDragDropSurface.jsx')) {
      const anchor = 'const fontState = useNativeActivityFonts(document, assetUrl);';
      if (source.split(anchor).length !== 2) throw new Error('Unique DnD renderer observation point required');
      return { code: source.replace(anchor, `useEffect(() => {
        globalThis.dndTeacherProbe.responses = structuredClone(responses);
        globalThis.dndTeacherProbe.controlled = controlled !== null;
      }, [responses, controlled]);
      ${anchor}`), map: null };
    }
    return null;
  } };
}
