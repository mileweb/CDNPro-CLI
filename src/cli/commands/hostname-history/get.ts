import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import {
  OptionMapping,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
} from '../../option-map';

export const HOSTNAME_HISTORY_GET_OPTIONS: OptionMapping[] = [
  { flag: '--from <date>',   target: 'query', param: 'startdate',   description: 'Start date (RFC 3339 UTC)' },
  { flag: '--to <date>',     target: 'query', param: 'enddate',     description: 'End date (RFC 3339 UTC)' },
  { flag: '--target <target>', target: 'query', param: 'target', description: 'Filter by deployment target: staging | production | all' },
];

interface GetOpts {
  from?: string;
  to?: string;
  target?: string;
}

export function registerHostnameHistoryGetCommand(parent: Command): void {
  registerMappings('hostname-history', 'get', HOSTNAME_HISTORY_GET_OPTIONS);

  const cmd = parent
    .command('get <hostname>')
    .description('Get deployment history for a specific hostname');
  registerOptionsFromMapping(cmd, HOSTNAME_HISTORY_GET_OPTIONS);
  cmd.action(async (hostname: string, opts: GetOpts, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const { query } = buildRequestFromMapping(
        opts as Record<string, unknown>,
        HOSTNAME_HISTORY_GET_OPTIONS,
        globals,
      );
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);
      const fmt = globals.output as OutputFormat | undefined;

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const data = await client.hostnameHistory.get(hostname, query, reqOptions);
      printResult(data, fmt);
    } catch (err) {
      handleError(err);
    }
  });
}
