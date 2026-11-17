import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiSpec } from '../config/openapi.config.js';

const outPath = fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url));
writeFileSync(outPath, `${JSON.stringify(openApiSpec, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
