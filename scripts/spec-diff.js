#!/usr/bin/env node
'use strict';

/**
 * Enumerates changes between the pinned baseline (openapi.lock.json) and a
 * candidate spec, using oasdiff. This is a thin wrapper: it fetches and
 * verifies the two documents and invokes `oasdiff changelog`. It performs no
 * filtering, deduplication, summarization, or CLI-impact classification —
 * that judgment belongs to the agent or maintainer reading the output.
 *
 * Usage:
 *   node scripts/spec-diff.js --from dev
 *   node scripts/spec-diff.js --from master --format markdown
 *   node scripts/spec-diff.js --from https://…/openapi.json
 *   node scripts/spec-diff.js --from ./candidate.json
 *   node scripts/spec-diff.js --from <40-hex>
 *
 *   --from <ref|url|file|sha>  required; docs branch/tag, full commit, URL or file
 *   --format <fmt>             oasdiff format: json (default), markdown, text, yaml, html…
 *   --fail-on <ERR|WARN|INFO>  passed to oasdiff; exits 1 when that level is present
 *   --level <ERR|WARN|INFO>    passed to oasdiff; hides lower levels
 *   --auto-upgrade             passed to oasdiff (cross-OpenAPI-version comparison)
 *   --oasdiff <path>           override binary discovery (or set OASDIFF_BIN)
 *   --keep                     keep temp baseline/candidate files for inspection
 *
 * stdout is exactly oasdiff's payload; provenance goes to stderr.
 * Exit codes: 0 OK; 1 from --fail-on; 2 wrapper/usage/oasdiff error.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  SPEC_FILE,
  SpecError,
  readLock,
  sha256File,
  shortSha,
  describeError,
} = require('./lib/spec-common');
const {
  downloadSpec,
  fetchSpecUrl,
  readSpecFile,
  resolveDocsRef,
  classifyFrom,
} = require('./lib/spec-source');

const USAGE = `Usage: node scripts/spec-diff.js --from <docs-ref|url|file|40-hex> [options]

  --from <value>             required; docs branch/tag, full commit SHA, URL, or file
  --format <fmt>             oasdiff format: json (default), markdown, text, yaml, html…
  --fail-on <ERR|WARN|INFO>  exit 1 when oasdiff reports that level
  --level <ERR|WARN|INFO>    hide changes below this level
  --auto-upgrade             compare across OpenAPI versions
  --oasdiff <path>           oasdiff binary (or set OASDIFF_BIN)
  --keep                     keep the downloaded baseline/candidate files`;

const log = (msg) => console.error(`[spec-diff] ${msg}`);
const warn = (msg) => console.error(`[spec-diff] warning: ${msg}`);
function fail(message, code = 2) {
  console.error(`[spec-diff] error: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    from: null,
    format: 'json',
    failOn: null,
    level: null,
    autoUpgrade: false,
    oasdiff: null,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (flag) => {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`, 2);
      return value;
    };
    switch (arg) {
      case '--from': opts.from = takeValue('--from'); break;
      case '--format':
      case '-f': opts.format = takeValue(arg); break;
      case '--fail-on': opts.failOn = takeValue('--fail-on'); break;
      case '--level': opts.level = takeValue('--level'); break;
      case '--oasdiff': opts.oasdiff = takeValue('--oasdiff'); break;
      case '--auto-upgrade': opts.autoUpgrade = true; break;
      case '--keep': opts.keep = true; break;
      case '-h':
      case '--help': console.log(USAGE); process.exit(0); break;
      default: fail(`unknown argument: ${arg}\n\n${USAGE}`, 2);
    }
  }
  if (!opts.from) fail(`--from is required\n\n${USAGE}`, 2);
  return opts;
}

function findOasdiff(explicit) {
  const candidates = explicit
    ? [explicit]
    : process.env.OASDIFF_BIN
      ? [process.env.OASDIFF_BIN]
      : ['oasdiff', 'oasdiff.exe'];

  const tried = [];
  for (const bin of candidates) {
    const res = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (!res.error && res.status === 0) {
      const match = `${res.stdout || ''} ${res.stderr || ''}`.match(/(\d+\.\d+\.\d+)/);
      return { bin, version: match ? match[1] : 'unknown' };
    }
    tried.push(`${bin}: ${res.error ? describeError(res.error) : `exit ${res.status}`}`);
  }

  throw new SpecError(
    'oasdiff was not found or is not runnable.\n' +
      `  Tried: ${tried.join('; ')}\n` +
      '  Install v1.41.0 from https://github.com/oasdiff/oasdiff/releases/tag/v1.41.0\n' +
      '  or set OASDIFF_BIN to an existing oasdiff binary.',
    2,
  );
}

function checkOasdiffVersion(version) {
  if (version === 'unknown') {
    warn('could not determine the oasdiff version; continuing');
    return;
  }
  const [major, minor] = version.split('.').map(Number);
  if (major !== 1) {
    throw new SpecError(`oasdiff ${version} is not supported; this workflow targets 1.41.x.`, 2);
  }
  if (minor < 41) {
    throw new SpecError(`oasdiff ${version} is too old; install >= 1.41.0.`, 2);
  }
  if (minor !== 41) {
    warn(`oasdiff ${version} differs from the tested 1.41.x; JSON fields may vary.`);
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cdnpro-spec-diff-'));
}

async function resolveBaseline(lock, tempDir) {
  if (fs.existsSync(SPEC_FILE) && sha256File(SPEC_FILE) === lock.spec.sha256) {
    return {
      path: SPEC_FILE,
      commit: lock.source.commit,
      sha256: lock.spec.sha256,
      stats: { paths: lock.spec.paths, operations: lock.spec.operations },
      origin: 'local openapi.json',
    };
  }

  const result = await downloadSpec({
    repo: lock.source.repo,
    commit: lock.source.commit,
    specPath: lock.source.path,
  });
  if (result.sha256 !== lock.spec.sha256) {
    throw new SpecError(
      `downloaded baseline does not match the lock: expected ${lock.spec.sha256}, got ${result.sha256}`,
    );
  }
  const file = path.join(tempDir, 'baseline.json');
  fs.writeFileSync(file, result.buffer);
  return {
    path: file,
    commit: lock.source.commit,
    sha256: result.sha256,
    stats: result.stats,
    origin: 'downloaded from lock',
  };
}

async function resolveCandidate(from, lock, tempDir) {
  const source = classifyFrom(from);

  if (source.kind === 'file') {
    const result = readSpecFile(source.value);
    return {
      path: source.value,
      label: source.value,
      sha256: result.sha256,
      stats: result.stats,
      via: 'file',
    };
  }

  if (source.kind === 'url') {
    const result = await fetchSpecUrl(source.value);
    const file = path.join(tempDir, `candidate-${result.sha256.slice(0, 12)}.json`);
    fs.writeFileSync(file, result.buffer);
    return {
      path: file,
      label: source.value,
      sha256: result.sha256,
      stats: result.stats,
      via: 'url',
    };
  }

  let commit = source.value;
  let via = 'sha';
  if (source.kind === 'ref') {
    const resolved = await resolveDocsRef(source.value, { repo: lock.source.repo });
    commit = resolved.commit;
    via = resolved.via;
  }

  const result = await downloadSpec({
    repo: lock.source.repo,
    commit,
    specPath: lock.source.path,
  });
  const file = path.join(tempDir, `candidate-${result.sha256.slice(0, 12)}.json`);
  fs.writeFileSync(file, result.buffer);
  return {
    path: file,
    label: source.kind === 'ref' ? `${source.value} -> ${shortSha(commit)}` : shortSha(commit),
    commit,
    sha256: result.sha256,
    stats: result.stats,
    via,
  };
}

async function main(argv) {
  const opts = parseArgs(argv);
  const lock = readLock();

  // Fail fast on a missing/incompatible oasdiff before doing any network work.
  const tool = findOasdiff(opts.oasdiff);
  checkOasdiffVersion(tool.version);

  let tempDir = null;
  let exitCode = 0;

  try {
    tempDir = makeTempDir();
    const baseline = await resolveBaseline(lock, tempDir);
    const candidate = await resolveCandidate(opts.from, lock, tempDir);

    log(
      `baseline: lock ${shortSha(baseline.commit)} sha256 ${baseline.sha256.slice(0, 12)}… ` +
        `(${baseline.stats.paths} paths, ${baseline.stats.operations} ops; ${baseline.origin})`,
    );
    log(
      `candidate: ${candidate.label} sha256 ${candidate.sha256.slice(0, 12)}… ` +
        `(${candidate.stats.paths} paths, ${candidate.stats.operations} ops; via ${candidate.via})`,
    );
    log(`oasdiff ${tool.version}: changelog --format ${opts.format}`);

    const args = ['changelog', '--format', opts.format];
    if (opts.failOn) args.push('--fail-on', opts.failOn);
    if (opts.level) args.push('--level', opts.level);
    if (opts.autoUpgrade) args.push('--auto-upgrade');
    args.push(baseline.path, candidate.path);

    const res = spawnSync(tool.bin, args, { stdio: 'inherit' });
    if (res.error) {
      throw new SpecError(`failed to run oasdiff: ${describeError(res.error)}`, 2);
    }
    if (res.status === 1) {
      exitCode = 1; // --fail-on threshold reached
    } else if (res.status !== 0) {
      throw new SpecError(`oasdiff exited with status ${res.status}`, 2);
    }
  } finally {
    if (tempDir) {
      if (opts.keep) log(`kept temp files: ${tempDir}`);
      else fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return exitCode;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof SpecError) fail(err.message, err.exitCode);
    fail(describeError(err));
  });