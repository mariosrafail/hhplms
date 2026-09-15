// Input is URL.pathname, without origin, query, headers or credentials.
// Delimited legacy names are meaningful; substrings inside build hashes are not.
export function forbiddenLegacyRequestReason(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return 'invalid-pathname';
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return 'malformed-path-encoding'; }
  // Do not let a second decoder reinterpret a still-encoded route token.
  if (/%[0-9a-f]{2}/i.test(decoded)) return 'ambiguous-path-encoding';
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return 'invalid-pathname';
  const segments = decoded.toLowerCase().split(/[\/\\]/).filter(Boolean);
  const tokens = segments.flatMap(segment => segment.split(/[._-]/));
  if (tokens.includes('xml')) return 'legacy-xml-path';
  if (tokens.includes('iwb')) return 'legacy-iwb-path';
  if (segments.some((segment, index) => segment === 'prepare' && /(?:^|[._-])import$/.test(segments[index - 1] || ''))) return 'legacy-import-prepare-route';
  return null;
}
