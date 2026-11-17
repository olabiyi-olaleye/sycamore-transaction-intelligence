import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiSpec } from './spec.js';

// Writes to docs/openapi.json at the repo root, i.e. the same file a
// reviewer sees next to ASSESSMENT.md and BUILD_PLAN.md.
const outPath = fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url));
writeFileSync(outPath, `${JSON.stringify(openApiSpec, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
