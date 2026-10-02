## Load tests for fast-login feature
This project contains a `k6` load test related to the fast-login initiative and IO app end-to-end scenarios.

## Environment variables
Copy the `env.example` file into a newly created `.env` file and configure the variables needed.

The following table lists all configuration environment variables:

| Variable Name                          | Description                                                                                                                                                   | Type    | Default / Example                            | Required |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------- | -------- |
| `IO_BACKEND_BASE_URL`                  | Base URL to the io-backend service                                                                                                                            | string  | `https://api-app.io.pagopa.it`               | Yes      |
| `AUTH_BACKEND_BASE_URL`                | Base URL to the session-manager / auth service                                                                                                                | string  | Defaults to `IO_BACKEND_BASE_URL`            | No       |
| `IO_BACKEND_TEST_PASSWD`               | Password used for test users in the target environment                                                                                                        | string  | `<password>`                                 | Yes      |
| `TEST_FISCAL_CODE`                     | Comma-separated list of Fiscal Codes for test users                                                                                                           | string  | `AAAAAA00A00A000A,AAAAAA00A00A000B`          | Yes      |
| `REDIS_CONN_STRING`                    | Connection string to Redis instance (used to store session tokens and queue generated keys)                                                                  | string  | `redis://localhost:6379`                     | Yes      |
| `rate`                                 | Starting number of iterations per second for the `ramping-arrival-rate` executor                                                                             | number  | `1`                                          | Yes      |
| `duration`                             | Duration for the test execution stage                                                                                                                         | string  | `1m`                                         | Yes      |
| `preAllocatedVUs`                      | Number of pre-allocated Virtual Users (VUs) before test start                                                                                                 | number  | `1`                                          | Yes      |
| `maxVUs`                               | Maximum number of Virtual Users (VUs) allocated during the test                                                                                               | number  | `1`                                          | Yes      |
| `K6_WEB_DASHBOARD`                     | Enables k6 built-in web dashboard                                                                                                                             | boolean | `true`                                       | No       |
| `K6_WEB_DASHBOARD_EXPORT`              | File path where the HTML report from the web dashboard will be exported                                                                                       | string  | `./out/html-report.html`                     | No       |
| `FEATURE_ENABLED`                      | Enables execution of feature scenarios configured in `SCENARIOS`                                                                                             | boolean | `false`                                      | No       |
| `SCENARIOS`                            | Comma-separated list of scenarios to run when `FEATURE_ENABLED=true` (`APP_OPENING`, `TRIAL`, `MESSAGE_DETAIL`, `WALLET`, `BONUS`, `SERVICES`, `CGN`)         | string  | `MESSAGE_DETAIL`                             | If scenarios enabled |
| `ENABLE_LV_SCENERY`                    | Enables Lollipop Verification (Fast Login) on every iteration. If `false`, caches session token in Redis to avoid overloading Session Manager                 | boolean | `false`                                      | No       |
| `ENABLE_SSO_INTROSPECTION`             | Enables SSO token introspection in the `BONUS` scenario (requires k6 client IP to be whitelisted on Session Manager)                                         | boolean | `false`                                      | No       |
| `SERVICES_BASE_RATE_PERCENTAGE`        | Percentage rate (0-100) to throttle the execution of the `SERVICES` scenario, adjusting its frequency relative to other scenarios during load tests          | number  | `100`                | No       |
| `DOCUMENTS_ON_IO_RATE_PERCENTAGE`      | Probability (0-100) of running the Documents on IO creation and attestation flow in each `WALLET` iteration                                                   | integer | `0`                  | No       |
| `IT_WALLET_RATE_PERCENTAGE`            | Probability (0-100) of running the IT Wallet instance creation and instance/key attestation flow in each `WALLET` iteration                                    | integer | `0`                  | No       |
| `IT_WALLET_KEY_ATTESTATION_MULTIPLIER`  | Number of key attestations per IT Wallet iteration, relative to one instance attestation; positive safe integer (values below 10 are allowed)                   | integer | `10`                 | No       |
| `FIXTURES_ENABLED`                     | Enables the fixture generation script (`yarn fixtures`) to seed test data (e.g. messages)                                                                    | boolean | `false`                                      | No       |
| `SEND_MESSAGES_APIM_BASE_URL`          | APIM base URL used by the fixtures generator to send messages                                                                                                 | string  | `https://api.io.pagopa.it/api/v1`            | If fixtures enabled  |
| `SEND_MESSAGES_APIM_SUBSCRIPTION_KEYS` | Comma-separated list of APIM subscription keys for the fixtures generator                                                                                     | string  | `<your_api_key>`                             | If fixtures enabled  |

