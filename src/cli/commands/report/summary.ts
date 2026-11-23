import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import { readBodyFile, validateRequestOrThrow } from '../../util';
import { getExampleBody } from '../../../schema/synthesize';
import { getSpec } from '../../../schema/loader';
import { reportFilterOptions, reportSchemeOption, ReportFilterKind } from './time-series';
import {
  OptionMapping,
  REPORT_RANGE,
  FILE_EXAMPLE,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  registerMappings,
  checkRequiredMappings,
} from '../../option-map';

interface SpecOperation {
  parameters?: Array<{ in?: string; name?: string }>;
  requestBody?: {
    content?: Record<string, {
      schema?: { properties?: Record<string, { maxItems?: number; items?: { enum?: unknown[] } }> };
    }>;
  };
}

function postOperation(path: string): SpecOperation | undefined {
  const spec = getSpec() as unknown as { paths: Record<string, Record<string, SpecOperation>> };
  return spec.paths[path]?.['post'];
}

/** The `groupBy` body property's accepted values and item limit, from the endpoint's schema. */
function groupBySpec(path: string): { values: string[]; maxItems?: number } | undefined {
  const prop = postOperation(path)?.requestBody?.content?.['application/json']?.schema?.properties?.['groupBy'];
  const values = prop?.items?.enum;
  if (!prop || !Array.isArray(values)) return undefined;
  return { values: values.map(String), maxItems: prop.maxItems };
}

/** True when the operation declares the Report-Range header. */
function declaresReportRange(path: string): boolean {
  return (postOperation(path)?.parameters ?? []).some((p) => p.in === 'header' && p.name === 'Report-Range');
}

/**
 * Register a summary report subcommand.
 *
 * `--scheme`, `--group-by` values/limit, and `--report-range` are derived from
 * the endpoint's own spec entry because they differ between summaries.
 */
export function registerSummaryReportCommand(
  parent: Command,
  name: string,
  desc: string,
  path: string,
  { noScheme = false, filters = 'standard' as ReportFilterKind } = {},
): void {
  const options: OptionMapping[] = [
    { flag: '--from <date>', target: 'query', param: 'startdate', description: 'Start date (RFC 3339 UTC)', required: true },
    { flag: '--to <date>',   target: 'query', param: 'enddate',   description: 'End date (RFC 3339 UTC)', required: true },
    ...FILE_EXAMPLE,
  ];

  if (!noScheme) options.push(reportSchemeOption(path));
  options.push(...reportFilterOptions(filters));

  const groupBy = groupBySpec(path);
  if (groupBy && filters !== 'edgeHostname') {
    const limit = groupBy.maxItems !== undefined ? ` (up to ${groupBy.maxItems})` : '';
    options.push({
      flag: '--group-by <field>',
      target: 'body',
      param: 'groupBy',
      description: `Group-by field; repeatable${limit}: ${groupBy.values.join(' | ')}`,
      repeatable: true,
    });
  }

  if (declaresReportRange(path)) options.push(REPORT_RANGE);

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
