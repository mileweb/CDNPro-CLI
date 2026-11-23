import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { readBodyFile, validateRequestOrThrow } from '../../util';
import { getExampleBody } from '../../../schema/synthesize';
import { getParameterEnum } from '../../../schema/loader';
import {
  OptionMapping,
  REPORT_RANGE,
  FILE_EXAMPLE,
  registerOptionsFromMapping,
  checkFileConflicts,
  buildRequestFromMapping,
  registerMappings,
  checkRequiredMappings,
} from '../../option-map';

/** Which `filters` properties the endpoint's request body declares. */
export type ReportFilterKind = 'standard' | 'l7' | 'edgeHostname';

/**
 * Body-filter flags for a report. The sets differ per endpoint in the spec:
 * L7 reports have no propertyIds/serverGroups filter but add contentCodes, and
 * the edge-hostname reports filter on edgeHostnames only. Offering a flag the
 * endpoint does not declare would send a property the API ignores and return
 * unfiltered data.
 */
export function reportFilterOptions(kind: ReportFilterKind): OptionMapping[] {
  if (kind === 'edgeHostname') {
    return [
      { flag: '--edge-hostname <h>', target: 'body', param: 'filters.edgeHostnames', description: 'Filter by edge hostname; repeatable', repeatable: true },
    ];
  }
  const hostname: OptionMapping = { flag: '--hostname <h>', target: 'body', param: 'filters.hostnames', description: 'Filter by client-facing hostname; repeatable', repeatable: true };
  const propertyHostname: OptionMapping = { flag: '--property-hostname <h>', target: 'body', param: 'filters.propertyHostnames', description: 'Filter by property hostname pattern; repeatable', repeatable: true };
  if (kind === 'l7') {
    return [
      hostname,
      propertyHostname,
      { flag: '--content-code <code>', target: 'body', param: 'filters.contentCodes', description: 'Filter by content code ($content_code in loadBalancerLogic); repeatable', repeatable: true },
    ];
  }
  return [
    hostname,
    { flag: '--property <id>', target: 'body', param: 'filters.propertyIds', description: 'Filter by property ID; repeatable', repeatable: true },
    propertyHostname,
    { flag: '--server-group <g>', target: 'body', param: 'filters.serverGroups', description: 'Filter by server group; repeatable', repeatable: true },
  ];
}

/** `--scheme` mapping whose help lists the values this endpoint's spec accepts. */
export function reportSchemeOption(path: string): OptionMapping {
  const accepted = getParameterEnum(path, 'post', 'query', 'scheme')?.values ?? ['http', 'https', 'all'];
  const hasAll = accepted.includes('all');
  return {
    flag: '--scheme <scheme>',
    target: 'query',
    param: 'scheme',
    description: `Traffic type: ${accepted.join(' | ')}${hasAll ? ' [default: all]' : ''}`,
  };
}

/**
 * Register a time-series report subcommand.
 *
 * @param parent  The `report` command
 * @param name    Subcommand name (e.g. "edge-bandwidth")
 * @param desc    Description shown in help
 * @param path    Full CDN Pro API path (e.g. "/cdn/report/bandwidth")
 * @param opts    Extra configuration flags
 */
export function registerTimeSeriesReportCommand(
  parent: Command,
  name: string,
  desc: string,
  path: string,
  { noScheme = false, noReportRange = false, filters = 'standard' as ReportFilterKind } = {},
): void {
  const options: OptionMapping[] = [
    { flag: '--from <date>',         target: 'query', param: 'startdate', description: 'Start date (RFC 3339 UTC)', required: true },
    { flag: '--to <date>',           target: 'query', param: 'enddate',   description: 'End date (RFC 3339 UTC)', required: true },
    { flag: '--type <granularity>',  target: 'query', param: 'type',      description: 'Granularity: fiveminutes | hourly | daily | monthly', required: true },
    ...FILE_EXAMPLE,
  ];

  if (!noScheme) options.push(reportSchemeOption(path));
  options.push(...reportFilterOptions(filters));

  if (!noReportRange) {
    options.push(REPORT_RANGE);
  }

  const cmd = parent
    .command(name)
    .description(desc);

  registerOptionsFromMapping(cmd, options);
  registerMappings('report', name, options);

  cmd.action(async (opts: Record<string, unknown>, cmdObj: Command) => {
    try {
      if (opts.example) {
        const example = getExampleBody(path, 'post');
        process.stdout.write(JSON.stringify(example, null, 2) + '\n');
        return;
      }

      checkRequiredMappings(opts, options);
      checkFileConflicts(opts, options);

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();

      let body: unknown;
      const { query, reqOptions: mappedReqOptions, body: builtBody } = buildRequestFromMapping(opts, options, globals);

      if (opts.file) {
        body = readBodyFile(opts.file as string);
      } else {
        body = builtBody;
      }

      validateRequestOrThrow(
        path,
        'post',
        body,
        `cdnpro report ${name} --example`,
        globals.output,
        options,
      );

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);
      const fmt = globals.output as OutputFormat | undefined;

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...mappedReqOptions,
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      const data = await client.report.post(path, { query, body }, reqOptions);
      printResult(data, fmt);
    } catch (err) {
      handleError(err);
    }
  });
}
