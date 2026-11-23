import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../../config';
import { CDNProClient } from '../../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildMeta, OutputFormat } from '../../../output';
import { handleError } from '../../../errors';
import { resolveListPaging, paginateOffset } from '../../../paginate';
import {
  OptionMapping,
  PAGINATION_OPTIONS,
  SORT_OPTIONS,
  ALL,
  MAX_PAGES,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
} from '../../../option-map';

interface ListOpts {
  search?: string;
  ids?: string;
  status?: string;
  products?: string;
  checkHistoryProduct?: boolean;
  regionalOffices?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: string;
  offset?: string;
  all?: boolean;
}

export function registerAdminCustomerListCommand(parent: Command): void {
  const ADMIN_CUSTOMER_LIST_OPTIONS: OptionMapping[] = [
    { flag: '--search <term>',                   target: 'query', param: 'search',           description: 'Keyword search' },
    { flag: '--ids <id,...>',                     target: 'query', param: 'ids',              description: 'Comma-separated customer IDs to filter' },
    { flag: '--status <status>',                  target: 'query', param: 'status',           description: 'Filter by status: active | suspended' },
    { flag: '--products <product,...>',           target: 'query', param: 'products',         description: 'Filter by product codes' },
    { flag: '--check-history-product',            target: 'query', param: 'checkHistoryProduct', description: 'With --products, also match products in the customer\'s historicalProducts list', boolean: true },
    { flag: '--regional-offices <office,...>',    target: 'query', param: 'regionalOffices',  description: 'Filter by regional office codes' },
    ...SORT_OPTIONS,
    ...PAGINATION_OPTIONS,
    ALL,
    MAX_PAGES,
  ];
  registerMappings('admin-customer', 'list', ADMIN_CUSTOMER_LIST_OPTIONS);

  const cmd = parent
    .command('list')
    .description('List customers');
  registerOptionsFromMapping(cmd, ADMIN_CUSTOMER_LIST_OPTIONS);
  cmd.action(async (opts: ListOpts & Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      // Builds the query and rejects values outside the spec's enums (--status,
      // --sort-by, --sort-order); limit/offset are re-applied below after paging validation.
      const { query } = buildRequestFromMapping(opts, ADMIN_CUSTOMER_LIST_OPTIONS, globals);

      const reqOptions = {
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const paging = resolveListPaging(opts, {
        resource: 'admin-customer',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.customers.list({ ...query, limit, offset }, reqOptions),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.customers.list({ ...query, limit, offset }, reqOptions);
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
