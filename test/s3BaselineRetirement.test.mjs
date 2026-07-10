import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { selfApply } from '../scripts/agent-self-apply.mjs';
import { buildPlan } from '../src/server/planner/buildPlan.mjs';

const features = JSON.parse(await readFile(new URL('../src/registry/features.json', import.meta.url), 'utf8'));
const context = {
  targetPath: 'C:/tmp/archon-s3-plan',
  capabilities: {},
  targetMode: 'existing-repo',
};

test('foundation agents no longer installs the retired repo-update-log fragments guide', async () => {
  const plan = await buildPlan({ selection: ['foundation.agents'], context });
  assert.equal(plan.files.some((file) => file.path === 'docs/repo-update-log/README.md'), false);
});

test('foundation changelog is release-class and creates no fragment directory', async () => {
  const plan = await buildPlan({ selection: ['foundation.changelog'], context });
  assert.deepEqual(plan.files.map((file) => file.path), ['CHANGELOG.md']);
});

test('the retired repo-update-log workflow feature remains a disabled no-op for old manifests', async () => {
  const feature = features.find((item) => item.id === 'agent-workflow.repo-update-log-fragment');
  assert.ok(feature, 'retired feature id must remain resolvable for existing manifests');
  assert.equal(feature.disabled, true);
  assert.deepEqual(feature.creates || [], []);
  assert.deepEqual(feature.tasks, []);

  const plan = await buildPlan({ selection: [feature.id], context });
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.ordered, []);
});

test('self-apply succeeds against the refreshed S3 snapshot without retired paths', async () => {
  const targetPath = await mkdtemp(join(tmpdir(), 'archon-s3-self-apply-'));
  const { report } = await selfApply({ targetPath });
  assert.ok(report.every((entry) => entry.status === 'applied'));
});
