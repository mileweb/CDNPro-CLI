import { printWriteResult } from '../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../util';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../option-map';

export const CERT_VERSION_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerCertVersionDeleteCommand(parent: Command): void {
  registerMappings('cert-version', 'delete', CERT_VERSION_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <certificateId> <version>')
    .description('Delete a specific certificate version');
  registerOptionsFromMapping(cmd, CERT_VERSION_DELETE_OPTIONS);
  cmd.action(async (certificateId: string, version: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete certificate "${certificateId}" version ${version}?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.certificates.deleteVersion(certificateId, version, reqOptions);

      printWriteResult({ certificateId, version }, globals.output, `Certificate ${certificateId} version ${version} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
