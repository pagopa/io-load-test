# Agent Instructions for `io-load-test`

Load testing workspace for the PagoPA IO App e2e scenarios and fast-login flows using k6, TypeScript, Redis, and Express signer.

## Repository Overview

- Root workspace contains `apps/io-test-e2e/`, which holds the entire test suite, generator scripts, and build tooling.
- Main entry point: [apps/io-test-e2e/src/index.ts](apps/io-test-e2e/src/index.ts).
- Runner script: [apps/io-test-e2e/init.sh](apps/io-test-e2e/init.sh).
- Package manifest: [apps/io-test-e2e/package.json](apps/io-test-e2e/package.json).
- Full user and scenario documentation: [apps/io-test-e2e/README.md](apps/io-test-e2e/README.md).

## Environment and Prerequisites

- **Node.js**: `18.13.0` (enforced via `.nvmrc` and `.node-version`).
- **Package Manager**: `yarn` (v1 classic). Always run yarn commands inside [apps/io-test-e2e/](apps/io-test-e2e/).
- **k6**: Required on system path (minimum version `>= 2.2.0`) to run the load test bundle.
- **Redis**: Required running instance (e.g. `redis://localhost:6379`) for session token and key queue storage.
- **pm2**: Process manager used by `init.sh` to cluster the background signer service.

## Core Commands

All commands should be executed from within [apps/io-test-e2e/](apps/io-test-e2e/):

- **Run load test**: `./init.sh`
  - High-level orchestration script that executes `yarn build`, checks/generates keys, manages `pm2` background signer, and starts `k6`.
- **Build bundle**: `yarn build`
  - Compiles TypeScript k6 scripts via Webpack using legacy OpenSSL provider (`NODE_OPTIONS=--openssl-legacy-provider webpack ...`) to `dist/index.js`.
- **Start k6 test**: `yarn start`
  - Runs `dotenv -e .env k6 run --http-debug="full" dist/index.js`.
- **Generate keys**: `yarn data`
  - Runs `ts-node ./src/generator/keys.ts > ./data/keys.json`.
- **Start signer service**: `yarn signer`
  - Starts the local Express signer at port 8080 (`src/generator/signer.ts`).
- **Seed fixtures**: `yarn fixtures`
  - Seeds test messages and profiles if `FIXTURES_ENABLED=true`.
- **Generate API models**: `yarn generate`
  - Regenerates TypeScript clients and definitions from OpenAPI specs into `src/generated/definitions/`.

## Critical Conventions and Pitfalls

### Key Generation and Lifecycle (`data/keys.json`)
- Lollipop keys link private JWKs with backend-registered assertions for fiscal codes in `TEST_FISCAL_CODE`.
- `init.sh` will skip generation if [apps/io-test-e2e/data/keys.json](apps/io-test-e2e/data/keys.json) exists.
- **Always delete `data/keys.json` (`rm -f ./data/keys.json`) before a new test session** when:
  - Previous keys may have expired.
  - Another developer ran tests with overlapping fiscal codes, which overrides the registered public keys on the backend.
  - `TEST_FISCAL_CODE` in `.env` has changed.

### Redis Token Cache Cleanup
- Stored session tokens in Redis must be deleted before each load test session to avoid `401 Unauthorized` errors caused by expired or invalidated tokens.
- Execute the flush command via `redis-cli`:
  ```bash
  redis-cli FLUSHALL
  ```
  or run `FLUSHALL` inside an interactive `redis-cli` session.

### TypeScript and Functional Programming
- Code heavily uses `fp-ts` (`pipe`, `TaskEither`, `Either`, `Option`), `io-ts` runtime codecs, and `monocle-ts`.
- Avoid thrown exceptions; prefer returning `TaskEither` or `Either` representations.
- Decode environment and payload objects using `io-ts` codecs defined in [apps/io-test-e2e/src/utils/config.ts](apps/io-test-e2e/src/utils/config.ts).

### k6 Constraints
- k6 runs inside a Go-based JavaScript runtime (not standard Node.js).
- Dependencies and scenarios are bundled into a single file `dist/index.js` via Webpack.
- Node native modules cannot run inside k6 scripts; cryptographic signing is delegated to the background HTTP signer (`signer.ts`) listening on `http://127.0.0.1:8080`.
