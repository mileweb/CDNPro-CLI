# CDNPro CLI

A TypeScript-based command-line interface and programmable library for the [CDN Pro API](https://docs.cdnetworks.com) by CDNetworks.

## Features

- Full coverage of CDN Pro REST APIs: properties, certificates, deployments, edge hostnames, cache operations, reports, and more
- Profile-based credential management (multiple environments/accounts)
- Auto-detects output format: human-readable tables in interactive terminals for `list` commands, JSON when piped
- `--wait` flag on async operations (deploys, validations, purges, prefetches) polls until completion
- OpenAPI schema introspection via `cdnpro schema` — useful for AI agents and tooling
- Shell completion for bash, zsh, fish, and PowerShell
- Self-update via `cdnpro update` — detects global vs. local install and uses the right package manager
- Importable TypeScript/Node.js library for programmatic use

## Installation

**Prerequisites:** Node.js 18+

```bash
npm install -g cdnpro-cli
```

Verify:

```bash
cdnpro --version
```

### Install from source

```bash
git clone https://github.com/mileweb/CDNPro-CLI.git
cd CDNPro-CLI
npm install
npm run build   # downloads openapi.json on first run, so network access is required
npm install -g .
```

## Authentication

CDNPro CLI resolves credentials in this order:

1. CLI flags: `--host`, `--user`, `--secret-key` (all three together; supplying only some is an error)
2. Environment variables: `CDNPRO_HOST`, `CDNPRO_USER`, `CDNPRO_SECRETKEY`
3. Named profile (via `--profile <name>` or `CDNPRO_PROFILE` env var)
4. The saved profile marked `(default)` in `cdnpro auth list`

### Saving a profile

```bash
cdnpro auth login
# Prompts for host, username, and secret key.
# Saves a profile named "default" and marks it as the default profile.

cdnpro auth login --profile staging
# Saves or overwrites the profile named "staging".
# The first profile you save is marked (default). A later named profile is not;
# the existing default stays until you switch it.
```

Running login again for an existing name overwrites that profile's host, username, and secret key. It does not ask for confirmation.

### Managing profiles

`cdnpro auth list` prints every saved profile. `(default)` marks the default profile. Switching the default keeps the other profiles saved:

```bash
cdnpro auth list                   # Show saved profiles; "(default)" marks the default profile
cdnpro auth switch staging         # Mark "staging" as the default; other profiles stay
cdnpro auth status                 # Test the default profile
cdnpro auth status --profile qa1   # Test qa1 without changing the default
cdnpro auth logout                 # Remove the profile marked (default)
cdnpro auth logout --profile staging
```

`cdnpro auth logout` with no `--profile` removes the profile marked `(default)`, not a profile whose name is `default`. If other profiles remain, one of them is marked `(default)`. `cdnpro auth logout --profile staging` removes only `staging`. The default marker changes only when `staging` was the default profile.

### When `--profile` is omitted

`--profile <name>` selects a saved profile for that one command. It does not change which profile is marked `(default)`.

When `--profile` is omitted, the command chooses a profile in this order:

1. `CDNPRO_PROFILE`, when that environment variable names a saved profile
2. The profile marked `(default)` in `cdnpro auth list`

`CDNPRO_PROFILE` overrides the `(default)` marker for that command. It does not change the marker.

Saved profiles are not used when explicit credentials are supplied. That is `--host`, `--user`, and `--secret-key` together, or `CDNPRO_HOST`, `CDNPRO_USER`, and `CDNPRO_SECRETKEY` together.

- Passing only some of `--host`, `--user`, `--secret-key` exits with code 9 rather than silently using a saved profile (which would send that profile's user to the host you named).
- If only some of the `CDNPRO_*` credential variables are set, they are ignored with a warning and the saved profile is used.
- An explicit `--profile <name>` takes precedence over complete `CDNPRO_*` credentials, since it is the more specific request.

Credentials are stored securely:
- **Secret key** — stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). If the keychain is unavailable (headless server, CI), a one-time warning is shown and the secret falls back to the config file.
- **Host and username** — stored in the config file (when the secret falls back to this file on Linux/macOS, the file is restricted to mode 0600):
  - Linux: `~/.config/cdnpro-nodejs/config.json`
  - macOS: `~/Library/Preferences/cdnpro-nodejs/config.json`
  - Windows: `%APPDATA%\cdnpro-nodejs\Config\config.json`

### Handling secrets in request bodies

Create/update bodies for certificates, certificate versions, secrets, webhooks, contacts, and admin
accounts can contain sensitive values (private keys, secret text, API keys, PII). The CLI limits
incidental exposure, but it cannot hide a payload from a caller running under the same OS account.

- Prefer `--file -` to read the body from stdin, e.g. `cdnpro secret create --file - < secret.json`,
  so the plaintext need not be written to disk.
- If you use a file, restrict it: `chmod 600 secret.json`. The CLI does not check file
  permissions; securing the file is the caller's responsibility. (Windows ACLs work the same way
  but are not inspected either.)
