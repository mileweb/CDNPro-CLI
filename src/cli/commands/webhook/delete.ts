import { printWriteResult } from '../../output';
import { Command } from 'commander';
import { confirmOrAbort } from '../../util';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { OptionMapping, CONFIRM, registerOptionsFromMapping, registerMappings } from '../../option-map';

export const WEBHOOK_DELETE_OPTIONS: OptionMapping[] = [CONFIRM];

interface DeleteOpts {
  confirm?: boolean;
}

export function registerWebhookDeleteCommand(parent: Command): void {
  registerMappings('webhook', 'delete', WEBHOOK_DELETE_OPTIONS);

  const cmd = parent
    .command('delete <id>')
    .description('Delete a webhook');
  registerOptionsFromMapping(cmd, WEBHOOK_DELETE_OPTIONS);
  cmd.action(async (id: string, opts: DeleteOpts, cmdObj: Command) => {
    try {
      await confirmOrAbort(`Delete webhook "${id}"?`, opts.confirm);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.webhooks.delete(id, reqOptions);

      printWriteResult({ webhookId: id }, globals.output, `Webhook ${id} deleted.\n`);
    } catch (err) {
      handleError(err);
    }
  });
}
