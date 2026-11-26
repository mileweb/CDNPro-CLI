'use strict';

/**
 * Fetching and ref-resolution helpers shared by fetch-openapi.js,
 * spec-update.js and spec-diff.js.
 *
 * Sources, tried in order:
 *   1. raw.githubusercontent.com            (primary; not API rate-limited)
 *   2. api.github.com contents API          (failover, same file via the raw media type)
 * The api.github.com source is derived automatically from a raw GitHub URL.
 * github.com/.../blob/... page URLs are accepted and rewritten to raw form.
 *
 * A pinned commit is fetched by SHA, so a branch moving mid-run cannot mix
 * provenance. Ref resolution never trusts local git state: the GitHub API is
 * tried first (github.com is unreliable here), with `git ls-remote` as a
 * fallback.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  SpecError,
  DEFAULT_SPEC_PATH,
  sha256Buffer,
  parseSpec,
  isFullSha,
  describeError,
} = require('./spec-common');

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const RESOLVE_TIMEOUT_MS = 20_000;
const USER_AGENT = 'cdnpro-cli-spec-tools';

function getToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

function toRawUrl(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

function rawSpecUrl({ repo, commit, specPath = DEFAULT_SPEC_PATH }) {
  return `https://raw.githubusercontent.com/${repo}/${commit}/${specPath}`;
}

function apiContentsUrl({ repo, commit, specPath = DEFAULT_SPEC_PATH }) {
  return `https://api.github.com/repos/${repo}/contents/${specPath}?ref=${encodeURIComponent(commit)}`;
}

/**
 * The ordered list of places to try for one spec URL. Always the URL itself;
 * plus the GitHub API when the URL is a raw.githubusercontent.com URL.
 */
function buildSources(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SpecError(`invalid spec URL: ${rawUrl}`);
  }

  const sources = [
    {
      name: parsed.host,
      url: rawUrl,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    },
  ];

  const m = rawUrl.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (m) {
    const [, owner, repo, ref, specPath] = m;
    const headers = {
      // The raw media type returns the file itself (up to 100 MB), not the JSON wrapper.
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    sources.push({
      name: 'api.github.com',
      url: `https://api.github.com/repos/${owner}/${repo}/contents/${specPath}?ref=${encodeURIComponent(ref)}`,
      headers,
    });
  }

  return sources;
}

