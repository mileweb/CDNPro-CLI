import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printJson, printTable, printJsonl, buildMeta, OutputFormat } from '../../output';
import { handleError, CliError } from '../../errors';
import {
  OptionMapping,
  REPORT_RANGE,
  ALL,
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

      const { query, reqOptions } = buildRequestFromMapping(opts, ANNOTATION_LIST_OPTIONS);

      const limit = opts.all
        ? 100
        : parseInt(String(opts.limit ?? '10'), 10);
      if (!opts.all && (isNaN(limit) || limit < 1)) {
        throw new CliError('VALIDATION', `--limit must be a positive integer, got: ${opts.limit}`);
      }
      const startOffset = opts.all
        ? 0
        : parseInt(String(opts.offset ?? '0'), 10);
      if (!opts.all && (isNaN(startOffset) || startOffset < 0)) {
        throw new CliError('VALIDATION', `--offset must be a non-negative integer, got: ${opts.offset}`);
      }

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);
      const fmt = globals.output as OutputFormat | undefined;

      if (opts.all) {
        let offset = startOffset;
        while (true) {
          const data = await client.annotations.list(
            {},
            { ...reqOptions, query: { ...query, limit, offset } },
          );
          const { items } = buildMeta(data);
          if (items.length === 0) break;
          printJsonl(items);
          if (items.length < limit) break;
          offset += limit;
        }
        return;
      }

      const data = await client.annotations.list(
        {},
        { ...reqOptions, query: { ...query, limit, offset: startOffset } },
      );
      const { items, meta } = buildMeta(data);
      meta.limit = limit;
      meta.offset = startOffset;

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
