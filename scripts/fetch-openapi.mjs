/**
 * Refreshes the vendored OpenAPI document from a running AURA-BE.
 *
 * The contract is owned by the backend: it is emitted from the same Zod schemas the
 * server validates with, so this script never edits it, only copies it. The copy is
 * what `generate:api` reads, which is what keeps type generation deterministic and
 * offline — the frontend build must not depend on a server being up.
 *
 * Interim by design. The durable version of this is AURA-BE publishing the document
 * as a build artefact; see the report's DRIFT DETECTION section for the exact script
 * that belongs on that side. Until then this is the handoff.
 *
 *   node scripts/fetch-openapi.mjs [baseUrl]
 *
 * `baseUrl` defaults to VITE_API_BASE_URL, then to the local dev server.
 */
import { writeFileSync } from 'node:fs';

const DEFAULT_BASE = 'http://localhost:3000/api';

const raw = process.argv[2] ?? process.env.VITE_API_BASE_URL ?? DEFAULT_BASE;
// The docs live at the server root, not under the /api prefix the client uses.
const docsUrl = new URL('/docs/json', raw).toString();

const response = await fetch(docsUrl);
if (!response.ok) {
  console.error(`GET ${docsUrl} responded ${response.status}.`);
  console.error('Is the backend running, and is DOCS_ENABLED set?');
  process.exit(1);
}

const document = await response.json();

if (document.openapi === undefined || document.paths === undefined) {
  console.error(`${docsUrl} did not return an OpenAPI document.`);
  process.exit(1);
}

// Re-serialised rather than saved verbatim: the served document is compact, and a
// formatting difference would show up as a diff on every fetch and drown the real one.
writeFileSync('openapi.json', JSON.stringify(document, null, 2) + '\n');

const operations = Object.values(document.paths).reduce(
  (total, methods) => total + Object.keys(methods).length,
  0,
);
console.log(`openapi.json ← ${docsUrl} (${operations} operations)`);
console.log('Now run: npm run generate:api');
