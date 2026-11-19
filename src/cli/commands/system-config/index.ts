import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, unwrapRawResponse, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { registerMappings } from '../../option-map';

export function registerSystemConfigCommands(parent: Command): void {
  const cmd = parent
    .command('system-config')
    .description('View system configuration (read-only)');

  const getCmd = cmd
    .command('get')
    .description('Get system configuration settings');

  registerMappings('system-config', 'get', []);

  getCmd.action(async (opts: Record<string, unknown>, cmd: Command) => {
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

        const rsp = await client.systemConfigs.get(reqOptions);
        const { data, meta } = unwrapRawResponse(rsp);
        printResult(data, fmt, undefined, meta);
      } catch (err) {
        handleError(err);
      }
    });
}
