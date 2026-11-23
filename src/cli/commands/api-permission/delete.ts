import { printWriteResult } from '../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../util';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../option-map';

export const API_PERMISSION_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerApiPermissionDeleteCommand(parent: Command): void {
  registerMappings('api-permission', 'delete', API_PERMISSION_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <id>')
    .description('Delete an API permission set');
  registerOptionsFromMapping(cmd, API_PERMISSION_DELETE_OPTIONS);
  cmd.action(async (id: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete API permission "${id}"?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.apiPermissions.delete(id, reqOptions);

      printWriteResult({ apiPermissionId: id }, globals.output, `API permission ${id} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