- Keep secrets out of command-line arguments: argv is visible to other processes (`ps`) and often to
  shell history. That includes the global `--secret-key` flag, so for your *API credentials* prefer a
  saved profile (the secret goes to the OS keychain) and, for CI, the `CDNPRO_SECRETKEY` environment
  variable populated from your CI's secret store. Environment variables are less exposed than argv,
  but a same-user process can still read `/proc/<pid>/environ`. Secrets inside request bodies belong
  in `--file -` / a restricted file, as above.
- `-v`/`-vv` diagnostics go to **stderr**, so they never corrupt piped JSON. `-vv` redacts the
  `Authorization` header and sensitive body fields (`privateKey`, `secret`, `secretKey`, `apiKey`,
  passwords, tokens, PEM private keys). Redaction is best-effort — still treat logs as sensitive.
- Success response bodies are never written to the diagnostic log.
- For AI agents and other automation, run the CLI under a separate OS account, or through a
  wrapper/credential broker, that can read the secret while the agent cannot. A same-user agent can
  read any file the CLI can read; the CLI cannot enforce that boundary.

## Global Options

These options are available on every command:

| Option | Description |
|---|---|
| `-p, --profile <name>` | Credential profile to use |
| `--host <host>` | Override API host |
| `--user <user>` | Override API username |
| `--secret-key <key>` | Override API secret key |
| `-o, --output <format>` | Output format: `table`, `json`, or `jsonl` (anything else exits 4) |
| `--no-color` | Disable colored output |
| `-v, --verbose` | Increase verbosity (`-vv` prints redacted HTTP diagnostics to stderr) |
| `--on-behalf-of <id>` | Reseller: act on behalf of a customer |

Enumerated option values (e.g. `--target`, `--status`, `--action`) and date-time options (e.g.
`--from`, `--to`, `--start-time`) are validated against the OpenAPI spec before the request is
sent. Date-times must be RFC 3339 with a timezone. An invalid value exits with code 4 and lists the
accepted values or expected format.

## Output Formats

| Format | When used | Description |
|---|---|---|
| `table` | `list` commands in interactive TTY (default) | Human-readable ASCII table |
| `json` | Piped/non-TTY (default), and all non-list commands | Single JSON envelope |
| `jsonl` | Explicit `--output jsonl` | One JSON object per line (streaming) |

Machine output uses one top-level shape: `{"data": ...}` on success and `{"error": ...}` on
failure. List/create/update/delete results all live under `data`; for writes it is
`{"data": {"success": true, ...identifiers}}`, e.g. `.data.propertyId`. An interactive TTY without
an explicit `--output` prints human messages to stderr instead.

### Pagination and `--all`

List commands accept `--limit <n>` and `--offset <n>`. `--all` walks every page and emits
JSONL:

- `--limit` sets the page size (default 100 with `--all`, 10 otherwise). It is validated against
  the API's declared maximum and rejected with exit code 4 if it exceeds it.
- `--offset` is the starting offset (default 0).
- `--max-pages <n>` bounds the number of requests (default 10, maximum 50; exit code 4 outside
  that range). It requires `--all`.
- Pages advance by the number of items actually returned. A short page does not end pagination;
  an empty page does.
- `--all` always emits JSONL; combining it with `--output table` or `--output json` is an error
  (exit code 4).
- If `--max-pages` is reached while more data may exist, a warning is written to stderr and the
  process exits with code **11 (INCOMPLETE)** after streaming the pages it fetched. Increase
  `--max-pages` or narrow the filters to get a complete result.
- `admin apicall list` uses cursor pagination (`before`): it starts from `--before` when supplied
  and continues from the last item's `apiRequestId`. A missing or non-advancing cursor is an
  error (exit code 1).

## Commands

**Behaviour shared by many commands**

- **`--confirm` on `delete`.** Every `delete` command asks `[y/N]` in an interactive terminal; `--confirm`
  skips the prompt. When stdout is not a terminal (scripts, agents) there is no prompt and the delete
  proceeds, so pass `--confirm` to make that intent explicit. Answering no, or closing stdin before
  answering, exits with code 1 and deletes nothing.
- **`--if-unmodified-since <date>` on updates.** `update` (and `edge-hostname replace`) for properties,
  property versions, edge hostnames, secrets, webhooks, log configs, log aggregation points, service
  quotas, and API permissions sends `If-Unmodified-Since`, so the change fails with exit code 10
  (precondition failed) if the resource changed since you read it. Accepts an HTTP-date (the API's
  `Last-Modified`) or an RFC 3339 date-time.
- **`--file` is exclusive.** `--file` supplies the whole request body. Combining it with flags that
  build body content (for example `purge create --file p.json --url ...`) is an error (exit code 4)
  instead of silently ignoring one of them. Flags that map to query parameters or headers still apply.
- **Terminal output is sanitized.** In table output, control characters in API-supplied text are shown
  as `\xNN` escapes so they cannot manipulate your terminal. JSON/JSONL output is unaffected.

### Properties

```bash
cdnpro property list [--search <keyword>] [--target <staging|production>]
                     [--has-config <value>] [--sort-by <field>]
                     [--sort-order <asc|desc>] [--limit <n>] [--offset <n>]
                     [--report-range <scope>] [--all]
cdnpro property get <id>
cdnpro property create --file <path>   # --example prints an example body
cdnpro property update <id> --file <path>
cdnpro property delete <id>
```

