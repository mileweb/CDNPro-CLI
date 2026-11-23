import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printCreateSuccess, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { CliError } from '../../errors';
import { readBodyFile, enrichWithLocationId, checkRequiredOption, validateRequestOrThrow, parseIntegerOption } from "../../util";
import { waitForTask, parseWaitOptions } from '../../wait';
import { getExampleBody } from '../../../schema/synthesize';
import {
  OptionMapping,
  FILE_EXAMPLE,
  registerOptionsFromMapping,
  checkFileConflicts,
  registerMappings,
} from '../../option-map';

export const VALIDATION_CREATE_OPTIONS: OptionMapping[] = [
  { flag: '--property-id <id>', target: 'body', param: 'propertyId', description: 'Property ID to validate' },
  { flag: '--property-version <version>', target: 'body', param: 'version', description: 'Property version to validate' },
  { flag: '--name <name>', target: 'body', param: 'name', description: 'Friendly name for the validation task' },
  { flag: '--webhook <id>', target: 'body', param: 'webhook', description: 'Webhook ID to call on task completion' },
  ...FILE_EXAMPLE,
  { flag: '--wait', target: 'cli-only', param: null, description: 'Poll until validation completes', boolean: true },
  { flag: '--timeout <seconds>', target: 'cli-only', param: null, description: 'Max wait time [default: 300]' },
  { flag: '--poll-interval <seconds>', target: 'cli-only', param: null, description: 'Poll frequency [default: 10]' },
];

interface CreateOpts {
  propertyId?: string;
  propertyVersion?: string;
  name?: string;
  webhook?: string;
  file?: string;
  wait?: boolean;
  timeout?: string;
  pollInterval?: string;
  example?: boolean;
}

export function registerValidationCreateCommand(parent: Command): void {
  const cmd = parent
    .command('create')
    .description('Create a validation task for a property version (from flags or a JSON body file)');

  registerOptionsFromMapping(cmd, VALIDATION_CREATE_OPTIONS);
  registerMappings('validation', 'create', VALIDATION_CREATE_OPTIONS);

  cmd.action(async (opts: CreateOpts, cmdObj: Command) => {
    try {
      if (opts.example) {
        const example = getExampleBody('/cdn/validations', 'post');
        process.stdout.write(JSON.stringify(example, null, 2) + '\n');
        return;
      }

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      let body: unknown;

      if (opts.file) {
        checkFileConflicts(opts, VALIDATION_CREATE_OPTIONS);
        body = readBodyFile(opts.file);
      } else {
        checkRequiredOption(opts.propertyId, '--property-id <id>');
        checkRequiredOption(opts.propertyVersion, '--property-version <version>');

        const taskBody: Record<string, unknown> = {
          propertyId: opts.propertyId,
          version: parseIntegerOption(opts.propertyVersion, '--property-version'),
        };
        if (opts.name) taskBody['name'] = opts.name;
        if (opts.webhook) taskBody['webhook'] = opts.webhook;
        body = taskBody;
      }

      validateRequestOrThrow(
        '/cdn/validations',
        'post',
        body,
        'cdnpro validation create --example',
        globals.output,
        VALIDATION_CREATE_OPTIONS,
      );

      // Validate --timeout/--poll-interval before the request: a bad value must not
      // surface after the task has already been created.
      const waitOpts = opts.wait ? parseWaitOptions(opts, { timeout: 300, pollInterval: 10 }) : undefined;

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const raw = await client.validations.create(body, { ...reqOptions, raw: true }) as { obj: Record<string, unknown>; ctx: { _res: { headers: Record<string, string | string[] | undefined> } } };
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

        printCreateSuccess('Validation', 'validationId', String(taskId), fmt);

        await waitForTask(
          (id) => client.validations.get(id, pollReqOptions) as Promise<unknown>,
          String(taskId),
          { taskType: 'validation', ...waitOpts!, outputFormat: fmt },
        );
        return;
      }

      printCreateSuccess('Validation', 'validationId', id, fmt);
    } catch (err) {
      handleError(err);
    }
  });
}
