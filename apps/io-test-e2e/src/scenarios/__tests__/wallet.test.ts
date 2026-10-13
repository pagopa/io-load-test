import * as assert from "assert";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import { runInNewContext } from "vm";
import { ModuleKind, transpileModule } from "typescript";
import { getConfigOrThrow } from "../../utils/config";

const environment = {
  IO_BACKEND_BASE_URL: "https://backend.example.test",
  IO_BACKEND_TEST_PASSWD: "test-password",
  TEST_FISCAL_CODE: "AAAAAA00A00A000A",
  REDIS_CONN_STRING: "redis://localhost:6379",
  rate: "1",
  duration: "1m",
  preAllocatedVUs: "1",
  maxVUs: "1",
};

const defaultConfig = getConfigOrThrow(environment);
assert.strictEqual(defaultConfig.IT_WALLET_KEY_ATTESTATION_MULTIPLIER, 10);
assert.strictEqual(defaultConfig.DOCUMENTS_ON_IO_RATE_PERCENTAGE, 0);
assert.strictEqual(defaultConfig.IT_WALLET_RATE_PERCENTAGE, 0);

["1", "10", "20", "101"].forEach((value) => {
  const config = getConfigOrThrow({
    ...environment,
    IT_WALLET_KEY_ATTESTATION_MULTIPLIER: value,
  });
  assert.strictEqual(config.IT_WALLET_KEY_ATTESTATION_MULTIPLIER, Number(value));
});

["", "0", "-1", "1.5", "1e1", " 10", "10 ", "text", "NaN", "Infinity", "9007199254740992"].forEach(
  (value) => {
    assert.throws(
      () => getConfigOrThrow({
        ...environment,
        IT_WALLET_KEY_ATTESTATION_MULTIPLIER: value,
      }),
      /IT_WALLET_KEY_ATTESTATION_MULTIPLIER/
    );
  }
);

(["DOCUMENTS_ON_IO_RATE_PERCENTAGE", "IT_WALLET_RATE_PERCENTAGE"] as const).forEach(
  (variableName) => {
    ["0", "100"].forEach((value) => {
      assert.strictEqual(
        getConfigOrThrow({ ...environment, [variableName]: value })[variableName],
        Number(value)
      );
    });
    ["-1", "101", "1.5", ""].forEach((value) => {
      assert.throws(
        () => getConfigOrThrow({ ...environment, [variableName]: value }),
        new RegExp(variableName)
      );
    });
  }
);

type ResponseOverride = { status?: number; body?: string };
type ScenarioOptions = {
  documents?: boolean;
  itWallet?: boolean;
  enableLv?: boolean;
  multiplier?: string;
  landingStatuses?: number[];
  nonceOverrides?: Record<number, ResponseOverride>;
  signerOverrides?: Record<number, ResponseOverride>;
  creationStatuses?: number[];
  randomKeyOverride?: ResponseOverride;
  keyAttestationStatus?: number;
  refreshFails?: boolean;
};
type RecordedRequest = {
  method: string;
  path: string;
  body: string | null;
  params: { headers: Record<string, string> };
};
type Assertion = { nonce: string; key_tag: string; jwk_type?: string };
const walletKeyTag = "wallet-key";