#### Property versions

```bash
cdnpro property-version list <propertyId> [--search <term>] [--sort-by <field>]
                                  [--sort-order <asc|desc>] [--limit <n>]
                                  [--offset <n>] [--all]
cdnpro property-version get <propertyId> <version>
cdnpro property-version create <propertyId> --file <path>
cdnpro property-version update <propertyId> <version> --file <path>
cdnpro property-version delete <propertyId> <version>
```

### Certificates

```bash
cdnpro cert list [--search <keyword>] [--target <all|staging|production>]
                 [--ca-only] [--auto-renew <LE|Off>] [--sort-by <field>]
                 [--sort-order <asc|desc>] [--limit <n>] [--offset <n>]
                 [--report-range <scope>] [--all]
cdnpro cert get <id>
cdnpro cert create --name <name> [--file <path>] [--example]
                   # Upload mode:
                   --cert <file> --key <file> [--ca <file>] [--comments <text>]
                   # Self-signed mode:
                   --self-signed <RSA2048|ECC256> --common-name <cn>
                     [--san <hostname>...] [--country <CC>] [--state <state>]
                     [--city <city>] [--company <org>] [--department <ou>]
                     [--email <email>] [--comments <text>]
                   # CA-only mode:
                   --ca-only --ca <file> [--comments <text>]
cdnpro cert update <id> [--name <name>] [--file <path>] [--example]
                        # --name alone renames the certificate (no new version)
                        # Upload mode, self-signed mode, CA-only mode:
                        # same flags as `cert create`
cdnpro cert delete <id>
cdnpro cert download-csr <id> [--dcv <provider>] [--out <file>]
```

`cert create` and `cert update` support three mutually exclusive creation modes plus `--file`:

`cert create` requires `--name` for every flag-built mode (upload, self-signed, CA-only). When
`--file` supplies the full body, the name comes from the file and the flag is not required.

| Mode | Trigger flags | Description |
|---|---|---|
| **Upload** | `--cert <file>` + `--key <file>` | Upload a PEM certificate and private key. The private key is encrypted client-side (AES-128-CBC with HMAC-SHA256 key derivation) before transmission. Use `--ca <file>` to include the CA chain. |
| **Self-signed** | `--self-signed <RSA2048\|ECC256>` | Have the server generate the certificate and private key. Requires `--common-name`. Repeatable `--san` for Subject Alternative Names. Optional subject fields: `--country`, `--state`, `--city`, `--company`, `--department`, `--email`. |
| **CA-only** | `--ca-only --ca <file>` | Register a CA certificate without a leaf certificate or private key. |
| **File** | `--file <path>` | Provide the full JSON request body. Use `--example` to print a schema-based example body and exit. |

**Upload mode flags** (`cert create` / `cert update`):

| Flag | Description |
|---|---|
| `--cert <file>` | Path to PEM certificate file (required) |
| `--key <file>` | Path to PEM private key file (required) |
| `--ca <file>` | Path to PEM CA chain file |
| `--comments <text>` | Version comments |

**Self-signed mode flags** (`cert create` / `cert update`):

| Flag | Description |
|---|---|
| `--self-signed <alg>` | Algorithm: `RSA2048` or `ECC256` (required) |
| `--common-name <cn>` | Common Name for the certificate (required) |
| `--san <hostname>` | Subject Alternative Name (repeatable) |
| `--country <CC>` | 2-letter ISO-3166 country code |
| `--state <state>` | State or province |
| `--city <city>` | Locality / city |
| `--company <org>` | Organization name |
| `--department <ou>` | Organizational unit |
| `--email <email>` | Email address |
| `--comments <text>` | Version comments |

Both commands also accept `--name <name>` (required for `cert create` unless `--file` is used, optional for `cert update`) to set the certificate record's name.

#### Certificate versions

```bash
cdnpro cert-version get <certId> <version>
cdnpro cert-version delete <certId> <version>
```

### Deployments

```bash
cdnpro deploy list [--from <date>] [--to <date>] [--target <staging|production>]
                   [--status <waiting|inprogress|failed|succeeded>]
                   [--property <id>] [--cert <id>] [--search <keyword>]
                   [--task-ids <id,...>] [--sort-by <field>]
                   [--sort-order <asc|desc>] [--limit <n>] [--offset <n>]
                   [--report-range <scope>] [--all]
cdnpro deploy get <id>
cdnpro deploy create (--target <staging|production>
                       (--deploy-property <id@version> | --remove-property <id> |
                        --deploy-cert <id@version> | --remove-cert <id>)...
                       | --file <path>)
                      [--name <name>] [--webhook <id>]
                      [--skip-certificate-check] [--skip-client-ca-certificate-check]
                      [--skip-origin-auth-certificate-check] [--skip-usage-check]
                      [--example]
                      [--wait] [--timeout <seconds>] [--poll-interval <seconds>]
```

