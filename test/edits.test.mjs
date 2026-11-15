import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, approve, propose, readLog, rollback, verify } from '../edits.mjs';

const sample = new URL('../sample', import.meta.url).pathname;
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'edits-'));
  cpSync(sample, root, { recursive: true });
  return root;
};
const draft = { id: 'opening-hours', file: 'home.txt', find: 'We open at 8am', replace: 'We open at 7.30am', reason: 'New weekday hours' };
const approved = (root, plan) => approve(root, plan.id, { by: 'owner', words: `Approved ${plan.fingerprint.slice(0, 8)}` });

test('a proposal is applied only after an approval that quotes its fingerprint, and the result is checked', () => {
  const root = fresh();
  const plan = propose(root, draft);
  assert.throws(() => apply(root, plan.id), /cannot apply a proposal that is proposed/);
  assert.throws(() => approve(root, plan.id, { by: 'owner', words: 'yes' }), /quote the proposal fingerprint/);
  approved(root, plan);
  apply(root, plan.id);
  assert.match(readFileSync(join(root, 'home.txt'), 'utf8'), /We open at 7\.30am on weekdays/);
  assert.deepEqual(verify(root, plan.id), { id: plan.id, outcome: 'confirmed' });
  assert.deepEqual(readLog(root).map((entry) => entry.event), ['proposed', 'approved', 'applied', 'checked']);
});

test('ambiguous, missing and escaping targets are refused at proposal time', () => {
  const root = fresh();
  writeFileSync(join(root, 'twice.txt'), 'open open');
  assert.throws(() => propose(root, { ...draft, file: 'twice.txt', find: 'open' }), /appears 2 times/);
  assert.throws(() => propose(root, { ...draft, find: 'not in the file' }), /not found/);
  assert.throws(() => propose(root, { ...draft, file: '../outside.txt' }), /outside the content folder/);
  assert.throws(() => propose(root, { ...draft, id: 'Bad Id' }), /lowercase/);
});

test('a file that changed after the proposal blocks the edit', () => {
  const root = fresh();
  const plan = propose(root, draft);
  approved(root, plan);
  writeFileSync(join(root, 'home.txt'), `${readFileSync(join(root, 'home.txt'), 'utf8')}Extra line.\n`);
  assert.throws(() => apply(root, plan.id), /file changed after the proposal/);
});

test('a proposal edited after approval is refused', () => {
  const root = fresh();
  const plan = propose(root, draft);
  approved(root, plan);
  const file = join(root, '.approved-edits', 'plans', `${plan.id}.json`);
  writeFileSync(file, readFileSync(file, 'utf8').replace('7.30am', '6am'));
  assert.throws(() => apply(root, plan.id), /changed after it was approved/);
});

test('checking reports a mismatch when the file is edited again after the change', () => {
  const root = fresh();
  const plan = propose(root, draft);
  approved(root, plan);
  apply(root, plan.id);
  writeFileSync(join(root, 'home.txt'), 'Something else entirely.\n');
  assert.equal(verify(root, plan.id).outcome, 'mismatch');
});

test('rolling back restores the original and refuses when the file moved on', () => {
  const root = fresh();
  const original = readFileSync(join(root, 'home.txt'), 'utf8');
  const plan = propose(root, draft);
  approved(root, plan);
  apply(root, plan.id);
  rollback(root, plan.id);
  assert.equal(readFileSync(join(root, 'home.txt'), 'utf8'), original);

  const second = propose(root, { ...draft, id: 'second' });
  approved(root, second);
  apply(root, second.id);
  writeFileSync(join(root, 'home.txt'), 'Edited by hand.\n');
  assert.throws(() => rollback(root, second.id), /restore it by hand/);
});

test('replacement text is inserted literally', () => {
  const root = fresh();
  const plan = propose(root, { ...draft, id: 'literal', replace: 'We open at $& sharp' });
  approved(root, plan);
  apply(root, plan.id);
  assert.match(readFileSync(join(root, 'home.txt'), 'utf8'), /We open at \$& sharp on weekdays/);
});
