import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printCreateSuccess, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { CliError } from '../../errors';
import { readBodyFile, enrichWithLocationId, checkRequiredOption, validateRequestOrThrow } from '../../util';
import { waitForTask, parseWaitOptions } from '../../wait';
import { getNamedSpecExample } from '../../../schema/loader';
import { getExampleBody } from '../../../schema/synthesize';
import {
  OptionMapping,
  FILE_EXAMPLE,
  registerOptionsFromMapping,
  checkFileConflicts,
  registerMappings,
} from '../../option-map';

export const PURGE_CREATE_OPTIONS: OptionMapping[] = [
  { flag: '--target <env>',            target: 'body',     param: 'target',          description: 'Environment to purge: staging | production', required: true },
  { flag: '--url <url>',               target: 'body',     param: 'fileUrls',         description: 'Exact file URL to purge; repeatable', repeatable: true },
  { flag: '--dir <url>',               target: 'body',     param: 'dirUrls',          description: 'Directory URL (supports * / **); repeatable; max 20', repeatable: true },
  { flag: '--regex <pattern>',         target: 'body',     param: 'regexPatterns',    description: 'Regex pattern (scheme://hostname/...); repeatable; max 2', repeatable: true },
  { flag: '--header <name:value>',     target: 'body',     param: 'fileHeaders',      description: 'Request header for cache-key disambiguation; repeatable', repeatable: true },
  { flag: '--action <action>',         target: 'body',     param: 'action',           description: 'Purge action: delete | invalidate [default: invalidate]' },
  { flag: '--name <description>',      target: 'body',     param: 'name',             description: 'Friendly name for the purge request' },
  { flag: '--webhook <id>',            target: 'body',     param: 'webhook',         description: 'Webhook ID to call on completion' },
  ...FILE_EXAMPLE,
  { flag: '--wait',                    target: 'cli-only', param: null,               description: 'Poll until purge completes', boolean: true },
  { flag: '--timeout <seconds>',       target: 'cli-only', param: null,               description: 'Max wait time [default: 600]' },
  { flag: '--poll-interval <seconds>', target: 'cli-only', param: null,               description: 'Poll frequency [default: 30]' },
];

interface CreateOpts {
  target?: string;
  url?: string[];
  dir?: string[];
  regex?: string[];
  header?: string[];
  action?: string;
  name?: string;
  webhook?: string;
  file?: string;
  wait?: boolean;
  timeout?: string;
  pollInterval?: string;
  example?: boolean;
}

export function registerPurgeCreateCommand(parent: Command): void {
  registerMappings('purge', 'create', PURGE_CREATE_OPTIONS);

  const cmd = parent.command('create')
    .description('Create a purge request');
  registerOptionsFromMapping(cmd, PURGE_CREATE_OPTIONS);
  cmd.action(async (opts: CreateOpts, cmdObj: Command) => {
    try {
      if (opts.example) {
        const example =
          getNamedSpecExample('/cdn/purges', 'post', 'Purge specific files') ??
          getExampleBody('/cdn/purges', 'post');
        process.stdout.write(JSON.stringify(example, null, 2) + '\n');
        return;
      }

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      let body: unknown;

      if (opts.file) {
        checkFileConflicts(opts, PURGE_CREATE_OPTIONS);
        body = readBodyFile(opts.file);
      } else {
        checkRequiredOption(opts.target, '--target <env>');

        const urls = opts.url ?? [];
        const dirs = opts.dir ?? [];
        const regexes = opts.regex ?? [];

        if (urls.length === 0 && dirs.length === 0 && regexes.length === 0) {
          throw new CliError(
            'VALIDATION',
            'At least one of --url, --dir, or --regex is required (or use --file)',
          );
        }

        if (dirs.length > 20) {
          throw new CliError('VALIDATION', `--dir accepts at most 20 entries, got ${dirs.length}`);
        }
        if (regexes.length > 2) {
          throw new CliError('VALIDATION', `--regex accepts at most 2 entries, got ${regexes.length}`);
        }

        const action = (opts.action ?? 'invalidate').toLowerCase();
        if (action !== 'delete' && action !== 'invalidate') {
          throw new CliError('VALIDATION', `--action must be "delete" or "invalidate", got: ${opts.action}`);
        }
        if ((opts.header ?? []).length > 0 && urls.length === 0) {
          throw new CliError('VALIDATION', '--header requires at least one --url');
        }

        const purgeBody: Record<string, unknown> = {
          target: opts.target,
        };

        if (urls.length > 0) purgeBody['fileUrls'] = urls;
        if ((opts.header ?? []).length > 0) {
          purgeBody['fileHeaders'] = (opts.header ?? []).map((h) => {
            const colonIdx = h.indexOf(':');
            if (colonIdx < 1) {
              throw new CliError('VALIDATION', `--header "${h}" must be in name:value format`);
            }
            return { name: h.slice(0, colonIdx).trim(), value: h.slice(colonIdx + 1).trim() };
          });
        }
        if (dirs.length > 0) purgeBody['dirUrls'] = dirs;
        if (regexes.length > 0) purgeBody['regexPatterns'] = regexes;
        purgeBody['action'] = action;
        if (opts.name) purgeBody['name'] = opts.name;
        if (opts.webhook) purgeBody['webhook'] = opts.webhook;

        body = purgeBody;
      }

      validateRequestOrThrow(
        '/cdn/purges',
        'post',
        body,
        'cdnpro purge create --example',
        globals.output,
        PURGE_CREATE_OPTIONS,
      );

      // Validate --timeout/--poll-interval before the request: a bad value must not
      // surface after the task has already been created.
      const waitOpts = opts.wait ? parseWaitOptions(opts, { timeout: 600, pollInterval: 30 }) : undefined;

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const raw = await client.purges.create(body, { ...reqOptions, raw: true }) as { obj: Record<string, unknown>; ctx: { _res: { headers: Record<string, string | string[] | undefined> } } };
      const data = enrichWithLocationId(raw);
      const id = data['id'] as string;

      if (opts.wait) {
        const taskId = data['id'] as string | undefined;
        if (!taskId) throw new CliError('ERROR', 'Server did not return a task ID; cannot poll');

        // Polling must carry the same On-Behalf-Of as the create call, or a reseller
        // would poll their own account and fail after a successful create.
        const pollReqOptions = {
          ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
          verbose: globals.verbose ?? 0,
        };

        printCreateSuccess('Purge', 'purgeId', String(taskId), fmt);

        await waitForTask(
          (id) => client.purges.get(id, pollReqOptions) as Promise<unknown>,
          String(taskId),
          { taskType: 'purge', ...waitOpts!, outputFormat: fmt },
        );
        return;
      }

      printCreateSuccess('Purge', 'purgeId', id, fmt);
    } catch (err) {
      handleError(err);
    }
  });
}
