import { sleep } from "k6";
import redis from "k6/experimental/redis";
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

export const checkAndGetToken = (redisClient: redis.Client) => async (
  thumbprint: string
) => {
  let token: string = "";
  let counter = 0;
  while (token === "") {
    if(counter > 10) {
      throw new Error(`Unable to get session token for thumbprint ${thumbprint} after ${counter} retries`);
    }
    // 20% jitter time
    const jitter = 0.1 * counter * randomIntBetween(0, 101) / 100 * 0.2;
    const waitTime = jitter + (0.2 * (counter + 1));
    sleep(Math.min(waitTime, 1));
    counter += 1;
    try {
      token = await redisClient.get(thumbprint);
    } catch(err) {
      token = ""
    }
  }
  return token;
};

export const getSessionTokenOrRefresh = (redisClient: redis.Client, config: IConfig, counter: number = 0) => async (
  key: GeneratedKeypair
): Promise<string> => {
  if(counter > 20) {
    throw new Error(`Unable to get session token for thumbprint ${key.thumbprint} after ${counter} retries`);
  }
  if (config.ENABLE_LV_SCENERY === true) {
    return checkAndGetToken(redisClient)(key.thumbprint);
  }
  let token = await pipe(
    TE.tryCatch(() => redisClient.get(key.thumbprint), E.toError),
    TE.chainW(TE.fromPredicate((token) => token !== "", () => null)),
    TE.swap,
    TE.chainW(() => TE.tryCatch(() => lvScenario(config, redisClient, key), E.toError)),
    TE.toUnion
  )();
  if (token === "" || token instanceof Error ) {
    // 20% jitter time
    const jitter = 0.2 * counter * randomIntBetween(0, 101) / 100 * 0.2;
    const waitTime = jitter + (0.2 * (counter + 1));
    sleep(Math.min(waitTime, 3));
    return await getSessionTokenOrRefresh(redisClient, config, counter + 1)(key);
  }
  return token;
}

export const keysInitializer = (redisClient: redis.Client) => (
  key: string,
  keys: ReadonlyArray<GeneratedKeypair>
): TE.TaskEither<Error, unknown> =>
  pipe(
    TE.tryCatch(() => redisClient.exists([key]), E.toError),
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
  redisClient: redis.Client,
  key: string
): TE.TaskEither<Error, J.Json> =>
  pipe(
    TE.tryCatch(
      () => redisClient.rpop(key),
      (err) =>
        Error(
          `Error while lpop on redis, method=popListKeyAsJson |DETAIL=${JSON.stringify(
            err
          )}`
        )
    ),
    TE.chain(TE.fromNullable(Error("list key not present"))),
    TE.chain(flow(J.parse, E.mapLeft(E.toError), TE.fromEither))
  );

export const pushListKey = (
  redisClient: redis.Client,
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
  redisClient: redis.Client,
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

export const acquireLockOrWait = async (
  redisClient: redis.Client,
  thumbprint: string
): Promise<void> => {
  try {
    const lockKey = `${thumbprint}-look-key`;
    let lock = await redisClient.sadd(lockKey, "LOCKED");
    while (lock !== 1) {
      sleep(0.1);
      lock = await redisClient.sadd(lockKey, "LOCKED");
    }
    // Set an expiration to the lock key to avoid deadlock if
    // lock release process fails
    const expireLock = await redisClient.expire(lockKey, 10);
    if (expireLock === false) {
      console.error("Failed to set lock expiration");
    }
  } catch (error) {
    console.error("An error occured during lock acquiring. Retring ...");
    await acquireLockOrWait(redisClient, thumbprint);
  }
}

export const releaseLock = async (
  redisClient: redis.Client,
  thumbprint: string
): Promise<void> => {
  try {
    const lockKey = `${thumbprint}-look-key`;
    await redisClient.srem(lockKey, "LOCKED");
  } catch (error) {
    console.error("An error occured during lock releasing. Skipping ...");
  }
}

export const setKey = (
  redisClient: redis.Client,
  key: string,
  value: string
): TE.TaskEither<Error, string> =>
  TE.tryCatch(
    () => redisClient.set(key, value, 600),
    (err) =>
      Error(
        `Error while set on redis, method=setKey |DETAIL=${JSON.stringify(err)}`
      )
  );

export const delKey = (
  redisClient: redis.Client,
  key: string
): TE.TaskEither<Error, number> =>
  TE.tryCatch(
    () => redisClient.del([key]),
    (err) =>
      Error(
        `Error while del on redis, method=delKey |DETAIL=${JSON.stringify(err)}`
      )
  );
