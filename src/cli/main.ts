#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { registerAllCommands } from './register-commands';
import { scheduleUpdateCheck, printUpdateNotice, CURRENT_VERSION } from './updater';

const program = new Command();

program
  .name('cdnpro')
  .description('CDN Pro CLI — manage CDN properties, certificates, deployments, and more')
  .version(CURRENT_VERSION)
  // Global options inherited by all subcommands
  .option('-p, --profile <name>', 'Credential profile to use')
  .option('--host <host>', 'Override API host')
  .option('--user <user>', 'Override API username')
  .option('--secret-key <key>', 'Override API secret key')
  .option('-o, --output <format>', 'Output format: table | json | jsonl')
  .option('--no-color', 'Disable colored output')
  .option('-v, --verbose', 'Increase verbosity (-vv for more)', (_, prev: number) => prev + 1, 0)
  .option('--on-behalf-of <id>', 'On-Behalf-Of customer ID (resellers only)')
  .hook('preAction', (_thisCmd, actionCmd) => {
    // Disable chalk colors if --no-color is set
    if (actionCmd.optsWithGlobals().noColor) {
      chalk.level = 0;
    }
    // Only real commands trigger the (cached, detached) update check —
    // not --version / --help, which exit before any action runs.
    scheduleUpdateCheck();
  })
  .hook('postAction', () => {
    // Print a one-line update notice to stderr after the command completes
    // (only in interactive sessions; no-op when stdout is piped).
    printUpdateNotice();
  });

// Register command groups
registerAllCommands(program);

// Unknown commands
program.on('command:*', (operands: string[]) => {
  console.error(`Unknown command: ${operands.join(' ')}\n`);
  console.error('Run `cdnpro --help` to see available commands.');
  process.exit(1);
});

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
