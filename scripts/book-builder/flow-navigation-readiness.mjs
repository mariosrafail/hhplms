// Pre-release navigation only: deliberately does not require font/image/fit completion.
export function flowNavigationReadinessIssues(snapshot, { openBeforeLoad, expectedSlots }) {
  const issues = [];
  if (snapshot.sameInstance !== true) issues.push('mounted-instance');
  if (snapshot.barrierClosed !== true) issues.push('asset-barrier');
  const requests = snapshot.requests || [];
  if (requests.length !== expectedSlots.length ||
      requests.some(request => request.state !== 'held') ||
      [...requests.map(request => request.slot)].sort().join('|') !== [...expectedSlots].sort().join('|')) issues.push('held-requests');
  if (snapshot.fontStatus !== 'loading' || snapshot.fontSetStatus !== 'loading') issues.push('font-loading');
  if (openBeforeLoad) {
    if (snapshot.panelHidden !== false || snapshot.panelVisible !== true) issues.push('panel-visible');
    if (!['width', 'height', 'clientWidth', 'clientHeight'].every(key => snapshot.root?.[key] > 0)) issues.push('root-geometry');
    if (snapshot.panelIndex !== 1 || snapshot.panelCount !== 2) issues.push('presentation-state');
  } else if (snapshot.panelHidden !== true) issues.push('panel-hidden');
  return issues;
}
