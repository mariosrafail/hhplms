import { createHash } from "node:crypto";

const forbiddenPublicDocumentKeys = new Set([
  "acceptedanswers",
  "acceptedanswer",
  "acceptedtexts",
  "correctanswer",
  "correctanswers",
  "correctoptionid",
  "correctoptionids",
  "correctwordids", "correcttargetids",
  "iscorrect",
  "answercount",
  "markedsource",
  "answerkey",
  "modelanswer",
  "modelanswers",
  "modelanswertexts",
  "teachersolution",
  "teachersolutions",
  "revealtext",
  "password",
  "passwords",
  "passwordhash",
  "token",
  "tokens",
  "sessiontoken",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "databaseurl",
]);

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertPublicBuilderDocument(value, path = "document") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicBuilderDocument(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPublicDocumentKeys.has(normalizedKey(key))) {
      throw new Error(`Public Builder documents cannot contain the key ${key}.`);
    }
    assertPublicBuilderDocument(child, `${path}.${key}`);
  }
}

export function stableBuilderJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableBuilderJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableBuilderJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function builderDocumentSha256(value) {
  return createHash("sha256").update(stableBuilderJson(value)).digest("hex");
}

export const builderClientMutationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
