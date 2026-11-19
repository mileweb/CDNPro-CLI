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

export const CERT_LIST_OPTIONS: OptionMapping[] = [
  { flag: '--search <term>',      target: 'query', param: 'search',    description: 'Keyword search' },
  { flag: '--target <target>',    target: 'query', param: 'target',    description: 'Filter by deployment status: all | staging | production' },
  { flag: '--ca-only',            target: 'query', param: 'caOnly',    description: 'Show only CA certificates', boolean: true },
  { flag: '--auto-renew <mode>',  target: 'query', param: 'autoRenew', description: 'Filter by auto-renewal setting: LE | Off' },
  ...SORT_OPTIONS,
  ...PAGINATION_OPTIONS,
  REPORT_RANGE,
  ALL,
  MAX_PAGES,
];

export function registerCertListCommand(parent: Command): void {
  const cmd = parent
    .command('list')
    .description('List certificates');

  registerOptionsFromMapping(cmd, CERT_LIST_OPTIONS);
  registerMappings('cert', 'list', CERT_LIST_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      const globals = cmdObj.optsWithGlobals<GlobalOptions>();
      const fmt = globals.output as OutputFormat | undefined;

      const { query, reqOptions } = buildRequestFromMapping(opts, CERT_LIST_OPTIONS);

      const paging = resolveListPaging(opts, {
        resource: 'cert',
        operation: 'list',
        output: fmt,
      });

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (paging.all) {
        await paginateOffset(
          (limit, offset) => client.certificates.list(
            { ...query, limit, offset } as Record<string, unknown>,
            reqOptions,
          ),
          paging,
        );
        return;
      }

      const { limit, offset } = paging;
      const data = await client.certificates.list(
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