`deploy create` requires either `--target` plus at least one action flag (`--deploy-property`, `--remove-property`, `--deploy-cert`, or `--remove-cert`), or `--file` to pass the full JSON body. With `--file`, the body must contain `target` and `actions`.

#### Deploy create flags

**Action flags** (at least one required, all repeatable):

| Flag | Description |
|---|---|
| `--deploy-property <id@version>` | Deploy a property at the specified version |
| `--remove-property <id>` | Remove a property from the target environment |
| `--deploy-cert <id@version>` | Deploy a certificate at the specified version |
| `--remove-cert <id>` | Remove a certificate from the target environment |

**Metadata flags** (optional):

| Flag | Description |
|---|---|
| `--name <name>` | Friendly name for the deployment task |
| `--webhook <id>` | Webhook ID to call on task completion |

**Safety-check bypass flags** (optional):

| Flag | Description |
|---|---|
| `--skip-certificate-check` | Skip certificate validity and SAN checks |
| `--skip-client-ca-certificate-check` | Skip client CA certificate expiry check |
| `--skip-origin-auth-certificate-check` | Skip origin auth certificate expiry check |
| `--skip-usage-check` | Skip active-hostname safety check |

**File / example flags** (alternative to individual flags):

| Flag | Description |
|---|---|
| `--file <path>` | JSON body file (`-` for stdin) |
| `--example` | Print example body and exit |

**Polling flags** (optional):

| Flag | Description |
|---|---|
| `--wait` | Poll until the deployment succeeds or fails |
| `--timeout <seconds>` | Max wait time (default: 600) |
| `--poll-interval <seconds>` | Poll frequency in seconds (default: 30) |

The `--wait` flag shows a spinner in a TTY and NDJSON progress lines when piped. `--timeout` and `--poll-interval` must be positive integers and are validated before the request is sent. Polling carries `--on-behalf-of`, makes a final poll at the deadline, and tolerates a few transient errors (429, 5xx, dropped connections) while the task keeps running. If the server returns no resource ID for a created resource, the command exits 1 instead of printing an empty ID.

### Validation

```bash
cdnpro validation list [--from <date>] [--to <date>] [--property <id>]
                      [--property-version <version>]
                      [--status <waiting|"in progress"|failed|succeeded>]
                      [--search <keyword>] [--sort-by <field>]
                      [--sort-order <asc|desc>] [--limit <n>] [--offset <n>]
                      [--report-range <scope>] [--all]
cdnpro validation get <id>
cdnpro validation create --property-id <id> --property-version <version>
                         [--name <name>] [--webhook <id>]
                         [--file <path>] [--example]
                         [--wait] [--timeout <seconds>] [--poll-interval <seconds>]
```

`validation create` requires `--property-id` and `--property-version`, or `--file` to pass the full JSON body.

### Cache Operations

#### Purge

```bash
cdnpro purge list [--from <date>] [--to <date>] [--target <staging|production>]
                  [--action <invalidate|delete>] [--search <keyword>]
                  [--max-success-rate <rate>] [--sort-by <field>]
                  [--sort-order <asc|desc>] [--limit <n>] [--offset <n>]
                  [--report-range <scope>] [--all]
cdnpro purge get <id>
cdnpro purge summary --from <date> --to <date> [--target <staging|production>]
cdnpro purge tokens
cdnpro purge create --target <staging|production> [--url <url>] [--dir <dir>] [--regex <pattern>] [--header <name:value>] [--action <invalidate|delete>] [--name <text>] [--webhook <id>] [--file <path>] [--example] [--wait] [--timeout <seconds>] [--poll-interval <seconds>]
```

`purge create` requires at least one of `--url`, `--dir`, `--regex`, or `--file`; `--target` is required unless `--file` is used (the body file must contain it). `--header` (repeatable, `name:value`) selects which cached variant of the `--url` files to purge and requires at least one `--url`. `--action` defaults to `invalidate`; `--dir` accepts at most 20 entries and `--regex` at most 2.

#### Prefetch

```bash
cdnpro prefetch list [--from <date>] [--to <date>] [--search <keyword>]
                     [--sort-by <field>] [--sort-order <asc|desc>]
                     [--limit <n>] [--offset <n>] [--report-range <scope>]
                     [--all]
cdnpro prefetch get <id>
cdnpro prefetch tokens
cdnpro prefetch create [--url <url>] [--name <name>] [--region <region>] [--start-time <datetime>] [--webhook <id>] [--file <path>] [--example] [--wait] [--timeout <seconds>] [--poll-interval <seconds>]
```

`prefetch create` requires at least one `--url` or `--file`.

### Edge Hostnames

```bash
cdnpro edge-hostname list [--search <keyword>] [--has-beian]
                          [--server-groups <groups>] [--sort-by <field>]
                          [--sort-order <asc|desc>] [--limit <n>]
                          [--offset <n>] [--report-range <scope>] [--all]
cdnpro edge-hostname get <id>
cdnpro edge-hostname create --file <path>
cdnpro edge-hostname update <id> --file <path>
cdnpro edge-hostname replace <id> --file <path>
cdnpro edge-hostname delete <id> [--skip-usage-check] [--confirm]   # --skip-usage-check sends Check-Usage: no
```