## Prerequisites and Setup
First, ensure you have installed and running:
- **Node.js**: version `18.13.0` (see `.nvmrc` / `.node-version`). Use `nvm use` or `nodenv` if applicable.
- **Yarn**: package manager used across the project (`yarn install` inside `apps/io-test-e2e`).
- **k6**: version `>= 2.2.0` required on system path (follow the [k6 installation guide](https://k6.io/docs/get-started/installation/)).
- **Redis**: running and accessible at `REDIS_CONN_STRING` (e.g. `redis://localhost:6379`).
- **pm2**: process manager (will be installed globally automatically by `init.sh` if missing).

Clone the repository and install dependencies:
```bash
cd apps/io-test-e2e
yarn install
cp env.example .env
# Edit .env with your environment configuration
```

## How to launch the load test
The primary command to start the entire testing workflow is the `init.sh` script:

```bash
./init.sh
```

`./init.sh` coordinates all required steps using internal `yarn` commands:
1. Builds the k6 bundle with Webpack using legacy OpenSSL provider (`yarn build`).
2. Checks if `data/keys.json` exists:
   - If missing, generates test Lollipop key pairs and registers them via `yarn data` (`yarn -s data > ./data/keys.json`).
   - If present, reuses the existing keys.
3. Checks if `pm2` is installed globally (installs it via `npm install pm2 -g` if missing).
4. Cleans up existing pm2 processes (`pm2 delete all`).
5. Starts the background HTTP signer service in cluster mode with pm2 (`pm2 start signer.config.js`), which triggers `yarn signer`.
6. Waits 5 seconds for the signer service to become ready.
7. Executes the k6 load test run (`yarn start`).
8. Automatically kills the background signer service and cleans up child processes when k6 finishes.

### Lollipop Key Generation & Lifecycle (`data/keys.json`)
> **Important:** The key generation script (`yarn data`) creates and registers Lollipop key pairs on the target backend for the Fiscal Codes specified in `TEST_FISCAL_CODE`.
>
> - `init.sh` will **only** generate `data/keys.json` if the file does not already exist.
> - **Must delete `data/keys.json` before a new test session** if:
>   - The previously generated keys are old or expired.
>   - Other developers ran test sessions using the same test Fiscal Codes, which overrides the registered public keys on the backend.
>   - You modified the `TEST_FISCAL_CODE` list in `.env`.
>
> To force key regeneration:
> ```bash
> rm -f ./data/keys.json
> ./init.sh
> ```
> Or manually:
> ```bash
> rm -f ./data/keys.json
> yarn data
> ```

### Redis Token Cache Cleanup
Stored session tokens in Redis must be deleted before each load test session to prevent `401 Unauthorized` errors caused by expired or invalid tokens from previous runs.

Run the `FLUSHALL` command using `redis-cli`:
```bash
redis-cli FLUSHALL
```
or connect to `redis-cli` and execute:
```text
127.0.0.1:6379> FLUSHALL
```

## Available npm/yarn scripts

All scripts are executed inside `apps/io-test-e2e`:

| Command | Description |
| ------- | ----------- |
| `yarn start` | Runs the compiled k6 bundle (`dist/index.js`) using `dotenv-cli`. |
| `yarn start:debug` | Same as `yarn start` with `--http-debug="full"` (verbose HTTP logs; not for high-rate runs). |
| `yarn build` | Builds the k6 bundle using Webpack with `NODE_OPTIONS=--openssl-legacy-provider` in production mode. |
| `yarn data` | Runs `src/generator/keys.ts` with `ts-node` and outputs generated test user Lollipop key pairs in JSON format to stdout (used as `yarn -s data > ./data/keys.json`). |
| `yarn signer` | Starts the Express HTTP signing service (`src/generator/signer.ts`) with `ts-node`. Provides endpoints for lollipop HTTP signatures, random JWK keys, and wallet attestation requests. |
| `yarn fixtures` | Seeds test data (e.g. messages and profiles) using `src/generator/fixtures.ts` via APIM when `FIXTURES_ENABLED=true`. |
| `yarn generate` | Runs all OpenAPI code generation tasks (`npm-run-all generate:*`) into `src/generated/definitions/`. |
| `yarn generate:messages` | Generates TypeScript definitions and models for IO communication/messages from the `io-backend` OpenAPI spec. |
| `yarn generate:identity` | Generates TypeScript client and definitions for IO identity APIs from `io-backend`. |
| `yarn generate:fast-login` | Generates TypeScript definitions for `io-functions-fast-login`. |
| `yarn generate:login` | Generates TypeScript client and definitions for login using local `./api/testlogin.yaml`. |
| `yarn generate:lollipop` | Generates TypeScript client and definitions for `io-functions-lollipop`. |
| `yarn generate:services` | Generates TypeScript client and definitions for `io-functions-services`. |
| `yarn generate:session-manager` | Generates TypeScript client and definitions for `io-session-manager` from `io-auth-n-identity-domain`. |

## Scenarios
This tool can handle different test scenarios through the `SCENARIOS` environment variable:
- `APP_OPENING`: Simulates the complete app startup flow according to realistic production traffic proportions:
  - Backend availability ping (`/api/v1/ping`)
  - Session verification (`/api/auth/v1/session`) with optional secondary session check
  - User profile retrieval (`/api/identity/v1/profile`)
  - User data processing status check (`/api/identity/v1/user-data-processing/DELETE`)
  - IT Wallet initialization check (fiscal code whitelist & wallet instance status with/without fiscal code ID)
  - SEND service activation preferences check
  - User messages list (`/api/communication/v1/messages`)
  - User message detail retrieval (`/api/communication/v1/messages/{id}`)
- `SERVICES`: Simulates navigation within the Services tab:
  - Controlled invocation frequency via `SERVICES_BASE_RATE_PERCENTAGE`.
  - Concurrent batch (`http.batch`) for initial landing requests: featured services, featured institutions, and page 1 of national institutions.
  - Paginated browsing of institutions (pages 2 and 3 with realistic continuation drop-offs).
  - Parallel batch retrieval (`http.batch` of 10 requests) across multiple service IDs to reach high request ratios while preventing database hot-partitioning.
- `MESSAGE_DETAIL`: Retrieves user message list and message details.
- `WALLET`: Always runs the three wallet landing checks (fiscal-code whitelist, current instance status, and status by fiscal code), independently of `APP_OPENING`. Two independent percentage controls select the Documents on IO and IT Wallet flows: `DOCUMENTS_ON_IO_RATE_PERCENTAGE` and `IT_WALLET_RATE_PERCENTAGE`. Both default to `0` and accept integers from `0` to `100`. Each selected flow creates its own instance before requesting backend attestations, as described below.
- `BONUS`: Simulates services tab loading with optional SSO token introspection.
- `TRIAL`: Simulates trial subscription flows.
- `CGN`: Simulates checking the Carta Giovani Nazionale (CGN) card status in the portfolio tab.

### Wallet creation and attestations
Each selected wallet flow sends its own `POST /api/wallet/v1/wallet-instances`, with a dedicated nonce as the `challenge` and a separate signer `/random-key` request for its `hardware_key_tag`. If both flows are selected, two keys are requested and the creations use different hardware key tags. Each flow uses its own tag in all its attestation signer requests; an invalid key response blocks only that flow. If the signer returns identical tags, the IT Wallet flow is skipped rather than reusing the Documents on IO key. Backend attestations for a flow are sent only after its own creation returns `204`; a failed creation does not block the other flow.

Documents on IO sends one `/wallet-attestations` request using a signer-generated `wp-war+jwt` assertion. IT Wallet sends one `/wallet-instance-attestations` request using `wia-request+jwt` and N `/key-attestations` requests, each using its own `wua-request+jwt`. IT Wallet assertions are sent as raw JWTs with `Content-Type: text/plain`.

Set `IT_WALLET_KEY_ATTESTATION_MULTIPLIER` to configure N. It defaults to `10` and accepts positive safe integers, including values below 10. Every nonce-consuming operation obtains its own one-time nonce, and each attestation has its own signer-generated JWT. With N = 10, IT Wallet alone requests 12 nonces (one creation, one instance attestation and ten key attestations); selecting both flows requests 14 nonces. The planned key-to-instance attestation ratio is N:1, but failed nonce or signer requests can reduce the actual number of backend calls. There are no compensating retries.

Independent requests run in parallel where possible. Nonce requests, signer work and key-attestation concurrency grow linearly with N; size the signer and VU allocation before increasing the multiplier. Creation metrics aggregate both flows, with distinct check titles; each nonce and backend attestation response is recorded individually.

Run the offline configuration and flow regressions from `apps/io-test-e2e` with `yarn ts-node src/scenarios/__tests__/wallet.test.ts`. They simulate HTTP and k6 metrics without reading `.env` or requiring a running backend, signer, k6 or Redis.

### Lollipop Verification (LV) & Token Caching
It is possible to disable the LV scenario (`ENABLE_LV_SCENERY=false`) to generate a valid session token once and cache it in Redis, instead of refreshing it every iteration with a new fast login. This avoids overloading the Session Manager when testing specific backend services.

### Bonus scenario & SSO introspection
The `BONUS` scenario can use an introspection API for the SSO token. To perform this API call without receiving a `401 Unauthorized`, the `k6` client IP must be added to the IP Whitelist on the Session Manager. This API call is toggled via `ENABLE_SSO_INTROSPECTION`.

## Stable configuration for tests
Each iteration leases one Lollipop key (fiscal code) for the whole journey: Fast Login, then APP_OPENING / SERVICES / CGN. Arrival-rate executors follow Little's law:

`neededVUs ≈ rate × p95(iteration_duration)`

and, because a key cannot be used by two in-flight iterations:

`rate × p95(iteration_duration) ≲ |TEST_FISCAL_CODE|`

Set `preAllocatedVUs` close to that estimate. Avoid a large gap between `preAllocatedVUs` and `maxVUs`: k6 allocating VUs at runtime skews the load generator.

Independent HTTP calls inside a journey run concurrently (`http.asyncRequest` / `Promise.all`). Feature scenarios selected in `SCENARIOS` overlap after Fast Login. Session tokens are kept in VU memory after LV so later API calls do not poll Redis.

k6 treats 401 and 404 as expected responses (`http.expectedStatuses`), matching the scenario checks that already skip those statuses. The `dropped_iterations` threshold allows a small number of drops during VU allocation or graceful stop so the process does not exit 99 after an otherwise successful run.

## Load test diagrams
High level load test flow chart:
![High level load test flow chart](docs/high-level-diagram.svg)

Low level lollipop compatible keys generator logic:
![Low level lollipop compatible keys generator logic](docs/low-level-diagram-1.svg)

Low level k6 script logic:
![Low level k6 script logic](docs/low-level-diagram-2.svg)

## Rollout and test plan
**TODO**
