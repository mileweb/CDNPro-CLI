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

export const PROPERTY_LIST_OPTIONS: OptionMapping[] = [
  { flag: '--search <term>',      target: 'query', param: 'search',    description: 'Keyword search' },
  { flag: '--target <target>',    target: 'query', param: 'target',    description: 'Filter by deployment target: staging | production' },
  { flag: '--has-config <value>', target: 'query', param: 'hasConfig', description: 'Filter by configuration status' },
  ...SORT_OPTIONS,
  ...PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerPropertyListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List properties');

  registerOptionsFromMapping(cmd, PROPERTY_LIST_OPTIONS);
  registerMappings('property', 'list', PROPERTY_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, PROPERTY_LIST_OPTIONS, globals);

      const paging = resolveListPaging(opts, {
        resource: 'property',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.properties.list(
            { ...query, limit, offset } as Record<string, unknown>,
            reqOptions,
          ),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.properties.list(
        { ...query, limit, offset } as Record<string, unknown>,
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