### Hostnames

```bash
cdnpro hostname list [--target <all|staging|production>]
                     [--limit <n>] [--offset <n>] [--report-range <scope>]
                     [--all]
cdnpro hostname get <hostname>
```

```bash
cdnpro hostname-history list [--search <keyword>] [--from <date>] [--to <date>] [--target <staging|production|all>] [--limit <n>] [--offset <n>] [--all]
cdnpro hostname-history get <hostname> [--from <date>] [--to <date>] [--target <staging|production|all>]
```

### Configuration & Management

#### Secrets

```bash
cdnpro secret list [--search <keyword>] [--limit <n>] [--offset <n>] [--report-range <scope>] [--all]
cdnpro secret get|create|update|delete
```

#### Webhooks

```bash
cdnpro webhook list [--limit <n>] [--offset <n>] [--report-range <scope>] [--all]
cdnpro webhook get|create|update|delete
```

#### Log Configs

```bash
cdnpro log-config list [--search <keyword>] [--limit <n>] [--offset <n>]
                       [--report-range <scope>] [--all]
cdnpro log-config get|create|update|delete
```

#### Log Aggregation Points

```bash
cdnpro log-aggregation-point list [--search <keyword>]
cdnpro log-aggregation-point get|create|update|delete
cdnpro log-aggregation-point summary --from <date> --to <date>
```

#### Annotations

```bash
cdnpro annotation list --from <date> --to <date> [--type <client|configuration|operation>]
                       [--search <keyword>] [--limit <n>] [--offset <n>]
                       [--report-range <scope>] [--all]
cdnpro annotation get|create|update|delete
```

#### Service Quotas

```bash
cdnpro service-quota list [--search <keyword>] [--status <active|suspended|trial|terminated>]
                          [--allow-production <true|false>]
                          [--advanced-features <features>] [--usage-limit]
                          [--allowed-cache-directives <directive>]
                          [--account-manager-email <email>] [--limit <n>]
                          [--offset <n>] [--report-range <scope>] [--all]
cdnpro service-quota get|update
```

#### API Permissions

```bash
cdnpro api-permission get|create|update|delete
```

#### System Config

```bash
cdnpro system-config get
```

### Infrastructure & Reference Data

```bash
cdnpro isp list [--search <keyword>] [--region-code <code>]
                [--sort-order <asc|desc>]       # ISP information
cdnpro client-region list [--search <keyword>] [--isp-code <code>]
                          [--sort-order <asc|desc>]  # Client regions
cdnpro shield list [--search <keyword>] [--used-in-properties]
                   [--sort-by <field>] [--sort-order <asc|desc>]
cdnpro shield get <id>                              # Origin shield locations
cdnpro staging-server list            # Staging servers
cdnpro public-ip list                 # Public IPs
cdnpro origin-fast-route-ip list      # Origin fast-route IPs
cdnpro ip-details lookup --file <path>            # IP geolocation details
```

`public-ip list` and `origin-fast-route-ip list` merge IPv4 and IPv6 ranges into
`{ "ip": ..., "version": 4 | 6 }` items; `meta` carries `lastUpdated` and `effectiveDate`.

### Reports

All report commands require `--from` and `--to` (RFC 3339 UTC dates).

#### Time-series reports

Require `--type <granularity>` (`fiveminutes` | `hourly` | `daily` | `monthly`). Most accept `--hostname`, `--property`, `--property-hostname`, `--server-group` (all repeatable), `--scheme` (`http` | `https` | `all`), and `--report-range`. The L7 reports (`l7-volume`, `l7-bandwidth`) accept only `--hostname`, `--property-hostname`, and `--content-code` (repeatable) plus `--report-range`; `edge-hostname-requests` filters on `--edge-hostname`.

```bash
cdnpro report edge-bandwidth --from <date> --to <date> --type <granularity>
cdnpro report edge-volume --from <date> --to <date> --type <granularity>
cdnpro report edge-upload-volume --from <date> --to <date> --type <granularity>
cdnpro report edge-requests --from <date> --to <date> --type <granularity>
cdnpro report edge-status-codes --from <date> --to <date> --type <granularity>
cdnpro report origin-volume --from <date> --to <date> --type <granularity>
cdnpro report origin-requests --from <date> --to <date> --type <granularity>
cdnpro report origin-status-codes --from <date> --to <date> --type <granularity>
cdnpro report interm-volume --from <date> --to <date> --type <granularity>
cdnpro report cpu-time --from <date> --to <date> --type <granularity>
cdnpro report origin-fast-route-requests --from <date> --to <date> --type <granularity>
cdnpro report origin-fast-route-volume --from <date> --to <date> --type <granularity>
cdnpro report l7-volume --from <date> --to <date> --type <granularity>
cdnpro report l7-bandwidth --from <date> --to <date> --type <granularity>
cdnpro report edge-hostname-requests --from <date> --to <date> --type <granularity> [--edge-hostname <h>]
```

#### Summary reports

