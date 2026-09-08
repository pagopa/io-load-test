declare module "k6/x/redis" {
  export type RedisValue = string | number | boolean;

  export interface TLSOptions {
    ca?: string[];
    cert?: string;
    key?: string;
  }

  export interface SocketOptions {
    host: string;
    port?: number;
    tls?: TLSOptions;
  }

  export interface ClusterOptions {
    maxRedirects?: number;
    readOnly?: boolean;
    routeByLatency?: boolean;
    routeRandomly?: boolean;
    nodes: Array<string | Options>;
  }

  export interface Options {
    clientName?: string;
    username?: string;
    password?: string;
    database?: number;
    socket?: SocketOptions;
    cluster?: ClusterOptions;
    masterName?: string;
    sentinelUsername?: string;
    sentinelPassword?: string;
  }

  export class Client {
    constructor(options: string | Options);

    set(key: string, value: RedisValue, expiration?: number): Promise<string>;
    get(key: string): Promise<string>;
    getSet(key: string, value: RedisValue): Promise<string>;
    getDel(key: string): Promise<string>;
    del(...keys: string[]): Promise<number>;
    exists(...keys: string[]): Promise<number>;
    incr(key: string): Promise<number>;
    incrBy(key: string, increment: number): Promise<number>;
    decr(key: string): Promise<number>;
    decrBy(key: string, decrement: number): Promise<number>;
    randomKey(): Promise<string>;
    mget(...keys: string[]): Promise<Array<string | null>>;
    expire(key: string, seconds: number): Promise<boolean>;
    ttl(key: string): Promise<number>;
    persist(key: string): Promise<boolean>;
    lpush(key: string, ...values: RedisValue[]): Promise<number>;
    rpush(key: string, ...values: RedisValue[]): Promise<number>;
    lpop(key: string): Promise<string>;
    rpop(key: string): Promise<string>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    lindex(key: string, index: number): Promise<string | null>;
    lset(key: string, index: number, value: RedisValue): Promise<string>;
    lrem(key: string, count: number, value: RedisValue): Promise<number>;
    llen(key: string): Promise<number>;
    hset(key: string, field: string, value: RedisValue, ...fieldValues: RedisValue[]): Promise<number>;
    hsetnx(key: string, field: string, value: RedisValue): Promise<boolean>;
    hget(key: string, field: string): Promise<string | null>;
    hdel(key: string, ...fields: string[]): Promise<number>;
    hgetall(key: string): Promise<Record<string, string>>;
    hkeys(key: string): Promise<string[]>;
    hvals(key: string): Promise<string[]>;
    hlen(key: string): Promise<number>;
    hincrby(key: string, field: string, increment: number): Promise<number>;
    sadd(key: string, ...members: RedisValue[]): Promise<number>;
    srem(key: string, ...members: RedisValue[]): Promise<number>;
    sismember(key: string, member: RedisValue): Promise<boolean>;
    smembers(key: string): Promise<string[]>;
    srandmember(key: string): Promise<string>;
    spop(key: string): Promise<string>;
    sendCommand(command: string, ...args: RedisValue[]): Promise<unknown>;
    isConnected(): boolean;
  }

  const redis: {
    Client: typeof Client;
  };

  export default redis;
}
