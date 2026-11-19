import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildMeta, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { resolveListPaging, paginateOffset } from '../../paginate';
import {
  OptionMapping,
  PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
} from '../../option-map';

export const LOG_CONFIG_LIST_OPTIONS: OptionMapping[] = [
  { flag: '--search <term>', target: 'query', param: 'search', description: 'Filter by hostname' },
  ...PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerLogConfigListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List log delivery configurations');

  registerOptionsFromMapping(cmd, LOG_CONFIG_LIST_OPTIONS);
  registerMappings('log-config', 'list', LOG_CONFIG_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, LOG_CONFIG_LIST_OPTIONS, globals);

      const paging = resolveListPaging(opts, {
        resource: 'log-config',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.logConfigs.list({ ...query, limit, offset }, reqOptions),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.logConfigs.list(
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
