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

export const DEPLOY_LIST_OPTIONS: OptionMapping[] = [
  { flag: '--from <date>',       target: 'query', param: 'startdate',          description: 'Filter by submission time (start)' },
  { flag: '--to <date>',         target: 'query', param: 'enddate',            description: 'Filter by submission time (end)' },
  { flag: '--target <target>',   target: 'query', param: 'target',        description: 'Filter by environment: staging | production' },
  { flag: '--status <status>',   target: 'query', param: 'status',        description: 'Filter by status: waiting | inprogress | failed | succeeded' },
  { flag: '--property <id>',     target: 'query', param: 'propertyId',    description: 'Filter by property ID' },
  { flag: '--cert <id>',         target: 'query', param: 'certificateId', description: 'Filter by certificate ID' },
  { flag: '--search <term>',     target: 'query', param: 'search',        description: 'Keyword search' },
  { flag: '--task-ids <id,...>', target: 'query', param: 'taskIds',       description: 'Comma-separated task IDs' },
  ...SORT_OPTIONS,
  ...PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerDeployListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List deployment tasks');

  registerOptionsFromMapping(cmd, DEPLOY_LIST_OPTIONS);
  registerMappings('deploy', 'list', DEPLOY_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, DEPLOY_LIST_OPTIONS, globals);

      const paging = resolveListPaging(opts, {
        resource: 'deploy',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.deploymentTasks.list(
            { ...query, limit, offset } as Record<string, unknown>,
            reqOptions,
          ),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.deploymentTasks.list(
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
