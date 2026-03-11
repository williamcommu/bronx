// Security Middleware
// Provides security hardening for the dashboard

const crypto = require('crypto');

/**
 * Generate CSRF token
 */
function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF Protection Middleware
 * Requires valid CSRF token for state-changing requests
 */
function csrfProtection(req, res, next) {
    // Skip for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Skip for WebSocket upgrade
    if (req.headers.upgrade === 'websocket') {
        return next();
    }

    const sessionToken = req.session?.csrfToken;
    const headerToken = req.headers['x-csrf-token'];
    const bodyToken = req.body?._csrf;

    const providedToken = headerToken || bodyToken;

    if (!sessionToken) {
        // Generate new token if none exists
        req.session.csrfToken = generateCsrfToken();
        return res.status(403).json({ error: 'CSRF token missing. Please refresh and try again.' });
    }

    if (!providedToken || providedToken !== sessionToken) {
        return res.status(403).json({ error: 'Invalid CSRF token.' });
    }

    next();
}

/**
 * Initialize CSRF token for session
 */
function initCsrfToken(req, res, next) {
    if (req.session && !req.session.csrfToken) {
        req.session.csrfToken = generateCsrfToken();
    }
    next();
}

/**
 * Get CSRF token endpoint handler
 */
function getCsrfToken(req, res) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = generateCsrfToken();
    }
    res.json({ csrfToken: req.session.csrfToken });
}

/**
 * Security headers middleware (manual helmet-like protection)
 */
function securityHeaders(req, res, next) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Content Security Policy (basic)
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https://cdn.discordapp.com https://discord.com",
        "connect-src 'self' https://discord.com wss:",
        "frame-ancestors 'self'"
    ].join('; '));
    
    // Permissions policy
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    
    next();
}

/**
 * Require authentication middleware
 * Protects API routes that require login
 */
function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

/**
 * Require specific guild membership/permission
 * Must be used after requireAuth
 */
function requireGuildAccess(req, res, next) {
    const guildId = req.params.guildId || req.query.guildId || req.body?.guildId;
    
    if (!guildId) {
        return res.status(400).json({ error: 'Guild ID required' });
    }

    // Check if user has access to this guild
    const userGuilds = req.session.guilds || [];
    const guild = userGuilds.find(g => g.id === guildId);
    
    if (!guild) {
        return res.status(403).json({ error: 'You do not have access to this server' });
    }

    // Check for MANAGE_GUILD permission (0x20) or ADMINISTRATOR (0x8)
    const permissions = parseInt(guild.permissions || 0);
    const hasManageGuild = (permissions & 0x20) !== 0;
    const hasAdmin = (permissions & 0x8) !== 0;
    const isOwner = guild.owner === true;

    if (!hasManageGuild && !hasAdmin && !isOwner) {
        return res.status(403).json({ error: 'You do not have permission to manage this server' });
    }

    // Attach guild info to request
    req.guild = guild;
    next();
}

/**
 * Sanitize user input to prevent injection
 */
function sanitizeInput(value) {
    if (typeof value !== 'string') return value;
    
    // Remove null bytes
    value = value.replace(/\0/g, '');
    
    // Limit length
    if (value.length > 10000) {
        value = value.substring(0, 10000);
    }
    
    return value;
}

/**
 * Input sanitization middleware
 */
function sanitizeBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        const sanitize = (obj) => {
            for (const key in obj) {
                if (typeof obj[key] === 'string') {
                    obj[key] = sanitizeInput(obj[key]);
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitize(obj[key]);
                }
            }
        };
        sanitize(req.body);
    }
    next();
}

/**
 * Log security-relevant events
 */
function securityLogger(req, res, next) {
    const originalEnd = res.end;
    const startTime = Date.now();

    res.end = function(...args) {
        const duration = Date.now() - startTime;
        const userId = req.session?.user?.id || 'anonymous';
        const status = res.statusCode;

        // Log suspicious activity
        if (status === 401 || status === 403 || status === 429) {
            console.log(`[Security] ${req.method} ${req.path} - Status: ${status} - User: ${userId} - IP: ${req.ip} - ${duration}ms`);
        }

        originalEnd.apply(res, args);
    };

    next();
}

/**
 * Validate Discord IDs (snowflakes)
 */
function isValidSnowflake(id) {
    if (typeof id !== 'string') return false;
    if (!/^\d{17,20}$/.test(id)) return false;
    
    // Check if it's a valid Discord snowflake timestamp
    const timestamp = parseInt(id) / 4194304 + 1420070400000;
    const minDate = new Date('2015-01-01').getTime();
    const maxDate = Date.now() + 86400000; // Allow 1 day in future
    
    return timestamp >= minDate && timestamp <= maxDate;
}

/**
 * Validate snowflake parameters
 */
function validateSnowflake(paramName) {
    return (req, res, next) => {
        const value = req.params[paramName] || req.query[paramName] || req.body?.[paramName];
        
        if (value && !isValidSnowflake(value)) {
            return res.status(400).json({ error: `Invalid ${paramName} format` });
        }
        
        next();
    };
}

module.exports = {
    generateCsrfToken,
    csrfProtection,
    initCsrfToken,
    getCsrfToken,
    securityHeaders,
    requireAuth,
    requireGuildAccess,
    sanitizeInput,
    sanitizeBody,
    securityLogger,
    isValidSnowflake,
    validateSnowflake
};
