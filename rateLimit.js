// Rate Limiting Middleware
// Prevents abuse by limiting requests per user/IP

const { cache } = require('./cache');

/**
 * Create rate limiter middleware
 * @param {Object} options - Rate limiting options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Max requests per window (default: 100)
 * @param {string} options.prefix - Cache key prefix (default: 'rl')
 * @param {boolean} options.useUserId - Use user ID from session if available
 * @param {Function} options.keyGenerator - Custom key generator function
 */
function rateLimit(options = {}) {
    const {
        windowMs = 60000,
        max = 100,
        prefix = 'rl',
        useUserId = true,
        keyGenerator = null,
        message = 'Too many requests, please try again later.',
        skip = null
    } = options;

    const windowSeconds = Math.ceil(windowMs / 1000);

    return async (req, res, next) => {
        // Skip if condition is met
        if (skip && skip(req)) {
            return next();
        }

        // Generate key based on user ID or IP
        let key;
        if (keyGenerator) {
            key = keyGenerator(req);
        } else if (useUserId && req.session?.user?.id) {
            key = cache.key(prefix, 'user', req.session.user.id);
        } else {
            const ip = req.ip || req.connection.remoteAddress || 'unknown';
            key = cache.key(prefix, 'ip', ip.replace(/[.:]/g, '_'));
        }

        try {
            const count = await cache.incr(key, windowSeconds);

            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
            res.setHeader('X-RateLimit-Reset', Date.now() + windowMs);

            if (count > max) {
                res.setHeader('Retry-After', windowSeconds);
                return res.status(429).json({
                    error: message,
                    retryAfter: windowSeconds
                });
            }

            next();
        } catch (error) {
            console.error('[RateLimit] Error:', error.message);
            // Allow request on error
            next();
        }
    };
}

// Preset rate limiters for different endpoints
const rateLimiters = {
    // General API: 300 requests per minute (dashboard makes many concurrent calls)
    api: rateLimit({
        windowMs: 60000,
        max: 300,
        prefix: 'rl:api',
        // Skip rate limit for auth checks and static proxy routes
        skip: (req) => {
            const path = req.path;
            return path === '/auth/user' 
                || path.startsWith('/proxy/')
                || path === '/csrf-token';
        }
    }),

    // Auth endpoints: 10 requests per minute
    auth: rateLimit({
        windowMs: 60000,
        max: 10,
        prefix: 'rl:auth',
        message: 'Too many authentication attempts, please wait.'
    }),

    // Data modification: 30 requests per minute
    write: rateLimit({
        windowMs: 60000,
        max: 30,
        prefix: 'rl:write',
        message: 'Too many write operations, please slow down.'
    }),

    // Search/expensive operations: 20 requests per minute
    search: rateLimit({
        windowMs: 60000,
        max: 20,
        prefix: 'rl:search'
    }),

    // Leaderboard lookups: 60 requests per minute (supports auto-refresh for unresolved users)
    leaderboard: rateLimit({
        windowMs: 60000,
        max: 60,
        prefix: 'rl:lb'
    }),

    // Strict rate limit for sensitive operations
    strict: rateLimit({
        windowMs: 60000,
        max: 5,
        prefix: 'rl:strict',
        message: 'Rate limit exceeded for sensitive operation.'
    })
};

module.exports = { rateLimit, rateLimiters };
