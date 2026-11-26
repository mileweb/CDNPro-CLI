'use strict';

/**
 * Shared helpers for the spec lock tooling (fetch-openapi, spec-update,
 * spec-diff). Plain CommonJS on purpose: tsconfig has no allowJs and only
 * compiles src/, so scripts/ must run directly under Node.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SPEC_FILE = path.join(REPO_ROOT, 'openapi.json');
const LOCK_FILE = path.join(REPO_ROOT, 'openapi.lock.json');
const DEFAULT_REPO = 'mileweb/docs-content-cdn';
const DEFAULT_SPEC_PATH = 'en/apispec/openapi.json';

const HTTP_VERBS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

class SpecError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'SpecError';
    this.exitCode = exitCode;
  }
}

function readJsonFile(file, label = file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new SpecError(`cannot read ${label}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SpecError(`${label} is not valid JSON`);
  }
}

/** Write via a temp file so an interrupted run never leaves a half-written file behind. */
function writeAtomic(file, contents) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function shortSha(value) {
  return String(value || '').slice(0, 7);
}

/** Parse and minimally validate an OpenAPI document. */
function parseSpec(text, label = 'spec') {
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    const looksHtml = /^\s*</.test(text);
    throw new SpecError(
      `${label} is not valid JSON${looksHtml ? ' (looks like an HTML page, e.g. a captive portal or proxy)' : ''}`,
    );
  }
  if (!spec || typeof spec !== 'object' || typeof spec.paths !== 'object' || spec.paths === null) {
    throw new SpecError(`${label} is not an OpenAPI document (no "paths" object)`);
  }
  if (typeof spec.openapi !== 'string') {
    throw new SpecError(`${label} is not an OpenAPI document (no "openapi" version string)`);
  }
  return { spec, stats: specStats(spec) };
}

function specStats(spec) {
  const paths = Object.keys(spec.paths || {}).length;
  let operations = 0;
  for (const item of Object.values(spec.paths || {})) {
    if (!item || typeof item !== 'object') continue;
    for (const verb of HTTP_VERBS) {
      if (item[verb]) operations++;
    }
  }
  return { openapi: spec.openapi, paths, operations };
}

function isFullSha(value) {
  return typeof value === 'string' && FULL_SHA.test(value);
}

/**
 * Read and validate openapi.lock.json. Throws SpecError with a message that
 * says which field is wrong, so a corrupt lock never silently degrades into
 * an unpinned download.
 */
function readLock(file = LOCK_FILE) {
  const lock = readJsonFile(file, path.basename(file));
  const fail = (msg) => {
    throw new SpecError(`openapi.lock.json is invalid: ${msg}`);
  };

  if (!lock || typeof lock !== 'object') fail('expected a JSON object');
  if (lock.schemaVersion !== 1) fail('schemaVersion must be 1');

  const src = lock.source;
  if (!src || typeof src !== 'object') fail('missing "source"');
  if (typeof src.repo !== 'string' || !src.repo) fail('source.repo must be a non-empty string');
  if (typeof src.path !== 'string' || !src.path) fail('source.path must be a non-empty string');
  if (!isFullSha(src.commit)) fail('source.commit must be a full 40-character commit SHA');
  if (src.ref !== null && src.ref !== undefined && (typeof src.ref !== 'string' || !src.ref)) {
    fail('source.ref must be a non-empty string or null');
  }

  const spec = lock.spec;
  if (!spec || typeof spec !== 'object') fail('missing "spec"');
  if (typeof spec.sha256 !== 'string' || !SHA256.test(spec.sha256)) {
    fail('spec.sha256 must be a 64-character hex SHA-256');
  }
  if (!Number.isInteger(spec.bytes) || spec.bytes <= 0) fail('spec.bytes must be a positive integer');
  if (typeof spec.openapi !== 'string' || !spec.openapi) fail('spec.openapi must be a version string');
  if (!Number.isInteger(spec.paths) || spec.paths < 0) fail('spec.paths must be a non-negative integer');
  if (!Number.isInteger(spec.operations) || spec.operations < 0) {
    fail('spec.operations must be a non-negative integer');
  }

  return lock;
}

/** Turn a thrown value into one readable line, keeping fetch's cause code. */
function describeError(err) {
  const cause = err && err.cause && (err.cause.code || err.cause.message);
  const base = err && err.name === 'TimeoutError'
    ? 'timed out'
    : err && err.message
      ? err.message
      : String(err);
  return cause ? `${base} (${cause})` : String(base);
}

module.exports = {
  REPO_ROOT,
  SPEC_FILE,
  LOCK_FILE,
  DEFAULT_REPO,
  DEFAULT_SPEC_PATH,
  HTTP_VERBS,
  SpecError,
  readJsonFile,
  writeAtomic,
  sha256Buffer,
  sha256File,
  shortSha,
  parseSpec,
  specStats,
  isFullSha,
  readLock,
  describeError,
};