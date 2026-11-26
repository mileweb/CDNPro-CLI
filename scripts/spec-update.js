#!/usr/bin/env node
'use strict';

/**
 * Advances the pinned OpenAPI spec: resolves a docs ref to an immutable
 * commit, downloads and verifies the spec, writes openapi.json and
 * openapi.lock.json, and regenerates src/types/api.ts.
 *
 * Usage:
 *   node scripts/spec-update.js                    # pin to the tip of master
 *   node scripts/spec-update.js --from dev         # pin to the tip of dev
 *   node scripts/spec-update.js --from <40-hex>    # pin to an exact commit
 *   node scripts/spec-update.js --commit <40-hex>  # same, explicit
 *   node scripts/spec-update.js --dry-run          # print the lock, write nothing
 *   node scripts/spec-update.js --no-types         # do not regenerate types
 *   node scripts/spec-update.js --force            # re-pin even if nothing changed
 *
 * Updating the lock always pins a docs commit. For ad-hoc candidates (URLs,
 * local files) use `npm run spec:diff -- --from <url|file>`.
 *
 * Exit codes: 0 success/no-op/dry-run; 1 network/integrity/write/types failure;
 * 2 usage error.
 */

const fs = require('fs');
const { spawnSync } = require('child_process');

const {
  SPEC_FILE,
  LOCK_FILE,
  DEFAULT_REPO,
  DEFAULT_SPEC_PATH,
  SpecError,
  readLock,
  writeAtomic,
  shortSha,
  describeError,
  isFullSha,
} = require('./lib/spec-common');
const {
  rawSpecUrl,
  downloadSpec,
  resolveDocsRef,
  classifyFrom,
} = require('./lib/spec-source');

const USAGE = `Usage: node scripts/spec-update.js [--from <docs-ref|40-hex>] [--commit <40-hex>]
                                 [--force] [--no-types] [--dry-run]

  --from <ref>    docs branch/tag or full commit SHA to pin (default: master)
  --commit <sha>  exact 40-character commit SHA; mutually exclusive with --from
  --force         re-download and rewrite even if the pin is unchanged
  --no-types      skip regenerating src/types/api.ts
  --dry-run       print the new openapi.lock.json and write nothing`;

const log = (msg) => console.error(`[spec-update] ${msg}`);
function fail(message, code = 1) {
  console.error(`[spec-update] error: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { from: 'master', fromExplicit: false, commit: null, force: false, types: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (flag) => {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`, 2);
      return value;
    };
    switch (arg) {
      case '--from': opts.from = takeValue('--from'); opts.fromExplicit = true; break;
      case '--commit': opts.commit = takeValue('--commit'); break;
      case '--force': opts.force = true; break;
      case '--no-types': opts.types = false; break;
      case '--dry-run': opts.dryRun = true; break;
      case '-h':
      case '--help': console.log(USAGE); process.exit(0); break;
      default: fail(`unknown argument: ${arg}\n\n${USAGE}`, 2);
    }
  }
  return opts;
}

function buildLock({ ref, commit, commitDate, commitSubject, specPath, result }) {
  return {
    schemaVersion: 1,
    source: {
      repo: DEFAULT_REPO,
      path: specPath,
      ref,
      commit,
      commitDate: commitDate || null,
      commitSubject: commitSubject || null,
      url: rawSpecUrl({ repo: DEFAULT_REPO, commit, specPath }),
    },
    spec: {
      sha256: result.sha256,
      bytes: result.buffer.length,
      openapi: result.stats.openapi,
      paths: result.stats.paths,
      operations: result.stats.operations,
    },
  };
}

function readExistingLock() {
  try {
    return readLock();
  } catch {
    return null; // bootstrap: no lock yet, or an unreadable one being replaced
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.commit && opts.fromExplicit) {
    fail('--commit and --from are mutually exclusive', 2);
  }
  if (opts.commit && !isFullSha(opts.commit)) {
    fail(`--commit must be a full 40-character commit SHA, got: ${opts.commit}`, 2);
  }

  let ref;
  let target;
  if (opts.commit) {
    ref = null;
    target = { commit: opts.commit.toLowerCase(), commitDate: null, commitSubject: null, via: 'sha' };
  } else {
    const source = classifyFrom(opts.from);
    if (source.kind === 'url' || source.kind === 'file') {
      fail(
        'spec:update pins a docs commit; use "npm run spec:diff -- --from <url|file>" for ad-hoc candidates.',
        2,
      );
    }
    if (source.kind === 'commit') {
      ref = null;
      log(`resolved ${opts.from} to ${shortSha(source.value)}`);
      target = { commit: source.value, commitDate: null, commitSubject: null, via: 'sha' };
    } else {
      log(`resolving ${opts.from} in ${DEFAULT_REPO}…`);
      target = await resolveDocsRef(opts.from, { repo: DEFAULT_REPO });
      ref = opts.from;
      log(`resolved ${opts.from} -> ${shortSha(target.commit)} (${target.via})`);
    }
  }

  const specPath = DEFAULT_SPEC_PATH;
  log(`downloading ${DEFAULT_REPO}/${specPath} at ${shortSha(target.commit)}…`);

  let result;
  try {
    result = await downloadSpec({ repo: DEFAULT_REPO, commit: target.commit, specPath });
  } catch (err) {
    fail(`could not download the spec: ${describeError(err)}`);
  }

  const lock = buildLock({
    ref,
    commit: target.commit,
    commitDate: target.commitDate,
    commitSubject: target.commitSubject,
    specPath,
    result,
  });

  const old = readExistingLock();
  const unchanged =
    old &&
    !opts.force &&
    old.source.commit === lock.source.commit &&
    old.spec.sha256 === lock.spec.sha256;

  if (unchanged) {
    log(`already pinned at ${shortSha(lock.source.commit)} (sha256 ${lock.spec.sha256.slice(0, 12)}…); nothing to do.`);
    if (!opts.dryRun) return;
  } else if (old) {
    log(
      `pin ${shortSha(old.source.commit)} (${old.spec.sha256.slice(0, 12)}…) -> ` +
        `${shortSha(lock.source.commit)} (${lock.spec.sha256.slice(0, 12)}…)`,
    );
  } else {
    log(`creating a new pin at ${shortSha(lock.source.commit)} (${lock.spec.sha256.slice(0, 12)}…)`);
  }

  log(
    `${result.buffer.length} bytes, ${lock.spec.paths} paths, ${lock.spec.operations} operations, ` +
      `OpenAPI ${lock.spec.openapi}`,
  );

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(lock, null, 2) + '\n');
    log('dry run: no files written');
    return;
  }

  writeAtomic(SPEC_FILE, result.buffer);
  writeAtomic(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
  log(`wrote ${LOCK_FILE} and ${SPEC_FILE}`);

  if (opts.types) {
    log('regenerating src/types/api.ts…');
    const status = spawnSync('npm', ['run', 'generate:types'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (status.error) fail(`could not run "npm run generate:types": ${describeError(status.error)}`);
    if (status.status !== 0) fail('types generation failed; fix the error and re-run (or use --no-types)');
  }

  log(
    'next: run "npm test", review src/types/api.ts and the code diff, then commit ' +
      'openapi.lock.json + src/types/api.ts + code together.',
  );
}

main().catch((err) => {
  if (err instanceof SpecError) fail(err.message, err.exitCode);
  fail(describeError(err));
});