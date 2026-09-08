import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import redis, { Client } from "k6/x/redis";

export const getRedisClient = (connectionString: NonEmptyString): Client =>
  new redis.Client(`${connectionString}`);
