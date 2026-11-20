import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildIpRangeList, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { registerMappings } from '../../option-map';

export function registerOriginFastRouteIpCommands(parent: Command): void {
  const cmd = parent
    .command('origin-fast-route-ip')
    .description('List origin fast-route IP ranges (read-only reference data)');

  const listCmd = cmd
    .command('list')
    .description('List origin fast-route IP ranges');

  registerMappings('origin-fast-route-ip', 'list', []);

  listCmd.action(async (opts: Record<string, unknown>, cmd: Command) => {
      try {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const serverInfo = await resolveCredentials(globals);
        const client = new CDNProClient(serverInfo);
        const fmt = globals.output as OutputFormat | undefined;

        const data = await client.geo.originFastRouteIpList();
        const { items, meta } = buildIpRangeList(data);

        const effectiveFmt = fmt ?? (process.stdout.isTTY ? 'table' : 'json');
        if (effectiveFmt === 'table') {
          printTable(items, ['ip', 'version']);
        } else if (effectiveFmt === 'jsonl') {
          printJsonl(items);
        } else {
          printJson(items, meta);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
