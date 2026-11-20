import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildMeta, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { resolveListPaging, paginateOffset } from '../../paginate';
import {
  OptionMapping,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
} from '../../option-map';

export const ANNOTATION_LIST_OPTIONS: OptionMapping[] = [
  // This endpoint takes its filters and pagination as query parameters
  // (POST /cdn/annotationsList with an optional filters body).
  { flag: '--from <date>',   target: 'query', param: 'startdate', description: 'Start date (RFC 3339 UTC)' },
  { flag: '--to <date>',     target: 'query', param: 'enddate',   description: 'End date (RFC 3339 UTC)' },
  { flag: '--type <type>',   target: 'query', param: 'type',      description: 'Filter by type: client | configuration | operation' },
  { flag: '--search <term>', target: 'query', param: 'search',    description: 'Filter by ID or comment text' },
  { flag: '--limit <n>',     target: 'query', param: 'limit',     description: 'Page size' },
  { flag: '--offset <n>',    target: 'query', param: 'offset',    description: 'Page offset' },
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerAnnotationListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List annotations');

  registerOptionsFromMapping(cmd, ANNOTATION_LIST_OPTIONS);
  registerMappings('annotation', 'list', ANNOTATION_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, ANNOTATION_LIST_OPTIONS, globals);

      const paging = resolveListPaging(opts, {
        resource: 'annotation',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.annotations.list(
            {},
            { ...reqOptions, query: { ...query, limit, offset } },
          ),
          paging,
        );
        return;
      }

      const data = await client.annotations.list(
        {},
        { ...reqOptions, query: { ...query, limit: paging.limit, offset: paging.offset } },
      );
      const { items, meta } = buildMeta(data);
      meta.limit = paging.limit;
      meta.offset = paging.offset;

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