/** Fetch one source. Resolves to { notModified: true } on 304, else the body. */
async function fetchOne(source, { etag, timeoutMs }) {
  if (typeof fetch !== 'function') {
    throw new Error(`global fetch() is not available in Node ${process.version}; Node 18+ is required`);
  }
  const headers = { ...source.headers };
  if (etag) headers['If-None-Match'] = etag;

  const res = await fetch(source.url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 304) return { notModified: true, source };
  if (res.status === 401 && headers.Authorization) {
    // A stale/revoked token must not break an otherwise-working anonymous request.
    const { Authorization, ...anonymous } = source.headers;
    return fetchOne({ ...source, headers: anonymous }, { etag, timeoutMs });
  }
  if (!res.ok) {
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error(`HTTP ${res.status}: rate limit exceeded (set GITHUB_TOKEN to raise it)`);
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString('utf8');
  const { spec, stats } = parseSpec(text, source.name);
  return {
    text,
    buffer,
    spec,
    stats,
    sha256: sha256Buffer(buffer),
    etag: res.headers.get('etag'),
    source,
  };
}

/**
 * Try every source in order. On failure of all, throws a combined error.
 * Returns { notModified: true, source } when an ETag matched.
 */
async function fetchFromSources(sources, { etag, etagUrl, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS } = {}) {
  const failures = [];
  for (const source of sources) {
    const sourceEtag = etag && etagUrl === source.url ? etag : undefined;
    try {
      return await fetchOne(source, { etag: sourceEtag, timeoutMs });
    } catch (err) {
      failures.push(`${source.name}: ${describeError(err)}`);
    }
  }
  throw new SpecError(
    `could not download the spec from any source:\n  - ${failures.join('\n  - ')}`,
  );
}

/** Download and validate a spec at an immutable commit. */
async function downloadSpec({ repo, commit, specPath = DEFAULT_SPEC_PATH, timeoutMs } = {}) {
  const url = rawSpecUrl({ repo, commit, specPath });
  const result = await fetchFromSources(buildSources(url), { timeoutMs });
  if (result.notModified) {
    throw new SpecError(`unexpected 304 for a pinned commit: ${url}`);
  }
  return result;
}

/** Download and validate a single URL (used for ad-hoc candidates). */
async function fetchSpecUrl(url, { timeoutMs } = {}) {
  const result = await fetchFromSources(buildSources(toRawUrl(url)), { timeoutMs });
  if (result.notModified) {
    throw new SpecError(`unexpected 304 for ${url}`);
  }
  return result;
}

/** Read and validate a local spec file. */
function readSpecFile(file) {
  const buffer = fs.readFileSync(file);
  const text = buffer.toString('utf8');
  const { spec, stats } = parseSpec(text, path.basename(file));
  return {
    text,
    buffer,
    spec,
    stats,
    sha256: sha256Buffer(buffer),
    source: { name: 'file', url: null, path: file },
  };
}

/**
 * Resolve a docs ref to an immutable commit SHA.
 * Full 40-hex SHAs pass through untouched.
 */
async function resolveDocsRef(ref, { repo, timeoutMs = RESOLVE_TIMEOUT_MS } = {}) {
  if (isFullSha(ref)) {
    return { commit: ref.toLowerCase(), commitDate: null, commitSubject: null, via: 'sha' };
  }

  const apiFailure = await tryApiResolve(ref, repo, timeoutMs);
  if (apiFailure.commit) return apiFailure;

  const remoteFailure = await tryLsRemote(ref, repo, timeoutMs);
  if (remoteFailure.commit) return remoteFailure;

  throw new SpecError(
    `could not resolve "${ref}" in ${repo}: ` +
      `${apiFailure.reason}; ${remoteFailure.reason}. ` +
      'Pass a full 40-character commit SHA, or set GITHUB_TOKEN.',
  );
}

function buildApiHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function tryApiResolve(ref, repo, timeoutMs, headersOverride) {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
  const headers = headersOverride || buildApiHeaders();

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401 && headers.Authorization) {
      const { Authorization, ...anonymous } = headers;
      return tryApiResolve(ref, repo, timeoutMs, anonymous);
    }
    if (!res.ok) {
      if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        return { reason: 'GitHub API rate limit exceeded (set GITHUB_TOKEN)' };
      }
      return { reason: `GitHub API returned HTTP ${res.status}` };
    }
    const body = await res.json();
    if (!body || !isFullSha(body.sha)) return { reason: 'GitHub API returned no commit SHA' };
    const message = body.commit && typeof body.commit.message === 'string' ? body.commit.message : '';
    const date =
      (body.commit && body.commit.committer && body.commit.committer.date) ||
      (body.commit && body.commit.author && body.commit.author.date) ||
      null;
    return {
      commit: body.sha.toLowerCase(),
      commitDate: date,
      commitSubject: message.split('\n')[0] || null,
      via: 'api',
    };
  } catch (err) {
    return { reason: `GitHub API: ${describeError(err)}` };
  }
}

function tryLsRemote(ref, repo, timeoutMs) {
  const result = spawnSync(
    'git',
    ['ls-remote', `https://github.com/${repo}.git`, ref],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  );
  if (result.error) return { reason: `git ls-remote: ${describeError(result.error)}` };
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`;
    return { reason: `git ls-remote: ${detail}` };
  }

  const matches = new Map();
  for (const line of (result.stdout || '').split('\n')) {
    const m = line.match(/^([0-9a-f]{40})\t(.+)$/);
    if (m) matches.set(m[2], m[1]);
  }

  const head = matches.get(`refs/heads/${ref}`);
  const tag = matches.get(`refs/tags/${ref}^{}`) || matches.get(`refs/tags/${ref}`);
  if (head && tag && head !== tag) {
    return { reason: `git ls-remote: "${ref}" is both a branch (${head.slice(0, 7)}) and a tag (${tag.slice(0, 7)})` };
  }
  const commit = head || tag;
  if (!commit) return { reason: `git ls-remote: no ref named "${ref}"` };
  return { commit: commit.toLowerCase(), commitDate: null, commitSubject: null, via: 'ls-remote' };
}

/**
 * Classify a --from value: a full SHA, an http(s) URL, an existing file, or
 * a docs ref. An existing file wins over a ref so `./dev` can mean a file.
 */
function classifyFrom(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SpecError('missing --from value', 2);
  }
  if (isFullSha(value)) return { kind: 'commit', value: value.toLowerCase() };
  if (/^https?:\/\//i.test(value)) return { kind: 'url', value };
  const resolved = path.resolve(value);
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return { kind: 'file', value: resolved };
    }
  } catch {
    // fall through to ref
  }
  return { kind: 'ref', value };
}

module.exports = {
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  getToken,
  toRawUrl,
  rawSpecUrl,
  apiContentsUrl,
  buildSources,
  fetchFromSources,
  downloadSpec,
  fetchSpecUrl,
  readSpecFile,
  resolveDocsRef,
  classifyFrom,
};