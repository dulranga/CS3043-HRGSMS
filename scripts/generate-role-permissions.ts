// Generates the frontend's copy of the staff role→operation grants from the
// backend's single source of truth (`backend/src/authorization.ts`). Run with
// `npm run gen:permissions` after changing the matrix; a test asserts the
// checked-in output stays in sync.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, ROLE_GRANTS, STAFF_ROLES } from '../backend/src/authorization';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '..', 'frontend', 'src', 'lib', 'rolePermissions.generated.ts');

const operations = Object.keys(OPERATIONS);
const lines: string[] = [
  '// AUTO-GENERATED from backend/src/authorization.ts — do not edit by hand.',
  '// Regenerate with: npm run gen:permissions',
  '',
  "export type PermissionScope = 'BRANCH' | 'CHAIN';",
  '',
  'export const OPERATIONS = [',
  ...operations.map((operation) => `  ${JSON.stringify(operation)},`),
  '] as const;',
  '',
  'export type Operation = (typeof OPERATIONS)[number];',
  '',
  '// A staff role maps to the exact set of operations it may perform and the',
  '// scope of each grant (BRANCH = own branch, CHAIN = chain-wide).',
  'export const ROLE_GRANTS: Record<string, Partial<Record<Operation, PermissionScope>>> = {',
];

for (const role of STAFF_ROLES) {
  const grants = ROLE_GRANTS[role];
  const entries = (Object.keys(grants) as Array<keyof typeof grants>)
    .sort()
    .map((operation) => `${JSON.stringify(operation)}: '${grants[operation]}'`);
  lines.push(`  ${role}: { ${entries.join(', ')} },`);
}

lines.push('};', '');
writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
