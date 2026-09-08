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
| `FIXTURES_ENABLED`                     | Enables the fixture generation script (`yarn fixtures`) to seed test data (e.g. messages)                                                                    | boolean | `false`                                      | No       |
| `SEND_MESSAGES_APIM_BASE_URL`          | APIM base URL used by the fixtures generator to send messages                                                                                                 | string  | `https://api.io.pagopa.it/api/v1`            | If fixtures enabled  |
| `SEND_MESSAGES_APIM_SUBSCRIPTION_KEYS` | Comma-separated list of APIM subscription keys for the fixtures generator                                                                                     | string  | `<your_api_key>`                             | If fixtures enabled  |

## How to launch the load test
First, ensure you have installed:
- **k6**: follow the [k6 installation guide](https://k6.io/docs/get-started/installation/).
- **Redis**: running and accessible at `REDIS_CONN_STRING`.
- **Node.js & Yarn**: required to build the bundle and run the background signer.

Next, run the following command in the `apps/io-test-e2e` directory to launch the load test:

```bash
./init.sh
```

`./init.sh` will:
1. Build the k6 bundle via Webpack (`yarn build`).
2. Generate initial Lollipop key pairs for test users into `data/keys.json` (if not already present).
3. Ensure `pm2` is installed and start the background signer service (`signer.config.js`).
4. Execute k6 via `yarn start`.
5. Clean up the background processes once the run completes.

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
- `WALLET`: Simulates wallet instance creation and attestation flows.
- `BONUS`: Simulates services tab loading with optional SSO token introspection.
- `TRIAL`: Simulates trial subscription flows.
- `CGN`: Simulates checking the Carta Giovani Nazionale (CGN) card status in the portfolio tab.

### Lollipop Verification (LV) & Token Caching
It is possible to disable the LV scenario (`ENABLE_LV_SCENERY=false`) to generate a valid session token once and cache it in Redis, instead of refreshing it every iteration with a new fast login. This avoids overloading the Session Manager when testing specific backend services.

### Bonus scenario & SSO introspection
The `BONUS` scenario can use an introspection API for the SSO token. To perform this API call without receiving a `401 Unauthorized`, the `k6` client IP must be added to the IP Whitelist on the Session Manager. This API call is toggled via `ENABLE_SSO_INTROSPECTION`.

## Stable configuration for tests
The stability of the tool during load test execution is granted when the response of the backend services is almost stable and the number of max VUs is less than double the number of available Fiscal Codes declared in `TEST_FISCAL_CODE`.
For example, if there are `500` Fiscal Codes available for the test, use at most `800` max VUs.

## Load test diagrams
High level load test flow chart:
![High level load test flow chart](docs/high-level-diagram.svg)

Low level lollipop compatible keys generator logic:
![Low level lollipop compatible keys generator logic](docs/low-level-diagram-1.svg)

Low level k6 script logic:
![Low level k6 script logic](docs/low-level-diagram-2.svg)

## Rollout and test plan
**TODO**
