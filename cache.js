// Redis Cache Layer with In-Memory Fallback
// Provides caching for database queries and API responses

const Redis = require('ioredis');

class CacheManager {
    constructor() {
        this.redis = null;
        this.memoryCache = new Map();
        this.memoryCacheTTL = new Map();
        this.connected = false;
        this.useMemoryFallback = true;
    }

    async connect() {
        const redisUrl = process.env.REDIS_URL;
        
        if (!redisUrl) {
            console.log('[Cache] No REDIS_URL configured, using in-memory cache fallback');
            return;
        }

        try {
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: true,
                connectTimeout: 10000,
                retryStrategy: (times) => {
                    if (times > 3) {
                        // Stop retrying after 3 attempts, use memory fallback silently
                        return null;
                    }
                    return Math.min(times * 200, 2000);
                }
            });

            this._redisErrorLogged = false;

            this.redis.on('connect', () => {
                console.log('[Cache] Redis connected');
                this.connected = true;
                this.useMemoryFallback = false;
                this._redisErrorLogged = false;
            });

            this.redis.on('error', (err) => {
                if (!this._redisErrorLogged) {
                    console.warn('[Cache] Redis unavailable:', err.message, '— using in-memory fallback');
                    this._redisErrorLogged = true;
                }
                this.connected = false;
                this.useMemoryFallback = true;
            });

            this.redis.on('close', () => {
                this.connected = false;
                this.useMemoryFallback = true;
            });

            await this.redis.connect();
        } catch (error) {
            console.error('[Cache] Failed to connect to Redis:', error.message);
            this.redis = null;
            this.useMemoryFallback = true;
        }
    }

    // Generate consistent cache keys
    key(prefix, ...parts) {
        return `bronxbot:${prefix}:${parts.join(':')}`;
    }

    // Set value with TTL (in seconds)
    async set(key, value, ttlSeconds = 300) {
        const serialized = JSON.stringify(value);

        if (this.connected && this.redis) {
            try {
                await this.redis.setex(key, ttlSeconds, serialized);
                return true;
            } catch (error) {
                console.error('[Cache] Redis set error:', error.message);
            }
        }

        // Memory fallback
        if (this.useMemoryFallback) {
            this.memoryCache.set(key, serialized);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }

        return false;
    }

    // Get value
    async get(key) {
        if (this.connected && this.redis) {
            try {
                const value = await this.redis.get(key);
                return value ? JSON.parse(value) : null;
            } catch (error) {
                console.error('[Cache] Redis get error:', error.message);
            }
        }

        // Memory fallback
        if (this.useMemoryFallback) {
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() > ttl) {
                this.memoryCache.delete(key);
                this.memoryCacheTTL.delete(key);
                return null;
            }
            const value = this.memoryCache.get(key);
            return value ? JSON.parse(value) : null;
        }

        return null;
    }

    // Delete key
    async del(key) {
        if (this.connected && this.redis) {
            try {
                await this.redis.del(key);
            } catch (error) {
                console.error('[Cache] Redis del error:', error.message);
            }
        }

        this.memoryCache.delete(key);
        this.memoryCacheTTL.delete(key);
    }

    // Delete keys by pattern (prefix)
    async delPattern(pattern) {
        if (this.connected && this.redis) {
            try {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            } catch (error) {
                console.error('[Cache] Redis delPattern error:', error.message);
            }
        }

        // Memory fallback
        for (const key of this.memoryCache.keys()) {
            if (key.startsWith(pattern.replace('*', ''))) {
                this.memoryCache.delete(key);
                this.memoryCacheTTL.delete(key);
            }
        }
    }

    // Cache-aside pattern: get from cache or fetch from source
    async getOrSet(key, fetchFn, ttlSeconds = 300) {
        let value = await this.get(key);
        
        if (value !== null) {
            return value;
        }

        value = await fetchFn();
        
        if (value !== null && value !== undefined) {
            await this.set(key, value, ttlSeconds);
        }
        
        return value;
    }

    // Increment counter (for rate limiting)
    async incr(key, ttlSeconds = 60) {
        if (this.connected && this.redis) {
            try {
                const multi = this.redis.multi();
                multi.incr(key);
                multi.expire(key, ttlSeconds);
                const results = await multi.exec();
                return results[0][1];
            } catch (error) {
                console.error('[Cache] Redis incr error:', error.message);
            }
        }

        // Memory fallback
        let count = parseInt(this.memoryCache.get(key) || '0', 10) + 1;
        this.memoryCache.set(key, count.toString());
        this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
        return count;
    }

    // Get cache stats
    getStats() {
        return {
            connected: this.connected,
            usingMemoryFallback: this.useMemoryFallback,
            memoryCacheSize: this.memoryCache.size
        };
    }

    // Cleanup expired memory cache entries
    cleanupMemoryCache() {
        const now = Date.now();
        for (const [key, ttl] of this.memoryCacheTTL.entries()) {
            if (now > ttl) {
                this.memoryCache.delete(key);
                this.memoryCacheTTL.delete(key);
            }
        }
    }

    // Start periodic cleanup
    startCleanup(intervalMs = 60000) {
        setInterval(() => this.cleanupMemoryCache(), intervalMs);
    }

    async close() {
        if (this.redis) {
            await this.redis.quit();
        }
    }
}

// Singleton instance
const cache = new CacheManager();

// Common cache key patterns and TTLs
const CacheTTL = {
    GUILD_SETTINGS: 300,      // 5 minutes
    USER_ECONOMY: 60,         // 1 minute
    LEADERBOARD: 120,         // 2 minutes
    SHOP_ITEMS: 600,          // 10 minutes
    COMMAND_STATS: 300,       // 5 minutes
    MOD_LOGS: 60,             // 1 minute
    GIVEAWAYS: 30,            // 30 seconds
    DISCORD_GUILDS: 300,      // 5 minutes (OAuth user guilds)
    RATE_LIMIT: 60            // 1 minute window
};

module.exports = { cache, CacheTTL };
