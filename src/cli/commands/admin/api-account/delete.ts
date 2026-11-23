import { printWriteResult } from '../../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../../util';
import { resolveCredentials, GlobalOptions } from '../../../config';
import { CDNProClient } from '../../../../client/CDNProClient';
import { handleError } from '../../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../../option-map';

export const ADMIN_API_ACCOUNT_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerAdminApiAccountDeleteCommand(parent: Command): void {
  registerMappings('admin-api-account', 'delete', ADMIN_API_ACCOUNT_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <id>')
    .description('Delete an API account');
  registerOptionsFromMapping(cmd, ADMIN_API_ACCOUNT_DELETE_OPTIONS);
  cmd.action(async (id: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete API account "${id}"?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.apiAccounts.delete(id, reqOptions);

      printWriteResult({ apiAccountId: id }, globals.output, `API account ${id} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
