import { printWriteResult } from '../../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../../util';
import { resolveCredentials, GlobalOptions } from '../../../config';
import { CDNProClient } from '../../../../client/CDNProClient';
import { handleError } from '../../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../../option-map';

export const ADMIN_CONTACT_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerAdminContactDeleteCommand(parent: Command): void {
  registerMappings('admin-contact', 'delete', ADMIN_CONTACT_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <id>')
    .description('Delete a contact');
  registerOptionsFromMapping(cmd, ADMIN_CONTACT_DELETE_OPTIONS);
  cmd.action(async (id: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete contact "${id}"?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.contacts.delete(id, reqOptions);

      printWriteResult({ contactId: id }, globals.output, `Contact ${id} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
