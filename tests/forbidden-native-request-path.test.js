import assert from 'node:assert/strict';
import test from 'node:test';
import { forbiddenLegacyRequestReason } from '../scripts/book-builder/forbidden-native-request-path.mjs';

test('ordinary assets and opaque hash substrings remain allowed', () => {
  for (const pathname of ['/assets/use-reduced-motion-Biwb6Hvn.js', '/assets/index-xmlabc123.js', '/assets/someiwbhash.js', '/assets/index.js', '/assets/main.css', '/assets/page.png', '/assets/import-preparation-hash.js', '/builder/api/open-response-import/status/activity-one']) {
    assert.equal(forbiddenLegacyRequestReason(pathname), null, pathname);
  }
});

test('XML filenames and delimited source tokens are forbidden even under assets', () => {
  for (const pathname of ['/legacy/obj_params.xml', '/legacy/OBJ_PARAMS.XML', '/legacy/XML/source', '/source/xml/file', '/source/iwb_xml_decoder/file', '/legacy/IWB_XML_Decoder/file', '/assets/source-xml-data.js', '/assets/source.xml.data']) {
    assert.equal(forbiddenLegacyRequestReason(pathname), 'legacy-xml-path', pathname);
  }
});

test('IWB components and dot, underscore or hyphen tokens are forbidden', () => {
  for (const pathname of ['/legacy/iwb/source', '/legacy/IWB/source', '/legacy/foo-iwb-bar', '/legacy/foo_IWB_bar', '/assets/file.iwb']) {
    assert.equal(forbiddenLegacyRequestReason(pathname), 'legacy-iwb-path', pathname);
  }
});

test('canonical and compatibility import prepare routes are forbidden', () => {
  for (const pathname of ['/builder/api/import/prepare', '/builder/api/open-response-import/prepare', '/BUILDER/API/OPEN-RESPONSE-IMPORT/PREPARE/', '/builder/api/source_import/prepare', '/builder/api/source.import/prepare', '/.netlify/functions/builder-open-response-import/prepare']) {
    assert.equal(forbiddenLegacyRequestReason(pathname), 'legacy-import-prepare-route', pathname);
  }
});

test('encoded semantic names and path separators retain their reasons', () => {
  for (const [pathname, reason] of [['/legacy/%78%6d%6c/source', 'legacy-xml-path'], ['/legacy/file%2EXML', 'legacy-xml-path'], ['/legacy/%49%57%42/source', 'legacy-iwb-path'], ['/builder/api/open-response%2dimport%2fprepare', 'legacy-import-prepare-route'], ['/builder/api/import%5cprepare', 'legacy-import-prepare-route'], ['/assets/index%2dxmlabc123.js', null]]) {
    assert.equal(forbiddenLegacyRequestReason(pathname), reason, pathname);
  }
});

test('malformed, nested and invalid pathname inputs fail closed', () => {
  for (const pathname of ['/legacy/%', '/legacy/%ZZ', '/legacy/%E0%A4%A']) assert.equal(forbiddenLegacyRequestReason(pathname), 'malformed-path-encoding', pathname);
  assert.equal(forbiddenLegacyRequestReason('/legacy/%2578ml/source'), 'ambiguous-path-encoding');
  for (const pathname of [null, '', 'legacy/xml', '/assets/file%00.js']) assert.equal(forbiddenLegacyRequestReason(pathname), 'invalid-pathname');
});
