import { builderDocumentSha256 } from "./_builder-content-security.js";

async function rowDocument(row, resource, sql) {
  if (!row) return null;
  const checksum = builderDocumentSha256(row.payload);
  if (checksum !== row.payload_sha256) throw new Error("Stored Builder document checksum is invalid");
  if (row.schema_version !== resource.schemaVersion) throw new Error("Stored Builder document schema is unsupported");
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Stored Builder document revision is invalid");
  const document = resource.validate(row.payload);
  if (resource.validateReadContext) await resource.validateReadContext({ document, sql });
  return { revision, source: "database", document };
}
export async function loadBuilderComponentDocument(sql, resource) {
  const rows = await sql`
    select document.schema_version, document.revision, document.payload, document.payload_sha256
    from builder_component_documents document
    join book_components component on component.id=document.book_component_id
      and component.book_package_id=document.book_package_id
    join book_packages package on package.id=document.book_package_id
    where package.slug=${resource.bookSlug}
      and component.slug=${resource.componentSlug}
      and document.document_type=${resource.documentType}
      and document.document_key=${resource.documentKey}
    limit 1
  `;
  return rowDocument(rows[0], resource, sql);
}

export async function loadBuilderComponentDocuments(sql, resources) {
  if (!Array.isArray(resources)) throw new Error("Builder document batch must be an array");
  if (!resources.length) return new Map();
  const [scope] = resources;
  const byKey = new Map();
  for (const resource of resources) {
    if (resource.bookSlug !== scope.bookSlug || resource.componentSlug !== scope.componentSlug || resource.documentType !== scope.documentType) {
      throw new Error("Builder document batch must use one component and document type");
    }
    if (byKey.has(resource.documentKey)) throw new Error("Builder document batch contains a duplicate key");
    byKey.set(resource.documentKey, resource);
  }
  const documentKeys = [...byKey.keys()];
  const rows = await sql`
    select document.document_key, document.schema_version, document.revision, document.payload, document.payload_sha256
    from builder_component_documents document
    join book_components component on component.id=document.book_component_id
      and component.book_package_id=document.book_package_id
    join book_packages package on package.id=document.book_package_id
    where package.slug=${scope.bookSlug}
      and component.slug=${scope.componentSlug}
      and document.document_type=${scope.documentType}
      and document.document_key=any(${documentKeys}::text[])
  `;
  const documents = new Map();
  for (const row of rows) {
    const resource = byKey.get(row.document_key);
    if (!resource || documents.has(row.document_key)) throw new Error("Builder document batch returned an unexpected document");
    documents.set(row.document_key, await rowDocument(row, resource, sql));
  }
  return documents;
}

export async function saveBuilderComponentDocument(sql, {
  resource,
  expectedRevision,
  clientMutationId,
  document,
  payloadSha256,
  builderUserId,
}) {
  if (typeof sql !== "function") throw new Error("Builder content persistence requires PostgreSQL");
  const rows = await sql`
    select * from save_builder_component_document(
      ${resource.bookSlug},
      ${resource.componentSlug},
      ${resource.documentType},
      ${resource.documentKey},
      ${resource.schemaVersion},
      ${expectedRevision},
      ${JSON.stringify(document)}::jsonb,
      ${payloadSha256},
      ${builderUserId}::uuid,
      ${clientMutationId}::uuid
    )
  `;
  const row = rows[0];
  if (!row) throw new Error("Builder content save returned no result");
  return {
    outcome: row.outcome,
    revision: row.saved_revision === null ? null : Number(row.saved_revision),
    currentRevision: row.current_revision === null ? null : Number(row.current_revision),
    document: row.saved_payload || null,
    payloadSha256: row.saved_payload_sha256 || null,
  };
}
