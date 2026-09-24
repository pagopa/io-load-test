import { sleep } from "k6";
import { Client } from "k6/x/redis";
import { GeneratedKeypair } from "./lollipop";
import { flow, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as J from "fp-ts/Json";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { IConfig } from "./config";
import { lvScenario } from "../scenarios/lv";
// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

export const REDIS_KEYS_LIST = "keys";
const TOKEN_TTL_SECONDS = 600;
const LOCK_TTL_SECONDS = 30;
const POP_RETRY_SLEEP_SECONDS = 0.05;
const POP_MAX_RETRIES = 100;
const TOKEN_GET_MAX_RETRIES = 10;

const localTokenCache: Record<string, string> = {};

export const setLocalToken = (thumbprint: string, token: string): void => {
  localTokenCache[thumbprint] = token;
};

export const checkAndGetToken = (redisClient: Client) => async (
  redisKey: string
) => {
  let token = "";
  let counter = 0;
  while (true) {
    try {
      token = await redisClient.get(redisKey);
    } catch {
      token = "";
    }
    if (token) {
      return token;
    }
    if (counter > TOKEN_GET_MAX_RETRIES) {
      throw new Error(
        `Unable to get session token for key ${redisKey} after ${counter} retries`
      );
    }
    const jitter = 0.1 * counter * (randomIntBetween(0, 101) / 100) * 0.2;
    const waitTime = jitter + 0.2 * (counter + 1);
    sleep(Math.min(waitTime, 1));
    counter += 1;
  }
};

export const getSessionTokenOrRefresh = (
  redisClient: Client,
  config: IConfig
) => async (key: GeneratedKeypair): Promise<string> => {
  const cached = localTokenCache[key.thumbprint];
  if (cached) {
    return cached;
  }

  if (config.ENABLE_LV_SCENERY === true) {
    const token = await checkAndGetToken(redisClient)(key.thumbprint);
    setLocalToken(key.thumbprint, token);
    return token;
  }

  try {
    const token = await redisClient.get(key.thumbprint);
    if (token) {
      setLocalToken(key.thumbprint, token);
      return token;
    }
  } catch {
    // Cache miss: refresh below.
  }

  const refreshed = await lvScenario(config, redisClient, key);
  setLocalToken(key.thumbprint, refreshed);
  return refreshed;
};

export const keysInitializer = (redisClient: Client) => (
  key: string,
  keys: ReadonlyArray<GeneratedKeypair>
): TE.TaskEither<Error, unknown> =>
  pipe(
    TE.tryCatch(() => redisClient.exists(key), E.toError),
    TE.map(O.fromPredicate((n) => n === 0)),
    TE.chain(
      flow(
        O.map(() =>
          pipe(
            keys.map((k) => JSON.stringify(k)),
            (keysStr) =>
              TE.tryCatch(
                () => (redisClient as any).lpush(key, ...keysStr),
                (err) =>
                  Error(
                    `Error while lpushing on redis, method=keysInitializer |DETAIL=${JSON.stringify(
                      err
                    )}`
                  )
              )
          )
        ),
        O.getOrElseW(() => TE.of(void 0))
      )
    )
  );

export const popListKeyAsJson = (
  redisClient: Client,
  key: string,
  maxRetries: number = POP_MAX_RETRIES
): TE.TaskEither<Error, J.Json> =>
  TE.tryCatch(
    async () => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const value = await redisClient.rpop(key);
          if (value) {
            const parsed = J.parse(value);
            if (E.isLeft(parsed)) {
              throw E.toError(parsed.left);
            }
            return parsed.right;
          }
        } catch (err) {
          if (attempt >= maxRetries) {
            throw err;
          }
        }
        sleep(POP_RETRY_SLEEP_SECONDS);
      }
      throw new Error("list key not present");
    },
    (err) =>
      Error(
        `Error while lpop on redis, method=popListKeyAsJson |DETAIL=${JSON.stringify(
          err
        )}`
      )
  );

export const pushListKey = (
  redisClient: Client,
  key: string,
  value: string
): TE.TaskEither<Error, number> =>
  TE.tryCatch(
    () => (redisClient as any).lpush(key, value),
    (err) =>
      Error(
        `Error while lpushing on redis, method=pushListKey |DETAIL=${JSON.stringify(
          err
        )}`
      )
  );

export const getKeyAsType = (
  redisClient: Client,
  key: string
): TE.TaskEither<Error, string> =>
  TE.tryCatch(
    () => redisClient.get(key),
    (err) =>
      Error(
        `Error while get on redis, method=getKeyAsType |DETAIL=${JSON.stringify(
          err
        )}`
      )
  );

const isLockAcquired = (result: unknown): boolean =>
  result === "OK" || result === true || result === "ok";

export const acquireLockOrWait = async (
  redisClient: Client,
  thumbprint: string
): Promise<string> => {
  const lockKey = `${thumbprint}-look-key`;
  const owner = `${__VU}-${Date.now()}-${randomIntBetween(1, 1000000000)}`;
  while (true) {
    try {
      const result = await redisClient.sendCommand(
        "SET",
        lockKey,
        owner,
        "NX",
        "EX",
        LOCK_TTL_SECONDS
      );
      if (isLockAcquired(result)) {
        return owner;
      }
    } catch (error) {
      console.error("An error occured during lock acquiring. Retring ...");
    }
    sleep(0.1);
  }
};

export const releaseLock = async (
  redisClient: Client,
  thumbprint: string,
  owner: string
): Promise<void> => {
  try {
    const lockKey = `${thumbprint}-look-key`;
    await redisClient.sendCommand(
      "EVAL",
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      lockKey,
      owner
    );
  } catch (error) {
    console.error("An error occured during lock releasing. Skipping ...");
  }
};

export const setKey = (
  redisClient: Client,
  key: string,
  value: string
): TE.TaskEither<Error, string> =>
  TE.tryCatch(
    () => redisClient.set(key, value, TOKEN_TTL_SECONDS),
    (err) =>
      Error(
        `Error while set on redis, method=setKey |DETAIL=${JSON.stringify(err)}`
      )
  );

export const delKey = (
  redisClient: Client,
  key: string
): TE.TaskEither<Error, number> =>
  TE.tryCatch(
    () => redisClient.del(key),
    (err) =>
      Error(
        `Error while del on redis, method=delKey |DETAIL=${JSON.stringify(err)}`
      )
  );
