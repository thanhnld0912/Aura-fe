/**
 * Fails if `src/generated/api.ts` is not what `openapi.json` generates.
 *
 * Two things this catches, both of which otherwise compile cleanly and fail at
 * runtime — the exact failure mode `ARCHITECTURE.md` §10 attributes to Option D:
 *
 *   1. `openapi.json` was refreshed from the backend but nobody re-ran generation.
 *   2. Someone edited the generated file by hand.
 *
 * Deliberately not `git diff --exit-code`: that reports nothing for a file git is not
 * tracking yet, so it would pass vacuously on a fresh checkout or before the first
 * commit. Comparing the bytes works whatever git thinks.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GENERATED = 'src/generated/api.ts';
const CLI = 'node_modules/openapi-typescript/bin/cli.js';

const scratch = mkdtempSync(join(tmpdir(), 'aura-api-'));
const candidate = join(scratch, 'api.ts');

try {
  // The CLI's JS entry point, run through node directly. Going via `npx` would need
  // a shell on Windows, where spawning a .cmd without one fails with EINVAL.
  execFileSync(process.execPath, [CLI, 'openapi.json', '-o', candidate], { stdio: 'pipe' });

  const fresh = readFileSync(candidate, 'utf8');

  let committed;
  try {
    committed = readFileSync(GENERATED, 'utf8');
  } catch {
    console.error(`${GENERATED} is missing. Run: npm run generate:api`);
    process.exit(1);
  }

  if (fresh !== committed) {
    console.error(`${GENERATED} is out of date with openapi.json.`);
    console.error('Run: npm run generate:api');
    process.exit(1);
  }

  console.log(`${GENERATED} matches openapi.json.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
