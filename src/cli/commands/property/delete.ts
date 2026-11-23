import { printWriteResult } from '../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../util';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../option-map';

export const PROPERTY_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerPropertyDeleteCommand(parent: Command): void {
  registerMappings('property', 'delete', PROPERTY_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <id>')
    .description('Delete a property');
  registerOptionsFromMapping(cmd, PROPERTY_DELETE_OPTIONS);
  cmd.action(async (id: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete property "${id}"?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.properties.delete(id, reqOptions);

      printWriteResult({ propertyId: id }, globals.output, `Property ${id} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
