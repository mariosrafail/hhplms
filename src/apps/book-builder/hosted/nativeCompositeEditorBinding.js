import { useEffect, useRef } from "react";

// Section editors retain their established local editing controls, but their
// documents come from the parent and only the parent may persist the pair.
export function compositeEditorContent(binding, remote, request, options) {
  if (!binding) return remote(request, options);
  const document = request.resource === "native-activity-public" ? binding.publicDocument : request.resource === "native-activity-teacher" ? binding.teacherDocument : null;
  if (!document || request.documentKey !== document.activityId) return Promise.reject(new Error("Invalid composite editor scope."));
  return Promise.resolve({ revision: 0, document: structuredClone(document) });
}

export function compositeEditorTabs(binding, tabs) {
  return binding ? tabs.filter((tab) => !["readable-text", "video", "supplemental-audio", "preview"].includes(tab.id)) : tabs;
}

export function useCompositeEditorBinding(binding, publicDocument, teacherDocument, dirty, busy, receivePublicDocument) {
  const callbacks = useRef(binding); callbacks.current = binding;
  const revision = useRef(binding?.backgroundRevision);
  useEffect(() => {
    if (revision.current !== binding?.backgroundRevision) {
      revision.current = binding?.backgroundRevision;
      receivePublicDocument?.(structuredClone(binding.publicDocument));
      return;
    }
    if (dirty && publicDocument && teacherDocument) callbacks.current?.onPairChange({ publicDocument, teacherDocument });
  }, [publicDocument, teacherDocument, dirty, binding?.backgroundRevision]);
  useEffect(() => {
    callbacks.current?.onBusyChange?.(Boolean(busy));
    return () => callbacks.current?.onBusyChange?.(false);
  }, [busy]);
}

export function loadNativeEditorDocuments(loadContent, loadFonts, scope, signal) {
  return Promise.all([
    ...["public", "teacher"].map((role) => loadContent({ ...scope, resource: `native-activity-${role}`, documentKey: scope.activityId }, { signal })),
    loadFonts({ bookSlug: scope.bookSlug, componentSlug: scope.componentSlug }, { signal }),
  ]);
}
