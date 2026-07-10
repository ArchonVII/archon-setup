import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const EXPECTED_PERMISSIONS = [
  'permissions:',
  '  contents: read',
  '  pull-requests: write',
  '  issues: write',
].join('\n');

const callers = [
  '.github/workflows/anomaly-triage.yml',
  'src/snapshots/github-workflows/anomaly-triage.yml',
  'src/snapshots/repo-template/.github/workflows/anomaly-triage.yml',
];

for (const relativePath of callers) {
  test(`${relativePath} grants the exact anomaly-triage caller permissions`, async () => {
    const body = await readFile(join(ROOT, relativePath), 'utf8');
    const permissionsStart = body.indexOf('permissions:');
    const jobsStart = body.indexOf('jobs:');

    assert.ok(permissionsStart > -1, `${relativePath} should declare workflow permissions`);
    assert.ok(permissionsStart < jobsStart, `${relativePath} permissions should apply before jobs`);
    assert.equal(
      body.slice(permissionsStart, jobsStart).replaceAll('\r\n', '\n').trim(),
      EXPECTED_PERMISSIONS,
    );
  });
}
