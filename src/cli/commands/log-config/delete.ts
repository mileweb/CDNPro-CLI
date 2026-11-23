import { printWriteResult } from '../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../util';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../option-map';

export const LOG_CONFIG_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerLogConfigDeleteCommand(parent: Command): void {
  registerMappings('log-config', 'delete', LOG_CONFIG_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <id>')
    .description('Delete a log delivery configuration');
  registerOptionsFromMapping(cmd, LOG_CONFIG_DELETE_OPTIONS);
  cmd.action(async (id: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete log config "${id}"?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.logConfigs.delete(id, reqOptions);

      printWriteResult({ logConfigId: id }, globals.output, `Log config ${id} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
