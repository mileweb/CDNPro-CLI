import Conf from 'conf';
import * as fs from 'fs';
import * as readline from 'readline';
import { ServerInfo } from '../client/ApiCore';
import { CliError } from './errors';
import { isKeychainAvailable, warnKeychainUnavailable, getSecret, setSecret, deleteSecret } from './keychain';

/** Shape stored in the conf JSON file — never contains the secret key. */
export interface StoredProfile {
  host: string;
  user: string;
  /** Present only when keychain is unavailable and secret must be stored as fallback. */
  secretKey?: string;
}

/** Fully-resolved in-memory profile with the secret key. Never persisted. */
export interface Profile {
  host: string;
  user: string;
  secretKey: string;
}

export interface CdnProConfig extends Record<string, unknown> {
  defaultProfile: string;
  profiles: Record<string, StoredProfile>;
}

export interface GlobalOptions {
  profile?: string;
  host?: string;
  user?: string;
  secretKey?: string;
  output?: string;
  noColor?: boolean;
  verbose?: number;
  onBehalfOf?: string;
}

// conf@9 stores data under the "cdnpro-nodejs" project directory:
// ~/.config/cdnpro-nodejs/config.json (Linux), ~/Library/Preferences/cdnpro-nodejs/config.json
// (macOS), or %APPDATA%\cdnpro-nodejs\Config\config.json (Windows).
const store = new Conf<CdnProConfig>({
  projectName: 'cdnpro',
  defaults: {
    defaultProfile: 'default',
    profiles: {},
  },
});

export async function resolveCredentials(globalOpts: GlobalOptions): Promise<ServerInfo> {
  // 1. Explicit CLI flags (all three required together). A partial set is an
  //    error: silently falling back to a saved profile would run the command
  //    against a different account or host than the caller asked for, and
  //    merging would send the profile's user and signature to an arbitrary host.
  const flagCount = [globalOpts.host, globalOpts.user, globalOpts.secretKey].filter(Boolean).length;
  if (flagCount === 3) {
    return {
      host: globalOpts.host!,
      user: globalOpts.user!,
      secretKey: globalOpts.secretKey!,
    };
  }
  if (flagCount > 0) {
    throw new CliError(
      'CONFIG_ERROR',
      '--host, --user, and --secret-key must be supplied together; to use a saved profile, omit all three.',
    );
  }

  // 2. Environment variables (all three required together). An explicit
  //    --profile is a more specific request than ambient environment, so it wins.
  const envCount = ['CDNPRO_HOST', 'CDNPRO_USER', 'CDNPRO_SECRETKEY'].filter((k) => process.env[k]).length;
  if (globalOpts.profile === undefined) {
    if (envCount === 3) {
      return {
        host: process.env['CDNPRO_HOST']!,
        user: process.env['CDNPRO_USER']!,
        secretKey: process.env['CDNPRO_SECRETKEY']!,
      };
    }
    if (envCount > 0) {
      process.stderr.write(
        'Warning: CDNPRO_HOST, CDNPRO_USER and CDNPRO_SECRETKEY must all be set to be used; ' +
          'ignoring the partial set and falling back to a saved profile.\n',
      );
    }
  }

  // 3. Profile: CLI flag > env var > stored default
  const profileName =
    globalOpts.profile ??
    process.env['CDNPRO_PROFILE'] ??
    store.get('defaultProfile');

  const profiles = store.get('profiles') ?? {};
  const profile = profiles[profileName];

  if (profile) {
    const secretKey =
      (await getSecret(profileName)) ??
      profile.secretKey;

    if (!secretKey) {
      throw new CliError(
        'CONFIG_ERROR',
        `Keychain entry missing for profile "${profileName}". Run \`cdnpro auth login -p ${profileName}\` to re-save credentials.`,
      );
    }

    return {
      host: profile.host,
      user: profile.user,
      secretKey,
    };
  }

  throw new CliError(
    'CONFIG_ERROR',
    'No credentials found. Run `cdnpro auth login` to set up a profile.',
  );
}

export function getProfile(name: string): StoredProfile | undefined {
  const profiles = store.get('profiles') ?? {};
  return profiles[name];
}

