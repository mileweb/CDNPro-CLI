import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../../config';
import { CDNProClient } from '../../../../client/CDNProClient';
import { printResult, OutputFormat } from '../../../output';
import { handleError } from '../../../errors';
import {
  OptionMapping,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
} from '../../../option-map';

export const APICALL_COUNTS_OPTIONS: OptionMapping[] = [
  { flag: '--from <date>',    target: 'query', param: 'startdate',   description: 'Start of the time window (RFC 3339 UTC); defaults to 24h ago' },
  { flag: '--to <date>',      target: 'query', param: 'enddate',     description: 'End of the time window (RFC 3339 UTC); defaults to now' },
  { flag: '--path <prefix>',  target: 'query', param: 'path',        description: 'Count calls whose path starts with this prefix: /cdn/ | /ngadmin/ | /hdt/' },
  { flag: '--by-me-only',     target: 'query', param: 'by_me_only',  description: 'Count only calls made directly by the calling customer', boolean: true },
];

export function registerAdminApiCallCountsCommand(parent: Command): void {
  const cmd = parent
    .command('counts')
    .description('Count API calls matching a time window and optional path prefix');

  registerOptionsFromMapping(cmd, APICALL_COUNTS_OPTIONS);
  registerMappings('admin-apicall', 'counts', APICALL_COUNTS_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions: mappedReqOptions } = buildRequestFromMapping(opts, APICALL_COUNTS_OPTIONS);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...mappedReqOptions,
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const data = await client.apiCalls.counts(query, reqOptions);
      printResult(data, fmt);
    } catch (err) {
      handleError(err);
    }
  });
}
