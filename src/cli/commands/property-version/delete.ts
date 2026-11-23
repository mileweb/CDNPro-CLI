import { printWriteResult } from '../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../util';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../option-map';

export const PROPERTY_VERSION_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerPropertyVersionDeleteCommand(parent: Command): void {
  registerMappings('property-version', 'delete', PROPERTY_VERSION_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <propertyId> <version>')
    .description('Delete a property version');
  registerOptionsFromMapping(cmd, PROPERTY_VERSION_DELETE_OPTIONS);
  cmd.action(async (propertyId: string, version: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete property "${propertyId}" version ${version}?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.properties.deleteVersion(propertyId, version, reqOptions);

      printWriteResult({ propertyId, version }, globals.output, `Property ${propertyId} version ${version} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
