import { useId, useRef } from "react";
import { Check, Minus, Scan, ZoomIn, ZoomOut } from "lucide-react";

export function StudioButton({ variant = "secondary", selected = false, reason = "", className = "", children, ...props }) {
  const title = props.disabled && reason ? reason : props.title;
  return <button {...props} title={title} className={`studio-button studio-button--${variant} ${className}`.trim()} aria-pressed={selected || undefined}>{children}</button>;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function StudioTabs({ id, value, onChange, tabs, label, sticky = true }) {
  const refs = useRef([]);
  const generatedId = useId();
  const tabsId = safeId(id || `studio-tabs-${generatedId}`);
  const activate = (index) => { const tab = tabs[index]; if (!tab) return; onChange(tab.id); refs.current[index]?.focus(); };
  return <div id={tabsId} className={`studio-tabs ${sticky ? "is-sticky" : ""}`.trim()} role="tablist" aria-label={label} onKeyDown={(event) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    if (event.key === "ArrowRight") { event.preventDefault(); activate((index + 1) % tabs.length); }
    if (event.key === "ArrowLeft") { event.preventDefault(); activate((index - 1 + tabs.length) % tabs.length); }
    if (event.key === "Home") { event.preventDefault(); activate(0); }
    if (event.key === "End") { event.preventDefault(); activate(tabs.length - 1); }
  }}>
    {tabs.map((tab, index) => <button key={tab.id} id={`${tabsId}-${safeId(tab.id)}-tab`} aria-controls={`${tabsId}-${safeId(tab.id)}-panel`} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>{tab.icon ? <tab.icon aria-hidden="true" /> : null}<span>{tab.label}</span></button>)}
  </div>;
}

export function StudioTabPanel({ tabsId, tabId, className = "", children }) {
  const base = safeId(tabsId);
  const tab = safeId(tabId);
  return <div id={`${base}-${tab}-panel`} className={`studio-tab-panel ${className}`.trim()} role="tabpanel" aria-labelledby={`${base}-${tab}-tab`} tabIndex={0}>{children}</div>;
}

export function StudioTabWorkspace({ id, value, onChange, tabs, label, className = "", embedded = false, children }) {
  if (embedded) return <div className={className} data-active-tab={value}>{children}</div>;
  return <div className={`studio-tab-workspace ${className}`.trim()} data-active-tab={value}>
    <StudioTabs id={id} value={value} onChange={onChange} tabs={tabs} label={label} />
    <StudioTabPanel tabsId={id} tabId={value}>{children}</StudioTabPanel>
  </div>;
}

export function StudioCanvasToolbar({ zoom, onZoomChange, snap = true, onSnapChange, children = null }) {
  return <div className={`studio-canvas-toolbar ${children ? "has-contextual-controls" : ""}`.trim()} role="toolbar" aria-label="Canvas controls">
    <div className="studio-canvas-zoom-controls">
      <StudioButton variant="ghost" aria-label="Zoom out" onClick={() => onZoomChange(Math.max(.5, zoom - .1))}><ZoomOut aria-hidden="true" /></StudioButton>
      <output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
      <StudioButton variant="ghost" aria-label="Zoom in" onClick={() => onZoomChange(Math.min(2, zoom + .1))}><ZoomIn aria-hidden="true" /></StudioButton>
      <StudioButton variant="ghost" onClick={() => onZoomChange(1)}><Scan aria-hidden="true" /> Fit</StudioButton>
      {onSnapChange ? <StudioButton variant="ghost" selected={snap} onClick={() => onSnapChange(!snap)}>{snap ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />} Snap</StudioButton> : null}
    </div>
    {children}
  </div>;
}

export function StudioField({ label, hint, className = "", children }) {
  return <label className={`studio-field ${className}`.trim()}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

export function StudioStatus({ dirty, saving, message }) {
  return <span className="studio-save-status" data-state={saving ? "saving" : dirty ? "dirty" : "saved"} role="status"><span aria-hidden="true" />{saving ? "Saving…" : dirty ? "Unsaved changes" : message}</span>;
}

export function StudioReadiness({ ready, issues = [], readyMessage = "Ready to save" }) {
  const uniqueIssues = [...new Set(issues.filter(Boolean))];
  return <details className="studio-readiness" data-ready={ready || undefined}>
    <summary><span aria-hidden="true" />{ready ? readyMessage : `${uniqueIssues.length} issue${uniqueIssues.length === 1 ? "" : "s"}`}</summary>
    {uniqueIssues.length ? <ul>{uniqueIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p>Content and accessibility checks pass.</p>}
  </details>;
}

export function StudioSaveBar({ hidden = false, dirty, saving, message, ready, issues = [], disabled, reason = "", onSave }) {
  if (hidden) return null;
  return <footer className="studio-save-bar" data-studio-save-cluster="true">
    <StudioReadiness ready={ready} issues={issues} />
    <div className="studio-save-actions">
      <StudioStatus dirty={dirty} saving={saving} message={message} />
      <StudioButton variant="primary" disabled={disabled} reason={reason} onClick={onSave}>{saving ? "Saving…" : "Save Draft"}</StudioButton>
    </div>
  </footer>;
}
