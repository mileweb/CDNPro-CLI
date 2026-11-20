import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { OptionMapping, registerMappings } from '../../option-map';

// The endpoint declares no query parameters.
export const PREFETCH_TOKENS_OPTIONS: OptionMapping[] = [];

export function registerPrefetchTokensCommand(parent: Command): void {
  const cmd = parent
    .command('tokens')
    .description('Get prefetch token quota information');

  registerMappings('prefetch', 'tokens', PREFETCH_TOKENS_OPTIONS);

  cmd.action(async (_opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);
      const fmt = globals.output as OutputFormat | undefined;

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const data = await client.prefetches.tokens({}, reqOptions);
      printResult(data, fmt);
    } catch (err) {
      handleError(err);
    }
  });
}