const runScenario = async (options: ScenarioOptions = {}) => {
  const config = getConfigOrThrow({
    ...environment,
    DOCUMENTS_ON_IO_RATE_PERCENTAGE: options.documents ? "100" : "0",
    IT_WALLET_RATE_PERCENTAGE: options.itWallet ? "100" : "0",
    ENABLE_LV_SCENERY: options.enableLv ? "true" : "false",
    ...(options.multiplier === undefined
      ? {}
      : { IT_WALLET_KEY_ATTESTATION_MULTIPLIER: options.multiplier }),
  });
  const requests: RecordedRequest[] = [];
  const metrics: Record<string, number> = {};
  const consumedNonces = new Set<string>();
  const successfulCreations = new Set<string>();
  const inFlight: Record<string, number> = {};
  const concurrency: Record<string, number> = {};
  let nonceIndex = 0;
  let signerIndex = 0;
  let creationIndex = 0;
  let landingIndex = 0;
  let refreshCalls = 0;
  let refreshCompleted = false;
  const prefix = "/api/wallet/v1/";
  const itCreationNonce = "nonce-0";
  const consumeNonce = (nonce: string) => {
    assert.ok(!consumedNonces.has(nonce), `Reused nonce: ${nonce}`);
    consumedNonces.add(nonce);
  };
  const http = {
    expectedStatuses: (...statuses: unknown[]) => statuses,
    asyncRequest: async (
      method: string,
      url: string,
      body: string | null,
      params: RecordedRequest["params"]
    ) => {
      const path = new URL(url).pathname;
      requests.push({ method, path, body, params });
      const response = { status: 200, body: "{}", timings: { duration: 5 } };
      let stage = "landing";
      if (path === `${prefix}nonce`) {
        stage = "prerequisites";
        const currentNonceIndex = nonceIndex++;
        Object.assign(response, {
          body: JSON.stringify({ nonce: `nonce-${currentNonceIndex}` }),
          ...options.nonceOverrides?.[currentNonceIndex],
        });
      } else if (path === "/random-key") {
        stage = "prerequisites";
        Object.assign(response, {
          body: JSON.stringify({ kid: walletKeyTag }),
          ...options.randomKeyOverride,
        });
      } else if (path === `${prefix}wallet-instances`) {
        stage = "flow";
        const payload = JSON.parse(String(body));
        consumeNonce(payload.challenge);
        assert.strictEqual(payload.hardware_key_tag, walletKeyTag);
        assert.strictEqual(payload.key_attestation, "test");
        assert.strictEqual(params.headers["Content-Type"], "application/json");
        const currentCreationIndex = creationIndex++;
        response.status = options.creationStatuses?.[currentCreationIndex] ?? 204;
      } else if (path === "/wallet-attestation-request") {
        stage = "flow";
        const assertion: Assertion = JSON.parse(String(body));
        consumeNonce(assertion.nonce);
        assert.strictEqual(assertion.key_tag, walletKeyTag);
        assert.strictEqual(params.headers["Content-Type"], "application/json");
        const currentSignerIndex = signerIndex++;
        Object.assign(response, {
          body: JSON.stringify({ wallet_attestation_request: body }),
          ...options.signerOverrides?.[currentSignerIndex],
        });
      } else if (path.endsWith("attestations")) {
        stage = "attestations";
        let assertion: Assertion;
        if (path === `${prefix}wallet-attestations`) {
          assertion = JSON.parse(JSON.parse(String(body)).assertion);
          assert.strictEqual(assertion.jwk_type, undefined);
          assert.strictEqual(params.headers["Content-Type"], "application/json");
          assert.ok(successfulCreations.has("nonce-0"));
        } else {
          assertion = JSON.parse(String(body));
          assert.strictEqual(
            assertion.jwk_type,
            path === `${prefix}key-attestations` ? "wua-request+jwt" : "wia-request+jwt"
          );
          assert.strictEqual(params.headers["Content-Type"], "text/plain");
          assert.ok(successfulCreations.has(itCreationNonce));
        }
        assert.ok(consumedNonces.has(assertion.nonce));
        assert.strictEqual(assertion.key_tag, walletKeyTag);
        if (path === `${prefix}key-attestations`) {
          response.status = options.keyAttestationStatus ?? 200;
        }
      }
      if (stage === "landing") {
        response.status = options.landingStatuses?.[landingIndex] ?? response.status;
        landingIndex++;
      }
      if (url.startsWith(config.IO_BACKEND_BASE_URL)) {
        assert.strictEqual(params.headers.Authorization, "Bearer test-token");
      }
      inFlight[stage] = (inFlight[stage] || 0) + 1;
      concurrency[stage] = Math.max(concurrency[stage] || 0, inFlight[stage]);
      await Promise.resolve();
      inFlight[stage]--;
      if (path === `${prefix}wallet-instances` && response.status === 204) {
        successfulCreations.add(JSON.parse(String(body)).challenge);
      }
      return response;
    },
  };
  class Metric {
    constructor(private readonly name: string) {}
    add(value: number) {
      metrics[this.name] = (metrics[this.name] || 0) + value;
    }
  }
  const modules = new Map<string, { exports: unknown }>();
  const loadModule = (filePath: string): unknown => {
    const cached = modules.get(filePath);
    if (cached) {
      return cached.exports;
    }
    const module = { exports: {} };
    modules.set(filePath, module);
    const localRequire = createRequire(filePath);
    const output = transpileModule(readFileSync(filePath, "utf8"), {
      compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    runInNewContext(output, {
      exports: module.exports,
      module,
      console: { log: () => undefined, error: () => undefined },
      require: (name: string) => {
        if (name === "k6/http") {
          return http;
        }
        if (name === "k6/metrics") {
          return { Counter: Metric, Trend: Metric };
        }
        if (name === "k6") {
          return { check: () => true };
        }
        if (name === "./lv") {
          return {
            lvScenario: async () => {
              refreshCalls++;
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              refreshCompleted = true;
              if (options.refreshFails) {
                throw new Error("refresh failed");
              }
              return "refreshed-token";
            },
          };
        }
        if (name === "../utils/http" || name === "../utils/metrics") {
          return loadModule(resolve(filePath, "..", `${name}.ts`));
        }
        return localRequire(name);
      },
    });
    return module.exports;
  };
  const wallet = loadModule(resolve(__dirname, "../wallet.ts")) as {
    walletInstanceCreation: (params: {
      config: typeof config;
      REDIS_CLIENT: unknown;
      key: { fiscalCode: string };
      token: string;
    }) => Promise<void>;
  };
  await wallet.walletInstanceCreation({
    config,
    REDIS_CLIENT: {},
    key: { fiscalCode: environment.TEST_FISCAL_CODE },
    token: "test-token",
  });
  const byPath = (path: string) => requests.filter((request) => request.path === `${prefix}${path}`);
  return { requests, metrics, concurrency, byPath, refreshCalls, refreshCompleted };
};

type LvScenarioOptions = {
  fastLoginBody?: unknown;
  throwFastLoginJson?: boolean;
  redisSetFails?: boolean;
};

const runLvScenario = async (options: LvScenarioOptions = {}) => {
  const requests: string[] = [];
  const events: string[] = [];
  let localToken: string | undefined;
  const http = {
    post: (url: string) => {
      requests.push(url);
      const responseBody = url.endsWith("/nonce/generate")
        ? { nonce: "00000000-0000-0000-0000-000000000000" }
        : url.endsWith("/signature-params")
        ? { signature: "test-signature", signatureInput: "test-input" }
        : options.fastLoginBody ?? { token: "refreshed-token" };
      return {
        status: 200,
        timings: { duration: 1, waiting: 1 },
        json: () => {
          if (url.endsWith("/fast-login") && options.throwFastLoginJson) {
            throw new Error("invalid JSON");
          }
          return responseBody;
        },
      };
    },
  };
  class Metric {
    add() {}
  }
  const modules = new Map<string, { exports: unknown }>();
  const loadModule = (filePath: string): unknown => {
    const cached = modules.get(filePath);
    if (cached) {
      return cached.exports;
    }
    const module = { exports: {} };
    modules.set(filePath, module);
    const localRequire = createRequire(filePath);
    const output = transpileModule(readFileSync(filePath, "utf8"), {
      compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    runInNewContext(output, {
      exports: module.exports,
      module,
      console: { log: () => undefined, error: () => undefined },
      require: (name: string) => {
        if (name === "k6/http") {
          return http;
        }
        if (name === "k6/metrics") {
          return { Counter: Metric, Trend: Metric };
        }
        if (name === "k6") {
          return {
            check: () => true,
            fail: (message: string) => {
              throw new Error(message);
            },
          };
        }
        if (name === "../utils/metrics") {
          return { trackRequest: () => undefined };
        }
        if (name === "../utils/token") {
          return {
            acquireLockOrWait: async () => {
              events.push("acquire");
              return "lock-owner";
            },
            releaseLock: async () => {
              events.push("release");
            },
            setKey: () => () => {
              events.push("setKey");
              return Promise.resolve(
                options.redisSetFails
                  ? { _tag: "Left", left: new Error("redis unavailable") }
                  : { _tag: "Right", right: "OK" }
              );
            },
            setLocalToken: (_thumbprint: string, token: string) => {
              events.push("setLocalToken");
              localToken = token;
            },
          };
        }
        return localRequire(name);
      },
    });
    return module.exports;
  };
  const lv = loadModule(resolve(__dirname, "../lv.ts")) as {
    lvScenario: (
      config: { AUTH_BACKEND_BASE_URL: string },
      redisClient: unknown,
      key: {
        thumbprint: string;
        fiscalCode: string;
        privateKey: { kty: string };
      }
    ) => Promise<string>;
  };
  let token: string | undefined;
  let error: unknown;
  try {
    token = await lv.lvScenario(
      { AUTH_BACKEND_BASE_URL: "https://auth.example.test" },
      {},
      {
        thumbprint: "test-thumbprint",
        fiscalCode: environment.TEST_FISCAL_CODE,
        privateKey: { kty: "EC" },
      }
    );
  } catch (caught) {
    error = caught;
  }
  return { requests, events, localToken, token, error };
};

const testLvScenario = async () => {
  const success = await runLvScenario();
  assert.ifError(success.error);
  assert.strictEqual(success.token, "refreshed-token");
  assert.strictEqual(success.localToken, "refreshed-token");
  assert.deepStrictEqual(success.events, [
    "acquire",
    "setKey",
    "setLocalToken",
    "release",
  ]);
  assert.strictEqual(success.requests.length, 3);

  const redisFailure = await runLvScenario({ redisSetFails: true });
  assert.ok(redisFailure.error);
  assert.strictEqual(redisFailure.localToken, undefined);
  assert.deepStrictEqual(redisFailure.events, ["acquire", "setKey", "release"]);

  for (const options of [
    { fastLoginBody: {} },
    { throwFastLoginJson: true },
  ]) {
    const invalidResponse = await runLvScenario(options);
    assert.ok(invalidResponse.error);
    assert.strictEqual(invalidResponse.localToken, undefined);
    assert.deepStrictEqual(invalidResponse.events, ["acquire", "release"]);
  }
};

const testSessionRefresh = async () => {
  for (const landingIndex of [0, 1, 2]) {
    const landingStatuses = [200, 200, 200];
    landingStatuses[landingIndex] = 401;
    const result = await runScenario({ landingStatuses });
    assert.strictEqual(result.refreshCalls, 1);
    assert.strictEqual(result.refreshCompleted, true);
    assert.strictEqual(result.requests.length, 3);
    assert.ok(result.requests.every(({ method }) => method === "GET"));
    assert.strictEqual(result.byPath("nonce").length, 0);
    assert.strictEqual(result.byPath("wallet-instances").length, 0);
  }

  const allUnauthorized = await runScenario({ landingStatuses: [401, 401, 401] });
  assert.strictEqual(allUnauthorized.refreshCalls, 1);
  assert.strictEqual(allUnauthorized.requests.length, 3);

  const failedRefresh = await runScenario({
    landingStatuses: [401, 200, 200],
    refreshFails: true,
  });
  assert.strictEqual(failedRefresh.refreshCalls, 1);
  assert.strictEqual(failedRefresh.requests.length, 3);

  for (const status of [200, 404, 500]) {
    const noRefresh = await runScenario({ landingStatuses: [status, 200, 200] });
    assert.strictEqual(noRefresh.refreshCalls, 0);
  }

  const lvEnabled = await runScenario({
    enableLv: true,
    landingStatuses: [401, 200, 200],
  });
  assert.strictEqual(lvEnabled.refreshCalls, 0);

  const laterUnauthorized = await runScenario({
    documents: true,
    creationStatuses: [401],
  });
  assert.strictEqual(laterUnauthorized.refreshCalls, 0);
  assert.strictEqual(laterUnauthorized.byPath("wallet-instances").length, 1);
  assert.strictEqual(laterUnauthorized.byPath("wallet-attestations").length, 0);
};

const testFlows = async () => {
  for (const documents of [false, true]) {
    for (const itWallet of [false, true]) {
      const result = await runScenario({ documents, itWallet });
      const executeITWallet = itWallet;
      const executeDocumentsOnIO = documents && !itWallet;
      const creations = Number(executeDocumentsOnIO) + Number(executeITWallet);
      const nonceCount = Number(executeDocumentsOnIO) * 2 + Number(executeITWallet) * 12;
      assert.strictEqual(result.byPath("nonce").length, nonceCount);
      assert.strictEqual(result.byPath("wallet-instances").length, creations);
      assert.strictEqual(result.byPath("wallet-attestations").length, Number(executeDocumentsOnIO));
      assert.strictEqual(result.byPath("wallet-instance-attestations").length, Number(executeITWallet));
      assert.strictEqual(result.byPath("key-attestations").length, Number(executeITWallet) * 10);
      assert.strictEqual(result.requests.filter(({ path }) => path === "/random-key").length, Number(creations > 0));
      assert.ok(result.byPath("wallet-instances").every(({ body }) => JSON.parse(String(body)).hardware_key_tag === walletKeyTag));
      assert.strictEqual(result.concurrency.landing, 3);
      assert.strictEqual(result.metrics.wallet_create_instance_success || 0, creations);
      assert.strictEqual(result.metrics.wallet_get_nonce_success || 0, nonceCount);
      assert.strictEqual(result.metrics.wallet_key_attestation_success || 0, Number(itWallet) * 10);
      if (creations > 0) {
        assert.strictEqual(result.concurrency.prerequisites, nonceCount + creations);
        assert.strictEqual(result.concurrency.flow, Number(executeDocumentsOnIO) * 2 + Number(executeITWallet) * 12);
        assert.strictEqual(result.concurrency.attestations, Number(executeDocumentsOnIO) + Number(executeITWallet) * 11);
      } else {
        assert.strictEqual(result.requests.length, 3);
      }
      const keyRequests = result.byPath("key-attestations");
      assert.strictEqual(new Set(keyRequests.map(({ body }) => body)).size, keyRequests.length);
      assert.deepStrictEqual(
        keyRequests.map(({ body }) => JSON.parse(String(body)).nonce),
        itWallet ? Array.from({ length: 10 }, (_, index) => `nonce-${index + 2}`) : []
      );
    }
  }
  for (const multiplier of ["1", "3", "20"]) {
    const result = await runScenario({ itWallet: true, multiplier });
    assert.strictEqual(result.byPath("nonce").length, Number(multiplier) + 2);
    assert.strictEqual(result.byPath("wallet-instance-attestations").length, 1);
    assert.strictEqual(result.byPath("key-attestations").length, Number(multiplier));
  }
  for (const status of [400, 401, 500]) {
    const itFailed = await runScenario({ documents: true, itWallet: true, creationStatuses: [status] });
    assert.strictEqual(itFailed.byPath("wallet-instances").length, 1);
    assert.strictEqual(itFailed.byPath("wallet-attestations").length, 0);
    assert.strictEqual(itFailed.byPath("wallet-instance-attestations").length, 0);
    assert.strictEqual(itFailed.byPath("key-attestations").length, 0);
    assert.strictEqual(itFailed.metrics.wallet_create_instance_failure || 0, Number(status !== 401));
    const documentsFailed = await runScenario({ documents: true, itWallet: false, creationStatuses: [status] });
    assert.strictEqual(documentsFailed.byPath("wallet-attestations").length, 0);
    assert.strictEqual(documentsFailed.byPath("wallet-instance-attestations").length, 0);
    assert.strictEqual(documentsFailed.byPath("wallet-instances").length, 1);
    assert.strictEqual(documentsFailed.byPath("key-attestations").length, 0);
  }
  const noCreationNonce = await runScenario({ documents: true, itWallet: true, nonceOverrides: { 0: { status: 500 } } });
  assert.strictEqual(noCreationNonce.byPath("wallet-instances").length, 0);
  assert.strictEqual(noCreationNonce.byPath("wallet-attestations").length, 0);
  assert.strictEqual(noCreationNonce.byPath("key-attestations").length, 0);
  for (const override of [{ status: 500 }, { body: "invalid JSON" }, { body: "{}" }]) {
    const noKey = await runScenario({ documents: true, itWallet: true, randomKeyOverride: override });
    assert.strictEqual(noKey.byPath("wallet-instances").length, 0);
    assert.strictEqual(noKey.requests.filter(({ method }) => method === "POST").length, 0);
    const noDocumentsKey = await runScenario({ documents: true, itWallet: false, randomKeyOverride: override });
    assert.strictEqual(noDocumentsKey.byPath("wallet-instances").length, 0);
    assert.strictEqual(noDocumentsKey.byPath("wallet-attestations").length, 0);
    const noITKey = await runScenario({ documents: false, itWallet: true, randomKeyOverride: override });
    assert.strictEqual(noITKey.byPath("wallet-instances").length, 0);
    assert.strictEqual(noITKey.byPath("wallet-instance-attestations").length, 0);
    assert.strictEqual(noITKey.byPath("key-attestations").length, 0);
    const badNonce = await runScenario({ itWallet: true, nonceOverrides: { 3: override } });
    assert.strictEqual(badNonce.byPath("key-attestations").length, 9);
    assert.deepStrictEqual(
      badNonce.byPath("key-attestations").map(({ body }) => JSON.parse(String(body)).nonce),
      ["nonce-2", ...Array.from({ length: 8 }, (_, index) => `nonce-${index + 4}`)]
    );
    const badSigner = await runScenario({ itWallet: true, signerOverrides: { 2: override } });
    assert.strictEqual(badSigner.byPath("wallet-instance-attestations").length, 1);
    assert.strictEqual(badSigner.byPath("key-attestations").length, 9);
    assert.deepStrictEqual(
      badSigner.byPath("key-attestations").map(({ body }) => JSON.parse(String(body)).nonce),
      ["nonce-2", ...Array.from({ length: 8 }, (_, index) => `nonce-${index + 4}`)]
    );
    const badInstanceSigner = await runScenario({ itWallet: true, signerOverrides: { 0: override } });
    assert.strictEqual(badInstanceSigner.byPath("wallet-instance-attestations").length, 0);
    assert.strictEqual(badInstanceSigner.byPath("key-attestations").length, 10);
  }
  const prioritizedIT = await runScenario({ documents: true, itWallet: true });
  assert.strictEqual(prioritizedIT.byPath("wallet-instances").length, 1);
  assert.strictEqual(prioritizedIT.byPath("wallet-attestations").length, 0);
  assert.strictEqual(prioritizedIT.byPath("wallet-instance-attestations").length, 1);
  assert.strictEqual(prioritizedIT.byPath("key-attestations").length, 10);
  assert.strictEqual(prioritizedIT.requests.filter(({ path }) => path === "/random-key").length, 1);
  const keyErrors = await runScenario({ itWallet: true, keyAttestationStatus: 500 });
  assert.strictEqual(keyErrors.metrics.wallet_key_attestation_failure, 10);
  assert.strictEqual(keyErrors.metrics.wallet_key_attestation_success || 0, 0);
  await testSessionRefresh();
  await testLvScenario();
  console.log("Wallet configuration and flow tests passed");
};

testFlows().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});