Do not take `--type`. Most accept the same filters as time-series reports, plus `--group-by` (repeatable). The accepted `--group-by` values, the item limit, and whether `--scheme` allows `all` differ per endpoint; `cdnpro report <name> --help` lists them for that endpoint (they come from the API spec). The L7 summaries take `--hostname`, `--property-hostname`, `--content-code`, `--group-by`, and `--report-range`.

```bash
cdnpro report edge-bandwidth-summary --from <date> --to <date>
cdnpro report edge-volume-summary --from <date> --to <date>
cdnpro report edge-requests-summary --from <date> --to <date>
cdnpro report edge-status-summary --from <date> --to <date>
cdnpro report origin-status-summary --from <date> --to <date>
cdnpro report cpu-summary --from <date> --to <date>
cdnpro report l7-volume-summary --from <date> --to <date>
cdnpro report l7-bandwidth-summary --from <date> --to <date>
cdnpro report edge-hostname-requests-summary --from <date> --to <date> [--edge-hostname <h>]
```

#### Log download

Returns download links for raw access logs.

```bash
cdnpro report logs --from <date> --to <date> [--hostname <h>]
# --hostname is repeatable; use --file <path> to pass a full filter body as JSON
```

### Reseller Admin

These commands require a reseller account.

#### Customers

```bash
cdnpro admin customer list [--search <keyword>] [--ids <id,...>]
                           [--status <active|suspended>]
                           [--products <product,...>]
                           [--check-history-product]
                           [--regional-offices <office,...>]
                           [--sort-by <field>] [--sort-order <asc|desc>]
                           [--limit <n>] [--offset <n>] [--all]
cdnpro admin customer get|create|update
```

#### Contacts

```bash
cdnpro admin contact list [--search <keyword>] [--ids <id,...>]
                          [--status <active|suspended|pending>] [--is-master]
                          [--sort-by <field>] [--sort-order <asc|desc>]
                          [--limit <n>] [--offset <n>]
                          [--report-range <scope>] [--all]
cdnpro admin contact get|create|update|delete
```

#### API Accounts

```bash
cdnpro admin api-account list [--search <keyword>] [--type <operator|read-only>]
                              [--sort-by <field>] [--sort-order <asc|desc>]
                              [--limit <n>] [--offset <n>]
                              [--report-range <scope>] [--all]
cdnpro admin api-account get|create|update|delete
```

#### API Call Audit

```bash
cdnpro admin apicall list [--from <date>] [--to <date>]
                          [--method <GET|POST|PATCH|PUT|DELETE>]
                          [--path <uri>] [--safe <true|false>]
                          [--caller <name-or-id>]
                          [--for-customer <id|none|any>]
                          [--status <code,...>] [--before <apiRequestId>]
                          [--limit <n>] [--report-range <scope>] [--all]
cdnpro admin apicall counts [--from <date>] [--to <date>]
                            [--path <prefix>] [--by-me-only]
cdnpro admin apicall get <id>
```

### Schema Introspection

Inspect the OpenAPI schema for any operation — useful when building automation or working with AI tools:

```bash
cdnpro schema property list
cdnpro schema deploy create
cdnpro schema purge create
```

The output is a JSON object describing the request and response interface for the operation:

- **Request body schema** — JSON Schema of the request body (for POST/PATCH/PUT)
- **Query parameters** — each parameter annotated with `cliFlag`, `required`, `default`, etc.
- **Request headers** — each header annotated with `cliFlag`, `values`, `description`
- **`bodyCliFlags`** — CLI flags that map to properties in the request body (e.g. `--hostname` → `filters.hostnames` for report commands). Each entry includes the flag name, dot-notation body path, whether it is repeatable, and its description.
- **Response schema** — JSON Schema of the successful response body

This gives AI agents and users a complete picture of every CLI flag available for the operation and exactly where each flag maps in the API request (query string, header, or body).

```bash
# Inspect time-series report flags — shows bodyCliFlags for filter options
$ cdnpro schema report edge-bandwidth
```

Example output for a time-series report showing `cliFlag` on query parameters and `bodyCliFlags` for filter options that map into the request body:

```json
{
  "operation": "getBandwidthReport",
  "method": "POST",
  "path": "/cdn/report/bandwidth",
  "request": {
    "queryParameters": {
      "startdate": { "type": "string", "cliFlag": "--from", "required": true, "description": "Start date (RFC 3339 UTC)" },
      "enddate":   { "type": "string", "cliFlag": "--to",   "required": true, "description": "End date (RFC 3339 UTC)" },
      "type":      { "type": "string", "cliFlag": "--type", "required": true, "description": "Granularity: fiveminutes | hourly | daily | monthly" },
      "scheme":    { "type": "string", "cliFlag": "--scheme", "description": "Traffic type: http | https | all [default: all]" }
    },
    "requestHeaders": {
      "On-Behalf-Of": {
        "cliFlag": "--on-behalf-of",
        "description": "If you are a reseller, specify the ID of a child customer."
      },
      "Report-Range": {
        "cliFlag": "--report-range",
        "description": "Scope: self-only | self+children | children-only [default: self-only]"
      }
    },
    "bodyCliFlags": {
      "filters.hostnames": {
        "cliFlag": "--hostname",
        "repeatable": true,
        "description": "Filter by client-facing hostname; repeatable"
      },
      "filters.propertyIds": {
        "cliFlag": "--property",
        "repeatable": true,
        "description": "Filter by property ID; repeatable"
      },
      "filters.propertyHostnames": {
        "cliFlag": "--property-hostname",
        "repeatable": true,
        "description": "Filter by property hostname pattern; repeatable"
      },
      "filters.serverGroups": {
        "cliFlag": "--server-group",
        "repeatable": true,
        "description": "Filter by server group; repeatable"
      }
    }
  },
  "response": {
    "httpStatus": 200,
    "schema": { "type": "object", "properties": { "data": { "type": "array" } } }
  }
}
```

