import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCcw, RotateCcw, Trash2, Upload } from "lucide-react";

import { BuilderModal } from "./BuilderModal.jsx";
import { finalizeBuilderPage, getBuilderPages, mutateBuilderPage, prepareBuilderPage, uploadBuilderPage } from "./builderPagesApi.js";
import { componentPagesErrorPresentation } from "./componentPagesErrorPresentation.js";
import { componentPageLayoutPolicy, componentPageRowMaxWidth, printedPageWeight, splitUnitPageRows } from "./componentPageRows.js";
import { useBuilderReview } from "./HostedPackageReview.jsx";
import "./componentPagesWorkspace.css";

const mutationId = () => globalThis.crypto.randomUUID();
const fileType = (file) => file.type || (/\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg");
const editableUnit = (page, managed) => managed && page?.origin !== "canonical";
const metadataFor = (page, managed) => ({ label: page.label, printedLabel: page.printedLabel || "", sortOrder: page.sortOrder, ...(editableUnit(page, managed) ? { unitId: page.unitId || "" } : {}) });

function PageCard({ page, selected, managed, busy, onSelect, onReplace, onEdit, onMove, onDelete, onRestoreImage }) {
  return <article className="component-page-card" data-page-id={page.id} data-printed-label={page.printedLabel || ""} data-page-weight={printedPageWeight(page)} data-source={page.source} data-managed={managed || undefined} data-selected={selected || undefined}>
    <button className="component-page-image" type="button" onClick={onSelect} aria-label={`Preview ${page.label}`}><img src={page.image.url} alt="" loading="lazy" width={page.image.width} height={page.image.height} /></button>
    <div className="component-page-card-copy"><span>{page.printedLabel ? `Pages ${page.printedLabel}` : "Unnumbered"}</span><strong>{page.label}</strong><small>{page.image.width} × {page.image.height} · {(page.image.byteSize / 1024).toFixed(0)} KB</small></div>
    <div className="component-page-actions">
      {page.capabilities?.moveUp ? <button type="button" disabled={busy} onClick={() => onMove(-1)} title="Move earlier in this Unit"><ArrowUp aria-hidden="true" /></button> : null}
      {page.capabilities?.moveDown ? <button type="button" disabled={busy} onClick={() => onMove(1)} title="Move later in this Unit"><ArrowDown aria-hidden="true" /></button> : null}
      {page.capabilities?.editMetadata ? <button type="button" disabled={busy} onClick={onEdit} title="Edit metadata"><Pencil aria-hidden="true" /></button> : null}
      {page.capabilities?.replaceImage ? <label className="component-page-file-action" title="Replace page image"><Upload aria-hidden="true" /><span className="sr-only">Replace {page.label}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const [file] = event.target.files || []; if (file) onReplace(file); event.target.value = ""; }} /></label> : null}
      {page.capabilities?.restoreCanonicalImage ? <button type="button" disabled={busy} onClick={onRestoreImage} title="Restore canonical image"><RotateCcw aria-hidden="true" /></button> : null}
      {page.capabilities?.deletePage ? <button className="is-danger" type="button" disabled={busy} onClick={onDelete} title="Delete page"><Trash2 aria-hidden="true" /></button> : null}
    </div>
  </article>;
}

function PageGrid({ pages, row = "", layout, selected, managed, busy, onSelect, onReplace, onEdit, onMove, onDelete, onRestoreImage }) {
  const style = row ? {
    "--component-page-row-count": pages.length,
    "--component-page-row-max-width": `${componentPageRowMaxWidth(pages.length, layout)}px`,
  } : undefined;
  return <div className={`component-page-grid${row ? " component-page-row" : ""}`} data-page-row={row || undefined} style={style}>
    {pages.map((page) => <PageCard key={page.id} page={page} selected={page.id === selected?.id} managed={managed} busy={busy} onSelect={() => onSelect(page.id)} onReplace={(file) => onReplace(page, file)} onEdit={() => onEdit(page)} onMove={(direction) => onMove(page, direction)} onDelete={() => onDelete(page)} onRestoreImage={() => onRestoreImage(page)} />)}
  </div>;
}

