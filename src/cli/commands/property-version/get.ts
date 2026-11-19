import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, unwrapRawResponse, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { registerMappings } from '../../option-map';

export function registerPropertyVersionGetCommand(parent: Command): void {
  registerMappings('property-version', 'get', []);

  parent
    .command('get <propertyId> <version>')
    .description('Get a specific version of a property')
    .action(async (propertyId: string, version: string, _opts: unknown, cmd: Command) => {
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

        const rsp = await client.properties.getVersion(propertyId, version, reqOptions);
        const { data, meta } = unwrapRawResponse(rsp);
        printResult(data, fmt, undefined, meta);
      } catch (err) {
        handleError(err);
      }
    });
}