**Direction flag:** `--direction request|response|both` controls which side of the interface is returned (default: `both`).

### Updating

```bash
cdnpro update             # Check for a newer version and install it
cdnpro update --check     # Check only; exit 1 if an update is available (useful in CI)
cdnpro update --yes       # Update without a confirmation prompt
```

`cdnpro update` detects how the package was installed and runs the right command automatically:

| Install method | Command executed |
|---|---|
| `npm install -g cdnpro-cli` | `npm install -g cdnpro-cli@latest` |
| `npm install cdnpro-cli` (local) | `npm install cdnpro-cli@latest` in project root |
| `yarn add cdnpro-cli` (local) | `yarn add cdnpro-cli@latest` in project root |
| `pnpm add cdnpro-cli` (local) | `pnpm add cdnpro-cli@latest` in project root |
| `npx cdnpro-cli ...` | No update needed — npx always fetches the latest |

When a newer version is available, a one-line notice is printed to stderr after any command completes (interactive terminals only, checked at most once per 24 hours):

```
Notice: cdnpro-cli 2.1.0 is available (you have 2.0.0). Run `cdnpro update` to upgrade.
```

### Shell Completion

```bash
cdnpro completion bash >> ~/.bashrc
cdnpro completion zsh >> ~/.zshrc
cdnpro completion fish > ~/.config/fish/completions/cdnpro.fish
# PowerShell: follow the on-screen instructions from
cdnpro completion powershell
```

## Programmatic Use

Install as a library in your Node.js/TypeScript project:

```bash
npm install /path/to/CDNPro-CLI
```

```typescript
import { CDNProClient } from 'cdnpro-cli';

const client = new CDNProClient({
  host: 'ngapi.cdnetworks.com',
  user: 'your-username',
  secretKey: 'your-secret-key',
});

// List properties
const properties = await client.properties.list();

// Create a deployment. The new task's ID is returned in the Location header, so ask
// for the raw response ({ obj, ctx }) to read it.
const rsp = (await client.deployments.create(
  {
    target: 'production',
    actions: [{ action: 'deploy_property', propertyId: 'abc123', version: '2' }],
  },
  { raw: true },
)) as {
  obj: { id?: string } | null;
  ctx: { _res: { headers: Record<string, string | string[] | undefined> } };
};
const location = rsp.ctx._res.headers['location'];
const taskId = rsp.obj?.id ?? String(location).split('/').pop()!;

// Poll for completion
let result = (await client.deployments.get(taskId)) as { status: string };
while (result.status !== 'succeeded' && result.status !== 'failed') {
  await new Promise(r => setTimeout(r, 30_000));
  result = (await client.deployments.get(taskId)) as { status: string };
}
```

Path IDs you pass to the client are URL-encoded, and empty values and `.`/`..` are rejected.

## OpenAPI Spec (`openapi.json`)

