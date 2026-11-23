import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { printResult, OutputFormat } from '../../output';
import { handleError } from '../../errors';
import {
  OptionMapping,
  registerOptionsFromMapping,
  buildRequestFromMapping,
  checkRequiredMappings,
  registerMappings,
} from '../../option-map';

export const LOG_AGGREGATION_POINT_SUMMARY_OPTIONS: OptionMapping[] = [
  { flag: '--from <date>', target: 'query', param: 'startdate', description: 'Start date (RFC 3339 UTC)', required: true },
  { flag: '--to <date>',   target: 'query', param: 'enddate',   description: 'End date (RFC 3339 UTC)', required: true },
];

export function registerLogAggregationPointSummaryCommand(parent: Command): void {
  const cmd = parent
    .command('summary')
    .description('Get log aggregation point summary report');

  registerOptionsFromMapping(cmd, LOG_AGGREGATION_POINT_SUMMARY_OPTIONS);
  registerMappings('log-aggregation-point', 'summary', LOG_AGGREGATION_POINT_SUMMARY_OPTIONS);

  cmd.action(async (opts: Record<string, unknown>, cmd: Command) => {
      try {
        checkRequiredMappings(opts, LOG_AGGREGATION_POINT_SUMMARY_OPTIONS);
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const { query } = buildRequestFromMapping(opts, LOG_AGGREGATION_POINT_SUMMARY_OPTIONS, globals);
        const serverInfo = await resolveCredentials(globals);
        const client = new CDNProClient(serverInfo);
        const fmt = globals.output as OutputFormat | undefined;

        const reqOptions = {
          ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
          ...(globals.verbose ? { verbose: globals.verbose } : {}),
        };

        const data = await client.logAggregationPoints.summary(query, reqOptions);
        printResult(data, fmt);
      } catch (err) {
        handleError(err);
      }
    });
}