function UnitPageRows(props) {
  const rows = splitUnitPageRows(props.pages);
  return <div className="component-page-rows">
    <PageGrid {...props} pages={rows.top} row="top" />
    {rows.bottom.length ? <PageGrid {...props} pages={rows.bottom} row="bottom" /> : null}
  </div>;
}

export function ComponentPagesWorkspace({ bookSlug, componentSlug, managed = false, title = "Students Book", onPageLibraryChange = () => {}, onSelectedPageChange = () => {} }) {
  const { registerToolContext } = useBuilderReview();
  const identity = useMemo(() => ({ bookSlug, componentSlug }), [bookSlug, componentSlug]);
  const layout = componentPageLayoutPolicy(componentSlug);
  const [state, setState] = useState({ loading: true, revision: 0, hotspotRevision: 0, component: null, units: [], pages: [], deletedPages: [], error: "", conflict: false });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [editor, setEditor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmPurge, setConfirmPurge] = useState(null);
  const pendingUnitId = useRef("");
  const addInput = useRef(null);

  const apply = (result) => {
    setState({ loading: false, revision: result.revision, hotspotRevision: result.hotspotRevision || 0, component: result.component, units: result.units || [], pages: result.pages, deletedPages: result.deletedPages || [], error: "", conflict: false });
    setSelectedId((current) => result.pages.some((page) => page.id === current) ? current : result.pages[0]?.id || "");
    globalThis.dispatchEvent?.(new CustomEvent("builder:pages-changed", { detail: { bookSlug, componentSlug } }));
  };
  const reload = async (signal) => { try { apply(await getBuilderPages(identity, { signal })); } catch (error) { if (error.name !== "AbortError") setState((current) => ({ ...current, loading: false, error: error.message || "Could not load pages." })); } };
  useEffect(() => { const controller = new AbortController(); reload(controller.signal); return () => controller.abort(); }, [identity]);
  useEffect(() => { onPageLibraryChange(state); }, [onPageLibraryChange, state]);
  useEffect(() => { onSelectedPageChange(selectedId); }, [onSelectedPageChange, selectedId]);
  useEffect(() => { registerToolContext("pages", { view: "page", pageId: selectedId, dirty: false, refreshKey: state.revision, release: null }); }, [registerToolContext, selectedId, state.revision]);

  const uploadOne = async ({ file, mode, pageId = "", metadata, expectedRevision }) => {
    const normalizedFile = file.type ? file : new File([file], file.name, { type: fileType(file) });
    const clientMutationId = mutationId();
    const prepared = await prepareBuilderPage(identity, { mode, pageId, expectedRevision, clientMutationId, metadata, file: normalizedFile });
    await uploadBuilderPage(normalizedFile, prepared.authorization, setProgress);
    return finalizeBuilderPage(identity, { uploadId: prepared.uploadId, expectedRevision, clientMutationId });
  };
  const run = async (operation) => {
    setBusy(true); setProgress(0); setState((current) => ({ ...current, error: "" }));
    try { const result = await operation(); if (result?.pages) apply(result); }
    catch (error) { const presentation = componentPagesErrorPresentation(error); setState((current) => ({ ...current, error: presentation.message, conflict: presentation.conflict })); }
    finally { setBusy(false); setProgress(0); }
  };
  const replace = (page, file) => run(() => uploadOne({ file, mode: "replace", pageId: page.id, metadata: metadataFor(page, managed), expectedRevision: state.revision }));
  const add = (files, unitId) => run(async () => {
    let result = { ...state };
    for (const [index, file] of [...files].entries()) {
      const unitPages = result.pages.filter((page) => page.unitId === unitId);
      result = await uploadOne({ file, mode: "create", metadata: { label: file.name.replace(/\.[^.]+$/, ""), printedLabel: "", sortOrder: Math.max(0, ...unitPages.map((page) => page.sortOrder)) + 10 + index, unitId }, expectedRevision: result.revision });
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }
    return result;
  });
  const mutate = (page, action, metadata = {}) => run(() => mutateBuilderPage(identity, page.id, action, { expectedRevision: state.revision, ...(action === "delete" ? { expectedHotspotRevision: state.hotspotRevision } : {}), clientMutationId: mutationId(), metadata }));
  const move = (page, direction) => {
    const ordered = state.pages.filter((item) => managed ? item.unitId === page.unitId : item.unitNumber === page.unitNumber).sort((left, right) => left.sortOrder - right.sortOrder);
    const index = ordered.findIndex((item) => item.id === page.id);
    const other = ordered[index + direction];
    if (other) mutate(page, "reorder", { ...metadataFor(page, managed), sortOrder: other.sortOrder + (direction < 0 ? -1 : 1) });
  };
  const openAdd = (unitId) => { pendingUnitId.current = unitId; addInput.current?.click(); };
  const selected = state.pages.find((page) => page.id === selectedId) || state.pages[0];
  const groups = managed
    ? [...state.units.map((unit) => ({ ...unit, pages: state.pages.filter((page) => page.unitId === unit.id) })), { id: "unassigned", title: "Unassigned", pages: state.pages.filter((page) => !page.unitId) }]
    : [...new Set(state.pages.map((page) => page.unitNumber))].map((unitNumber) => ({ id: `unit-${unitNumber}`, title: `Unit ${unitNumber}`, pages: state.pages.filter((page) => page.unitNumber === unitNumber) }));

  return <main className="component-pages-workspace" data-component-pages={componentSlug} style={{ "--component-page-image-height": `${layout.imageHeight}px`, "--component-page-grid-gap": `${layout.gap}px` }}>
    <header className="component-pages-header"><div><span>{title} · Pages</span><h1>Page library</h1><p>{managed ? `Upload, assign, label, order, replace, and safely remove ${title} pages.` : "Review canonical Students Book pages, replace their raster safely, or restore deleted pages and canonical images."}</p></div><div><button type="button" disabled={busy} onClick={() => reload()}><RefreshCcw aria-hidden="true" /> Refresh</button><input ref={addInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { if (event.target.files?.length && pendingUnitId.current) add(event.target.files, pendingUnitId.current); event.target.value = ""; pendingUnitId.current = ""; }} /></div></header>
    {busy ? <div className="component-pages-progress" role="status"><span style={{ width: `${progress}%` }} /> Processing page assets… {progress ? `${progress}%` : ""}</div> : null}
    {state.error ? <p className="builder-inline-error component-pages-error" role="alert">{state.error}{state.conflict ? <> The library changed elsewhere. Your view was preserved. <button type="button" onClick={() => reload()}>Reload latest</button></> : null}</p> : null}
    {state.loading ? <p className="component-pages-empty" role="status">Loading page library…</p> : <div className="component-pages-layout">
      <div className="component-pages-groups">{groups.map((group) => <section key={group.id} data-page-unit={group.id === "unassigned" ? undefined : group.id}><h2>{group.title}<span>{group.pages.length}</span>{managed && group.id !== "unassigned" ? <button className="hosted-builder-action" type="button" disabled={busy} onClick={() => openAdd(group.id)}><Plus aria-hidden="true" /> Add pages</button> : null}</h2>{group.pages.length ? group.id === "unassigned" ? <PageGrid pages={group.pages} layout={layout} selected={selected} managed={managed} busy={busy} onSelect={setSelectedId} onReplace={replace} onEdit={(page) => setEditor({ page, ...metadataFor(page, managed) })} onMove={move} onDelete={setConfirmDelete} onRestoreImage={(page) => mutate(page, "restore-image")} /> : <UnitPageRows pages={group.pages} layout={layout} selected={selected} managed={managed} busy={busy} onSelect={setSelectedId} onReplace={replace} onEdit={(page) => setEditor({ page, ...metadataFor(page, managed) })} onMove={move} onDelete={setConfirmDelete} onRestoreImage={(page) => mutate(page, "restore-image")} /> : <p className="component-pages-empty">{group.id === "unassigned" ? "No legacy pages are awaiting assignment." : `No pages in ${group.title} yet.`}</p>}</section>)}</div>
      {selected ? <aside className="component-page-inspector"><span>Selected page</span><h2>{selected.label}</h2><div className="component-page-preview"><img src={selected.image.url} alt={`${selected.label} preview`} width={selected.image.width} height={selected.image.height} /></div><dl><div><dt>Page ID</dt><dd><code>{selected.id}</code></dd></div>{managed ? <div><dt>Unit</dt><dd>{selected.unitTitle || "Unassigned"}</dd></div> : null}<div><dt>Printed pages</dt><dd>{selected.printedLabel || "Not set"}</dd></div><div><dt>Source</dt><dd>{selected.source === "repository-baseline" ? "Canonical baseline" : selected.source === "override" ? "Managed replacement" : "Managed upload"}</dd></div><div><dt>Dimensions</dt><dd>{selected.image.width} × {selected.image.height}</dd></div><div><dt>SHA-256</dt><dd><code>{selected.image.checksumSha256.slice(0, 16)}…</code></dd></div></dl></aside> : null}
    </div>}
    {!state.loading && state.deletedPages.length ? <details className="component-deleted-pages"><summary>Deleted pages <span>{state.deletedPages.length}</span></summary><div>{state.deletedPages.map((page) => <article key={page.id}><div><strong>{page.label}</strong><code>{page.id}</code><small>{page.printedLabel || "Unnumbered"} · {page.removedHotspotCount || 0} hotspots removed · {page.preservedActivityCount || 0} activities preserved</small></div>{page.canRestore ? <button type="button" disabled={busy} onClick={() => mutate(page, "restore")}><RotateCcw aria-hidden="true" /> Restore page</button> : null}{page.canDeleteCompletely ? <button className="builder-danger-action" type="button" disabled={busy} onClick={() => setConfirmPurge(page)}><Trash2 aria-hidden="true" /> Delete completely</button> : null}</article>)}</div></details> : null}
    <BuilderModal open={Boolean(editor)} title="Edit page metadata" description="Update the Unit, editorial label, and printed-page reference." onClose={() => setEditor(null)}><form className="component-page-editor" onSubmit={(event) => { event.preventDefault(); const page = editor.page; const metadata = { label: editor.label.trim(), printedLabel: editor.printedLabel.trim(), sortOrder: !editableUnit(page, managed) || editor.unitId === page.unitId ? editor.sortOrder : Math.max(0, ...state.pages.filter((item) => item.unitId === editor.unitId).map((item) => item.sortOrder)) + 10, ...(editableUnit(page, managed) ? { unitId: editor.unitId } : {}) }; setEditor(null); mutate(page, "metadata", metadata); }}>
      {editableUnit(editor?.page, managed) ? <label><span>Unit</span><select required value={editor?.unitId || ""} onChange={(event) => setEditor((current) => ({ ...current, unitId: event.target.value }))}><option value="" disabled>Select Unit</option>{state.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label> : null}
      <label><span>Label</span><input autoFocus={!managed} required maxLength={160} value={editor?.label || ""} onChange={(event) => setEditor((current) => ({ ...current, label: event.target.value }))} /></label><label><span>Printed page or spread</span><input maxLength={40} value={editor?.printedLabel || ""} onChange={(event) => setEditor((current) => ({ ...current, printedLabel: event.target.value }))} /></label><footer><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="hosted-builder-action" type="submit" disabled={editableUnit(editor?.page, managed) && !editor?.unitId}>Save metadata</button></footer></form></BuilderModal>
    <BuilderModal open={Boolean(confirmDelete)} title={`Delete ${title} page?`} description="The page will become inactive and its launch hotspots will be removed. Activities and their assets will be preserved." onClose={() => setConfirmDelete(null)}><div className="component-page-delete"><p><strong>{confirmDelete?.label}</strong></p><p>Restoring the page later will not recreate its hotspots.</p><div><button type="button" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="builder-danger-action" type="button" onClick={() => { const page = confirmDelete; setConfirmDelete(null); mutate(page, "delete"); }}>Delete page</button></div></div></BuilderModal>
    <BuilderModal open={Boolean(confirmPurge)} title={`Delete ${title} page completely?`} description="This page cannot be restored after this action." busy={busy} onClose={() => setConfirmPurge(null)}><div className="component-page-delete"><p><strong>{confirmPurge?.label}</strong></p><p>Hotspots are already removed. Activities will remain Unassigned, and historical releases are unaffected.</p><div><button type="button" disabled={busy} onClick={() => setConfirmPurge(null)}>Cancel</button><button className="builder-danger-action" type="button" disabled={busy} onClick={() => { const page = confirmPurge; setConfirmPurge(null); mutate(page, "purge"); }}>Delete completely</button></div></div></BuilderModal>
  </main>;
}

export default ComponentPagesWorkspace;
