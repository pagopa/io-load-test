import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import redis from "k6/experimental/redis";

export const getRedisClient = (connectionString: NonEmptyString): redis.Client =>
  new redis.Client(`${connectionString}` as any);