export async function saveProfile(name: string, profile: Profile): Promise<void> {
  const profiles = store.get('profiles') ?? {};

  if (await isKeychainAvailable()) {
    await setSecret(name, profile.secretKey);
    profiles[name] = { host: profile.host, user: profile.user };
  } else {
    warnKeychainUnavailable();
    // Drop any keychain entry left by an earlier save: resolveCredentials prefers
    // the keychain, so a stale one would shadow the secret saved here.
    await deleteSecret(name);
    profiles[name] = { host: profile.host, user: profile.user, secretKey: profile.secretKey };
  }

  store.set('profiles', profiles);

  // The file may now hold a plaintext secret; keep it owner-only. conf offers no
  // file-mode option and atomically preserves the mode of an existing file, so
  // setting it once is enough. (Windows ignores POSIX modes.)
  if (profiles[name].secretKey !== undefined && process.platform !== 'win32') {
    try {
      fs.chmodSync(store.path, 0o600);
    } catch {
      process.stderr.write(`Warning: could not restrict permissions on ${store.path}; chmod it to 600.\n`);
    }
  }
}

export async function deleteProfile(name: string): Promise<void> {
  await deleteSecret(name);
  const profiles = store.get('profiles') ?? {};
  delete profiles[name];
  store.set('profiles', profiles);
}

export function listProfiles(): Record<string, StoredProfile> {
  return store.get('profiles') ?? {};
}

export function getDefaultProfile(): string {
  return store.get('defaultProfile') ?? 'default';
}

export function setDefaultProfile(name: string): void {
  store.set('defaultProfile', name);
}

/**
 * readline and raw-mode keypress capture leave stdin referenced. An interactive
 * terminal — Git Bash included — never sends EOF, so the process stays running
 * after the answers are in and later keystrokes never reach the shell.
 * resume() does not undo unref(), so each new prompt must ref() again.
 */
function releaseStdin(): void {
  const stdin = process.stdin as NodeJS.ReadStream;
  if (typeof stdin.setRawMode === 'function' && stdin.isRaw) {
    stdin.setRawMode(false);
  }
  stdin.pause();
  stdin.unref();
}

/**
 * Prompt for input.
 * - silent=true  : mask typed characters with '*' (for secret keys)
 * - defaultValue : shown as [default] in the prompt; returned when the user presses Enter with no input
 */
export function promptInput(question: string, silent = false, defaultValue?: string): Promise<string> {
  const stdin = process.stdin as NodeJS.ReadStream;
  stdin.ref();
  stdin.resume();

  const displayQuestion = defaultValue
    ? `${question} [${defaultValue}]: `
    : `${question}: `;

  return new Promise((resolve) => {
    if (silent) {
      process.stdout.write(displayQuestion);

      const isTTY = stdin.isTTY;

      if (isTTY) {
        // TTY mode: intercept keypresses and echo '*' for each character typed.
        readline.emitKeypressEvents(stdin);
        stdin.setRawMode!(true);

        let answer = '';

        const onKeypress = (_char: string, key: readline.Key) => {
          if (key.name === 'return' || key.name === 'enter') {
            stdin.removeListener('keypress', onKeypress);
            process.stdout.write('\n');
            releaseStdin();
            resolve(answer);
          } else if (key.name === 'backspace') {
            if (answer.length > 0) {
              answer = answer.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else if (key.ctrl && key.name === 'c') {
            if (typeof stdin.setRawMode === 'function' && stdin.isRaw) {
              stdin.setRawMode(false);
            }
            process.exit(0);
          } else if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
            answer += key.sequence;
            process.stdout.write('*');
          }
        };

        stdin.on('keypress', onKeypress);
      } else {
        // Non-TTY (piped input, or Git Bash when Node does not see a console):
        // read silently without echo.
        const rl = readline.createInterface({ input: stdin, terminal: false });
        rl.once('line', (line) => {
          process.stdout.write('\n');
          rl.close();
          releaseStdin();
          resolve(line);
        });
      }
    } else {
      const rl = readline.createInterface({
        input: stdin,
        output: process.stdout,
      });
      rl.question(displayQuestion, (answer) => {
        rl.close();
        releaseStdin();
        resolve(answer.trim() ? answer : (defaultValue ?? answer));
      });
    }
  });
}
