import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, unwrapRawResponse, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { registerMappings } from '../../option-map';

export function registerLogConfigGetCommand(parent: Command): void {
  registerMappings('log-config', 'get', []);

  parent
    .command('get <id>')
    .description('Get a log delivery configuration by ID')
    .action(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
      try {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const serverInfo = await resolveCredentials(globals);
        const client = new CDNProClient(serverInfo);
        const fmt = globals.output as OutputFormat | undefined;

        const reqOptions = {
          ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
          ...(globals.verbose ? { verbose: globals.verbose } : {}),
          raw: true,
        };

        const rsp = await client.logConfigs.get(id, reqOptions);
        const { data, meta } = unwrapRawResponse(rsp);
        printResult(data, fmt, undefined, meta);
      } catch (err) {
        handleError(err);
      }
    });
}
