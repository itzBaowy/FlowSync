import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../database/redis.service';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment';

// Atomic window and block state, shared across API replicas. TTL values are milliseconds.
const incrementScript = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {0, redis.call('PTTL', KEYS[1]), 1, blocked} end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    const base = `rate:${this.config.get('NODE_ENV', { infer: true })}:${this.config.get('API_PORT', { infer: true })}:${throttlerName}:${key}`;
    const result = (await this.redis.client.eval(
      incrementScript,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as number[];
    return {
      totalHits: result[0] ?? 0,
      timeToExpire: Math.ceil((result[1] ?? 0) / 1000),
      isBlocked: result[2] === 1,
      timeToBlockExpire: Math.ceil((result[3] ?? 0) / 1000),
    };
  }
}
