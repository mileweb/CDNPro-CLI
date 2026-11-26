#!/usr/bin/env node
'use strict';

/**
 * Installs the CDN Pro OpenAPI spec at the exact revision pinned by
 * openapi.lock.json, or verifies that the local copy matches it.
 *
 * The spec is not committed. openapi.lock.json records the docs-content-cdn
 * commit, its sha256, and the spec's shape, so every build uses the same
 * spec (the one the CLI code was verified against) until someone deliberately
 * advances the pin with `npm run spec:update`.
 *
 * Usage:
 *   node scripts/fetch-openapi.js              install the locked spec
 *   node scripts/fetch-openapi.js --force      re-download even if the hash matches
 *   node scripts/fetch-openapi.js --check      offline: does openapi.json match the lock?
 *   node scripts/fetch-openapi.js --check --release
 *                                              compare the lock with live master (warn-only;
 *                                              used by prepublishOnly). Add --strict to fail.
 *
 * Downloads try raw.githubusercontent.com first, then api.github.com (raw media
 * type). The URL is the pinned commit, so the content is immutable; the sha256
 * in the lock is the integrity check. When the local file already matches the
 * lock, no network request is made.
 *
 * Environment:
 *   OPENAPI_SPEC_URL   legacy, unpinned escape hatch. Bypasses the lock (warned);
 *                      keeps the old ETag/304 behavior. Cannot be combined with
 *                      --check or --release.
 *   GITHUB_TOKEN       (or GH_TOKEN) optional; lifts the api.github.com rate limit.
 *
 * Exit codes: 0 success; 1 missing/mismatched spec, network failure, or lock
 * mismatch; 2 usage error.
 */

const fs = require('fs');
const path = require('path');

const {
  SPEC_FILE,
  LOCK_FILE,
  SpecError,
  readLock,
  sha256File,
  writeAtomic,
  shortSha,
  describeError,
} = require('./lib/spec-common');
const {
  toRawUrl,
  buildSources,
  fetchFromSources,
  downloadSpec,
  resolveDocsRef,
} = require('./lib/spec-source');

const ETAG_FILE = `${SPEC_FILE}.etag`;
const DOWNLOAD_TIMEOUT_MS = 30_000;
// When we already have a copy, an update check must never stall a build for long.
const CHECK_TIMEOUT_MS = 10_000;

const args = process.argv.slice(2);
const force = args.includes('--force');
const check = args.includes('--check');
const release = args.includes('--release');
const strict = args.includes('--strict');

const log = (msg) => console.log(`[fetch-openapi] ${msg}`);
const warn = (msg) => console.warn(`[fetch-openapi] warning: ${msg}`);
function fail(message, code = 1) {
  console.error(`[fetch-openapi] error: ${message}`);
  process.exit(code);
}

function removeEtag() {
  fs.rmSync(ETAG_FILE, { force: true });
}

/**
 * The saved { url, etag } record, or null if there is none / it is unreadable /
 * the spec file itself is missing. Used only by legacy OPENAPI_SPEC_URL mode.
 */
function readSavedRecord() {
  if (!fs.existsSync(SPEC_FILE) || !fs.existsSync(ETAG_FILE)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(ETAG_FILE, 'utf8'));
    return saved && typeof saved.url === 'string' && typeof saved.etag === 'string' && saved.etag ? saved : null;
  } catch {
    return null; // corrupt sidecar: just do a full download
  }
}

function saveRecord(url, etag) {
  if (etag) {
    writeAtomic(ETAG_FILE, JSON.stringify({ url, etag }) + '\n');
  } else {
    fs.rmSync(ETAG_FILE, { force: true }); // server sent no ETag: don't keep a stale one
  }
}

async function legacyFetch(primaryUrl) {
  const saved = force ? null : readSavedRecord();

  // Try the source that produced the current file first: its ETag is the only one
  // that can yield a cheap 304, and it avoids waiting on a primary known to be down.
  const sources = buildSources(primaryUrl).sort(
    (a, b) => Number(Boolean(saved) && b.url === saved.url) - Number(Boolean(saved) && a.url === saved.url),
  );

  try {
    const result = await fetchFromSources(sources, {
      etag: saved ? saved.etag : undefined,
      etagUrl: saved ? saved.url : undefined,
      timeoutMs: fs.existsSync(SPEC_FILE) ? CHECK_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS,
    });

    if (result.notModified) {
      log(`openapi.json is up to date (ETag unchanged, via ${result.source.name}).`);
      return;
    }

    writeAtomic(SPEC_FILE, result.buffer);
    saveRecord(result.source.url, result.etag);
    log(
      `${saved ? 'updated' : 'saved'} openapi.json via ${result.source.name} ` +
        `(${(result.buffer.length / 1024).toFixed(0)} KB, ` +
        `${result.stats.paths} paths, ${result.stats.operations} operations)`,
    );
  } catch (err) {
    if (fs.existsSync(SPEC_FILE)) {
      warn(`could not refresh the spec; keeping the existing openapi.json.\n  ${describeError(err)}`);
      return;
    }
    fail(
      `could not download the OpenAPI spec.\n  ${describeError(err)}\n` +
        `  Fix your network/proxy and retry, or download the file manually to ${SPEC_FILE},\n` +
        `  or point OPENAPI_SPEC_URL at another location.`,
    );
  }
}