The CDN Pro API contract lives in the [docs-content-cdn](https://github.com/mileweb/docs-content-cdn/blob/master/en/apispec/openapi.json) repo (`en/apispec/openapi.json`). It is **not committed to this repo**. Instead, `openapi.lock.json` pins the exact docs commit, its sha256, and the spec's shape. `scripts/fetch-openapi.js` installs exactly that revision into `openapi.json` (git-ignored), so every build uses the same spec the code was verified against until someone deliberately advances the pin. The spec drives several layers of the CLI:

| Consumer | How | Where |
|---|---|---|
| **TypeScript types** | `openapi-typescript` reads the spec at build time and emits `src/types/api.ts` | `package.json` `generate:types` script |
| **Request-body validation** | `src/schema/loader.ts` imports the spec at runtime; `src/schema/validate.ts` feeds the extracted JSON Schema to AJV before every POST/PUT/PATCH | All create/update commands |
| **Example body synthesis** | `src/schema/synthesize.ts` walks the spec to produce a filled-in request body for `--example` flags | All create/update commands |
| **Schema introspection** | `src/cli/commands/schema.ts` reads the spec directly to show request/response details for `cdnpro schema <resource> <operation>` | `cdnpro schema` command |
| **CLI flag → API parameter mapping** | Each command file exports an `OptionMapping[]` array that maps CLI flags to their API targets (query params, headers, body properties). `registerMappings()` stores this for schema introspection; `registerOptionsFromMapping()` registers Commander options from the same source. | `src/cli/option-map.ts` + every command file |
| **Packaged artifact** | `dist/` loads the spec at runtime with `require('../../openapi.json')` (it is **not** embedded in `dist/`), so the downloaded file must sit at the package root. `package.json` `files` lists it, so it ships in the published package | `npm pack` / `npm publish` |
| **Baseline pin** | `openapi.lock.json` records the docs commit and sha256; the fetch script installs exactly that revision and verifies its hash | `openapi.lock.json` |

The spec is loaded once and cached in memory the first time any schema function is called; subsequent calls within the same process reuse the cached object.

### Getting and refreshing the spec

| Command | What it does |
|---|---|
| `npm run build` / `npm run dev` | Installs the locked spec if needed, regenerates types, then builds. No network when `openapi.json` already matches the lock. |
| `npm run fetch:spec` | Install the locked spec (no network if the hash matches; hash-verified otherwise). |
| `npm run fetch:spec -- --force` | Re-download the locked spec even when the local copy already matches. |
| `npm run spec:check` | Offline: verify `openapi.json` matches `openapi.lock.json`. |
| `npm run spec:check -- --release` | Compare the lock with live `master` and warn if the lock was not produced from `master`. Also runs on `npm publish` (`prepublishOnly`). |
| `npm run spec:diff -- --from dev` | Enumerate spec changes with oasdiff against the pinned baseline. See [docs/spec-drift.md](docs/spec-drift.md). |
| `npm run spec:update -- --from <ref>` | Advance the pin: download, verify, write `openapi.json` and `openapi.lock.json`, then regenerate `src/types/api.ts`. Add `--dry-run` to print the lock without writing. |

- Downloads try `raw.githubusercontent.com` first, then the GitHub contents API (`api.github.com`). The URL is an immutable docs commit, so the lock's sha256 is the integrity check; a mismatch is refused rather than written.
- When `openapi.json` already matches the lock, no network request is made. If it is missing or mismatched and cannot be downloaded, the build fails instead of using an unverified file.
- Set `GITHUB_TOKEN` (or `GH_TOKEN`) to raise the `api.github.com` rate limit; it is also used when resolving branch names to commit SHAs.
- `OPENAPI_SPEC_URL` is still available as a warned, unpinned escape hatch. It bypasses the lock and cannot be combined with `--check`/`--release`.
- `npm pack` / `npm publish` run `prepack` (full build) and `prepublishOnly` (release check). The release check is warn-only so a GitHub outage does not block a publish; `npm run spec:check -- --release --strict` makes it a hard failure.
- `src/types/api.ts` is committed and regenerated by `spec:update` (and by every build). Never edit it by hand.

### After the spec changes

**End users:** run `cdnpro update`. The published package already includes the spec, regenerated types and a prebuilt `dist/`; no manual steps are needed.

**Contributors** working on the source must do the following before publishing a new release:

1. **Enumerate and triage** — run `npm run spec:diff -- --from dev` and follow [docs/spec-drift.md](docs/spec-drift.md). oasdiff v1.41.0 is an external prerequisite (the guide lists install options). Fill in the ledger before editing code.
2. **Implement code and tests** for each `flag-added` / `behavior-change` row.
3. **Advance the pin and regenerate types** — run `npm run spec:update -- --from dev` (or `--from master` for production). Review `openapi.lock.json` and `src/types/api.ts`; never edit the types by hand.
4. **Rebuild** — run `npm run build` so `dist/` is compiled against the pinned spec.
5. **Update `OPERATION_MAP`** if you added or removed endpoints — open `src/schema/query.ts` and add/remove entries so the new operations are reachable via `cdnpro schema` and `--example`.
6. **Add `OptionMapping[]`** for any new command — each command file exports its CLI flags as an `OptionMapping[]` array and calls `registerMappings()` so `cdnpro schema` can annotate parameters with `cliFlag` and `bodyCliFlags`. Use shared presets (`PAGINATION_OPTIONS`, `SORT_OPTIONS`, `FILE_EXAMPLE`, `CONFIRM`, etc.) from `src/cli/option-map.ts`.
7. **Run tests** — run `npm test`. It compiles first (`tsc`, so type errors fail the run) and then executes the compiled tests, which also audit every flag mapping against the spec.
8. **Release from a `master`-derived lock** — `npm publish` runs `spec:check --release` and warns if the lock's sha256 differs from live `master`. Do not publish a `dev`-pinned build before the API change is in production.

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (no compilation needed)
npm run dev -- auth status
npm run dev -- property list

# Verify the pinned spec, enumerate drift, or advance the pin
npm run spec:check
npm run spec:diff -- --from dev
npm run spec:update -- --from dev

# Build
npm run build

# Run tests (compiles first, then runs the compiled tests)
npm test
```

## See Also

- [CDN Pro product page](https://www.cdnetworks.com/cdnpro)
- [CDN Pro documentation](https://docs.cdnetworks.com)
- [CDN Pro portal](https://console.cdnetworks.com)
- [Legacy bash CLI](https://github.com/mileweb/CDNProSDK/tree/master/cdn/bash) (now in the CDNProSDK repo)
- [Legacy JavaScript library](https://github.com/mileweb/CDNProSDK/tree/master/cdn/js) (now in the CDNProSDK repo)
