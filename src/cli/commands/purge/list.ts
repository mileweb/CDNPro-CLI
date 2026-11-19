import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildMeta, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { resolveListPaging, paginateOffset } from '../../paginate';
import {
  OptionMapping,
  SORT_OPTIONS,
  PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
} from '../../option-map';

export const PURGE_LIST_OPTIONS: OptionMapping[] = [
  { flag: '--from <date>',             target: 'query', param: 'startDate',      description: 'Start date (RFC 3339 UTC)' },
  { flag: '--to <date>',               target: 'query', param: 'endDate',        description: 'End date (RFC 3339 UTC)' },
  { flag: '--target <env>',            target: 'query', param: 'target',         description: 'Filter by environment: staging | production' },
  { flag: '--action <action>',         target: 'query', param: 'action',         description: 'Filter by purge action: invalidate | delete' },
  { flag: '--search <term>',           target: 'query', param: 'search',         description: 'Match on hostname or purge task ID' },
  { flag: '--max-success-rate <rate>', target: 'query', param: 'maxSuccessRate', description: 'Filter by max success rate (0-1)' },
  ...SORT_OPTIONS,
  ...PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerPurgeListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List purge requests');

  registerOptionsFromMapping(cmd, PURGE_LIST_OPTIONS);
  registerMappings('purge', 'list', PURGE_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, PURGE_LIST_OPTIONS, globals);

      const paging = resolveListPaging(opts, {
        resource: 'purge',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.purges.list({ ...query, limit, offset }, reqOptions),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.purges.list({ ...query, limit, offset }, reqOptions);
      const { items, meta } = buildMeta(data);
      meta.limit = limit;
      meta.offset = offset;

      const effectiveFmt = fmt ?? (process.stdout.isTTY ? 'table' : 'json');
      if (effectiveFmt === 'table') {
        printTable(items);
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
