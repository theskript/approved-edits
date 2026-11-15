import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const STATE = '.approved-edits';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const count = (text, part) => text.split(part).length - 1;

function paths(root, id) {
  const state = join(root, STATE);
  return { state, plan: join(state, 'plans', `${id}.json`), backup: join(state, 'backups', id), log: join(state, 'log.jsonl') };
}

function record(root, entry) {
  const { state, log } = paths(root, 'x');
  mkdirSync(state, { recursive: true });
  appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function target(root, file) {
  if (typeof file !== 'string' || file === '' || isAbsolute(file)) throw new Error('file must be a path inside the content folder');
  const full = resolve(root, file);
  const rel = relative(resolve(root), full);
  if (rel.startsWith('..') || rel.split(/[\\/]/)[0] === STATE) throw new Error('file is outside the content folder');
  return { full, rel };
}

function load(root, id) {
  const { plan } = paths(root, id);
  if (!existsSync(plan)) throw new Error(`no proposal named ${id}`);
  return JSON.parse(readFileSync(plan, 'utf8'));
}

function save(root, plan) {
  writeFileSync(paths(root, plan.id).plan, `${JSON.stringify(plan, null, 2)}\n`);
}

const fingerprint = (plan) => sha(JSON.stringify([plan.id, plan.file, plan.find, plan.replace, plan.beforeHash]));

export function propose(root, proposal) {
  const { id, file, find, replace, reason } = proposal;
  if (!/^[a-z0-9-]+$/.test(id ?? '')) throw new Error('id must be lowercase letters, digits and hyphens');
  if (typeof find !== 'string' || find === '' || typeof replace !== 'string') throw new Error('find and replace must be text, and find cannot be empty');
  if (!reason) throw new Error('a reason is required');
  const { full, rel } = target(root, file);
  if (existsSync(paths(root, id).plan)) throw new Error(`a proposal named ${id} already exists`);
  const text = readFileSync(full, 'utf8');
  const matches = count(text, find);
  if (matches !== 1) throw new Error(matches === 0 ? 'the text to replace was not found' : `the text to replace appears ${matches} times; name a more specific passage`);
  const plan = { id, file: rel, find, replace, reason, beforeHash: sha(text), status: 'proposed' };
  plan.fingerprint = fingerprint(plan);
  mkdirSync(dirname(paths(root, id).plan), { recursive: true });
  save(root, plan);
  record(root, { id, event: 'proposed', file: rel });
  return plan;
}

export function approve(root, id, { by, words }) {
  const plan = load(root, id);
  if (plan.status !== 'proposed') throw new Error(`cannot approve a proposal that is ${plan.status}`);
  if (!by) throw new Error('say who is approving');
  if (!String(words ?? '').includes(plan.fingerprint.slice(0, 8))) throw new Error(`the approval must quote the proposal fingerprint ${plan.fingerprint.slice(0, 8)}`);
  plan.status = 'approved';
  plan.approval = { by, words };
  save(root, plan);
  record(root, { id, event: 'approved', by });
  return plan;
}

export function apply(root, id) {
  const plan = load(root, id);
  if (plan.status !== 'approved') throw new Error(`cannot apply a proposal that is ${plan.status}`);
  if (fingerprint(plan) !== plan.fingerprint) throw new Error('the proposal changed after it was approved');
  const { full } = target(root, plan.file);
  const text = readFileSync(full, 'utf8');
  if (sha(text) !== plan.beforeHash) throw new Error('the file changed after the proposal was written; propose again');
  const { backup } = paths(root, id);
  mkdirSync(dirname(join(backup, plan.file)), { recursive: true });
  copyFileSync(full, join(backup, plan.file));
  const next = text.replace(plan.find, () => plan.replace);
  writeFileSync(full, next);
  plan.afterHash = sha(next);
  plan.status = 'applied';
  save(root, plan);
  record(root, { id, event: 'applied', file: plan.file });
  return plan;
}

export function verify(root, id) {
  const plan = load(root, id);
  if (plan.status !== 'applied') throw new Error(`nothing to check: the proposal is ${plan.status}`);
  let outcome;
  try {
    const before = readFileSync(join(paths(root, id).backup, plan.file), 'utf8');
    const now = readFileSync(target(root, plan.file).full, 'utf8');
    outcome = now === before.replace(plan.find, () => plan.replace) ? 'confirmed' : 'mismatch';
  } catch {
    outcome = 'not checked';
  }
  record(root, { id, event: 'checked', outcome });
  return { id, outcome };
}

export function rollback(root, id) {
  const plan = load(root, id);
  if (plan.status !== 'applied') throw new Error(`cannot roll back a proposal that is ${plan.status}`);
  const { full } = target(root, plan.file);
  if (sha(readFileSync(full, 'utf8')) !== plan.afterHash) throw new Error('the file changed after the edit was applied; restore it by hand');
  copyFileSync(join(paths(root, id).backup, plan.file), full);
  plan.status = 'rolled back';
  save(root, plan);
  record(root, { id, event: 'rolled back', file: plan.file });
  return plan;
}

export function readLog(root) {
  const { log } = paths(root, 'x');
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

function cli(argv) {
  const [root, command, ...rest] = argv;
  const flag = (name) => rest[rest.indexOf(`--${name}`) + 1];
  const actions = {
    propose: () => propose(root, JSON.parse(readFileSync(rest[0], 'utf8'))),
    approve: () => approve(root, rest[0], { by: flag('by'), words: flag('words') }),
    apply: () => apply(root, rest[0]),
    verify: () => verify(root, rest[0]),
    rollback: () => rollback(root, rest[0]),
    log: () => readLog(root),
  };
  if (!root || !actions[command]) throw new Error('usage: edits.mjs <content-folder> propose|approve|apply|verify|rollback|log ...');
  return actions[command]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(cli(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