function localCheck(lock) {
  if (!fs.existsSync(SPEC_FILE)) {
    fail('openapi.json is missing. Run "npm run fetch:spec" to install the locked spec.');
  }
  const actual = sha256File(SPEC_FILE);
  if (actual !== lock.spec.sha256) {
    fail(
      'openapi.json does not match the lock.\n' +
        `  expected ${lock.spec.sha256}\n` +
        `  actual   ${actual}\n` +
        '  Run "npm run fetch:spec -- --force" to reinstall the pinned spec, or restore the intended lock.',
    );
  }
  log(`openapi.json matches lock (${shortSha(lock.source.commit)}, sha256 ${actual.slice(0, 12)}…).`);
}

async function releaseCheck(lock) {
  log('checking the lock against live master…');

  let master;
  try {
    const resolved = await resolveDocsRef('master', { repo: lock.source.repo });
    const downloaded = await downloadSpec({
      repo: lock.source.repo,
      commit: resolved.commit,
      specPath: lock.source.path,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
    master = { ...downloaded, commit: resolved.commit };
  } catch (err) {
    warn(`could not verify the lock against live master: ${describeError(err)}`);
    if (strict) process.exit(1);
    return;
  }

  if (master.sha256 === lock.spec.sha256) {
    log(`lock matches live master (${shortSha(master.commit)}).`);
    return;
  }

  const ref = lock.source.ref ? ` (lock ref: ${lock.source.ref})` : '';
  const advice =
    lock.source.ref && lock.source.ref !== 'master'
      ? '  This is a non-production pin. Do not publish it before the API reaches production.\n' +
        '  After the API ships, re-pin with "npm run spec:update -- --from master".'
      : lock.source.ref === 'master'
        ? '  The lock is behind master. Re-pin with "npm run spec:update -- --from master" before publishing.'
        : '  Re-pin from master with "npm run spec:update -- --from master" before publishing.';
  warn(
    `the lock does not match live master${ref}.\n` +
      `  lock:   ${lock.source.commit}  sha256 ${lock.spec.sha256.slice(0, 12)}…\n` +
      `  master: ${master.commit}  sha256 ${master.sha256.slice(0, 12)}…\n` +
      advice,
  );
  if (strict) process.exit(1);
}

async function install(lock) {
  const { commit } = lock.source;

  if (fs.existsSync(SPEC_FILE) && !force) {
    const actual = sha256File(SPEC_FILE);
    if (actual === lock.spec.sha256) {
      log(`openapi.json is up to date (lock ${shortSha(commit)}, sha256 ${actual.slice(0, 12)}…).`);
      removeEtag();
      return;
    }
    warn(
      `local openapi.json does not match the lock ` +
        `(${actual.slice(0, 12)}… != ${lock.spec.sha256.slice(0, 12)}…); reinstalling.`,
    );
  }

  log(`downloading pinned spec at ${shortSha(commit)}…`);

  let result;
  try {
    result = await downloadSpec({
      repo: lock.source.repo,
      commit,
      specPath: lock.source.path,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
  } catch (err) {
    fail(
      `could not download the pinned spec.\n  ${describeError(err)}\n` +
        `  The lock pins ${commit}.\n` +
        '  Fix your network/proxy and retry, or set OPENAPI_SPEC_URL to override (unpinned, warned).',
    );
  }

  if (result.sha256 !== lock.spec.sha256) {
    fail(
      'downloaded spec does not match the lock.\n' +
        `  expected ${lock.spec.sha256}\n` +
        `  actual   ${result.sha256}\n` +
        '  Refusing to write a tampered or corrupted spec.',
    );
  }

  writeAtomic(SPEC_FILE, result.buffer);
  removeEtag();
  log(
    `saved openapi.json at ${shortSha(commit)} ` +
      `(${(result.buffer.length / 1024).toFixed(0)} KB, ` +
      `${result.stats.paths} paths, ${result.stats.operations} operations, ` +
      `sha256 ${result.sha256.slice(0, 12)}…).`,
  );
}

async function main() {
  if (release && !check) fail('--release is only valid together with --check', 2);
  if (strict && !release) fail('--strict is only valid together with --check --release', 2);

  const overrideUrl = process.env.OPENAPI_SPEC_URL;
  if (overrideUrl) {
    warn(`OPENAPI_SPEC_URL bypasses ${path.basename(LOCK_FILE)}; the build will not be pinned.`);
    if (check || release) {
      fail('--check/--release require the lock; unset OPENAPI_SPEC_URL to use them.', 2);
    }
    return legacyFetch(toRawUrl(overrideUrl));
  }

  let lock;
  try {
    lock = readLock();
  } catch (err) {
    fail(`${describeError(err)}\n  Restore openapi.lock.json from git, or run "npm run spec:update".`);
  }

  if (release) return releaseCheck(lock);
  if (check) return localCheck(lock);
  return install(lock);
}

main().catch((err) => {
  if (err instanceof SpecError) fail(err.message, err.exitCode);
  fail(describeError(err));
});