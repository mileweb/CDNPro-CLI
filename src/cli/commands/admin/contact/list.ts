import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../../config';
import { CDNProClient } from '../../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildMeta, OutputFormat } from '../../../output';
import { handleError } from '../../../errors';
import { resolveListPaging, paginateOffset } from '../../../paginate';
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
} from '../../../option-map';

export const CONTACT_LIST_OPTIONS: OptionMapping[] = [
  { flag: '--search <term>', target: 'query', param: 'search',   description: 'Keyword search' },
  { flag: '--ids <id,...>',  target: 'query', param: 'ids',      description: 'Comma-separated contact IDs to filter' },
  { flag: '--status <status>', target: 'query', param: 'status', description: 'Filter by status: active | suspended | pending' },
  { flag: '--is-master',     target: 'query', param: 'isMaster', description: 'Filter to master users only', boolean: true },
  ...SORT_OPTIONS,
  ...PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerAdminContactListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List contacts');

  registerOptionsFromMapping(cmd, CONTACT_LIST_OPTIONS);
  registerMappings('admin-contact', 'list', CONTACT_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, CONTACT_LIST_OPTIONS);

      const paging = resolveListPaging(opts, {
        resource: 'admin-contact',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.contacts.list({ ...query, limit, offset }, reqOptions),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.contacts.list(
        { ...query, limit, offset },
        reqOptions,
      );
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
