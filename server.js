// Dashboard API Server — slim entry point
// All business logic lives in routes/, db.js, state.js, middleware.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const Redis = require('ioredis');
const RedisStore = require('connect-redis').default;
const cors = require('cors');
require('dotenv').config();

// Custom modules (pre-existing)
const { honeypotMiddleware } = require('./honeypot');
const { cache } = require('./cache');
const { rateLimiters } = require('./rateLimit');
const {
    securityHeaders,
    initCsrfToken,
    csrfProtection,
    getCsrfToken,
    requireAuth,
    requireBotOwner,
    sanitizeBody,
    securityLogger
} = require('./security');

// New modular pieces
const { initDatabase } = require('./db');
const { guildContext, trackApiCalls } = require('./middleware');

// Route modules
const authRoutes = require('./routes/auth');
const guildRoutes = require('./routes/guild');
const statsRoutes = require('./routes/stats');
const economyRoutes = require('./routes/economy');
const socialRoutes = require('./routes/social');
const moderationRoutes = require('./routes/moderation');
const fishingRoutes = require('./routes/fishing');
const botRoutes = require('./routes/bot');
const guideRoutes = require('./routes/guide');
const privacyRoutes = require('./routes/privacy');
const avatarProxyRoutes = require('./routes/avatar-proxy');
const { initSocket, initializeRealTimeMonitoring, registerRoutes: registerRealtimeRoutes } = require('./routes/realtime');
const renderRoutes = require('./routes/render');
const statusRoutes = require('./routes/status');


// ── App & server setup ──────────────────────────────────────────────────

const app = express();
app.use(honeypotMiddleware);
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000',
        methods: ['GET', 'POST']
    }
});
const PORT = process.env.PORT || 3000;

// ── Redis client for session storage ────────────────────────────────────
// Use Redis instead of MemoryStore for production-safe session storage
// Supports both connection URI (REDIS_URL from Render) and individual params

let redisClient;
const redisConfig = {
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    lazyConnect: false
};

try {
    // Try to connect via REDIS_URL (Render format: redis://host:port or redis://:password@host:port)
    if (process.env.REDIS_URL) {
        console.log('📍 Connecting to Redis via REDIS_URL...');
        redisClient = new Redis(process.env.REDIS_URL, redisConfig);
    } 
    // Fall back to individual host/port/password parameters
    else if (process.env.REDIS_HOST || process.env.REDIS_PORT) {
        console.log('📍 Connecting to Redis via individual parameters...');
        redisClient = new Redis({
            ...redisConfig,
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD || undefined
        });
    }
    // Default to localhost
    else {
        console.log('📍 Connecting to Redis on localhost:6379...');
        redisClient = new Redis({
            ...redisConfig,
            host: 'localhost',
            port: 6379
        });
    }
} catch (err) {
    console.error('❌ Failed to initialize Redis client:', err.message);
    console.warn('⚠️  Falling back to MemoryStore for sessions');
    redisClient = null;
}

// Only set up event handlers if Redis client was created successfully
if (redisClient) {
    redisClient.on('error', (err) => {
        console.error('⚠️  Redis connection error:', err.message);
        // Sessions will degrade to memory but won't disappear
    });

    redisClient.on('connect', () => {
        console.log('✓ Redis connected for session storage');
    });

    redisClient.on('ready', () => {
        console.log('✓ Redis ready for session storage');
    });
}

// Bot Owner Configuration
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';
if (!BOT_OWNER_ID) {
    console.warn('BOT_OWNER_ID not set. Owner dashboard will be inaccessible.');
}

// Discord OAuth2 sanity check
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn('Discord OAuth2 not configured properly.');
    console.warn('Required: Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env file');
}

// ── Subdomain Routing Middleware ─────────────────────────────────────────

app.use((req, res, next) => {
    const host = req.headers.host || '';
    
    // Skip subdomain logic only for the root naked domain (localhost or bronxbot.xyz)
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const hasSubdomain = host.split('.').length > (isLocal ? 1 : 2); 
    // ^ For localhost:3000, parts = ['localhost:3000'] (len 1)
    // ^ For dashboard.localhost:3000, parts = ['dashboard', 'localhost:3000'] (len 2)
    
    // If it's a naked local host, just continue to main app
    if (isLocal && host.split('.').length === 1) return next();
    if (host === 'bronxbot.xyz' || host === 'www.bronxbot.xyz') return next();

    // Subdomain routing - Preserve paths while mapping subdomains to functional hubs
    if (host.startsWith('status.')) {
        if (req.url === '/' || req.url === '') req.url = '/status-page';
    } else if (host.startsWith('api.')) {
        // Map api.domain.com/path -> /api/path
        if (!req.url.startsWith('/api/')) {
            req.url = '/api' + (req.url === '/' ? '' : req.url);
        }
    } else if (host.startsWith('docs.')) {
        if (req.url === '/' || req.url === '') req.url = '/docs';
    } else if (host.startsWith('guide.')) {
        if (req.url === '/' || req.url === '') req.url = '/guide';
    } else if (host.startsWith('dashboard.')) {
        // Clean Dashboard URLs: dashboard.bronxbot.xyz/123456789...
        const guildIdMatch = req.url.match(/^\/(\d{17,20})\/?$/);
        if (guildIdMatch) {
            req.url = `/dashboard?server=${guildIdMatch[1]}`;
        } else if (req.url === '/' || req.url === '') {
            req.url = '/servers';
        }
    }

    next();
});

// ── Global middleware ───────────────────────────────────────────────────

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// Configure EJS Templating Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'views'))); // if any raw assets are in views, otherwise handled by static '.'


// Session middleware (shared with Socket.io)
// Use RedisStore if Redis is available, otherwise fall back to MemoryStore
const sessionMiddleware = session({
    store: redisClient ? new RedisStore({ client: redisClient, prefix: 'bronx:session:' }) : undefined,
    secret: process.env.SESSION_SECRET || 'bronx-bot-dashboard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000  // 24 hours
    }
});
app.use(sessionMiddleware);

// Security middleware
app.use(securityHeaders);
app.use(initCsrfToken);
app.use(sanitizeBody);
app.use(securityLogger);

// Rate limiting for API routes
app.use('/api/', rateLimiters.api);

// Auth middleware for API routes — skip public endpoints
const PUBLIC_API_PATHS = ['/health', '/version', '/csrf-token', '/auth/user', '/bot/log', '/bot/events', '/bot/preview', '/guide', '/privacy/status', '/proxy/avatar', '/proxy/icon', '/proxy/avatar-default', '/stats', '/leaderboard', '/economy/mode', '/status/heartbeats'];
app.use('/api', (req, res, next) => {
    if (PUBLIC_API_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
        return next();
    }
    return requireAuth(req, res, next);
});

// CSRF protection for state-changing API requests
app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path.startsWith('/bot/')) return next();
    return csrfProtection(req, res, next);
});

// Guild access validation — check X-Guild-ID header against session
app.use('/api', async (req, res, next) => {
    const guildId = req.headers['x-guild-id'];
    if (!guildId || guildId === 'null' || guildId === 'undefined' || guildId === 'global') {
        return next();
    }

    // Check if user has explicit access via session
    if (req.session?.user) {
        const userGuilds = req.session.accessibleGuilds || [];
        const hasAccess = userGuilds.some(g => g.id === guildId);
        if (hasAccess) return next();
    }

    // ── Public Stats Bypass ─────────────────────────────────────────────
    // If it's a read-only request to a stats/leaderboard endpoint, check if public_stats is enabled
    const isStatsRequest = req.method === 'GET' && (
        req.path.startsWith('/stats') || 
        req.path.startsWith('/leaderboard') ||
        req.path === '/guild/settings' ||
        req.path === '/economy/mode'
    );

    if (isStatsRequest) {
        try {
            const db = getDb();
            const cacheKey = `guild:public_stats:${guildId}`;
            let isPublic = await cache.get(cacheKey);
            
            if (isPublic === null) {
                const [rows] = await db.execute('SELECT public_stats FROM guild_settings WHERE guild_id = ?', [guildId]);
                isPublic = rows.length > 0 && rows[0].public_stats === 1;
                await cache.set(cacheKey, isPublic, 300); // Cache for 5 mins
            }
            
            if (isPublic) return next();
        } catch (err) {
            console.error('[Security] Public stats check failed:', err.message);
        }
    }

    return res.status(403).json({ error: 'You do not have access to this server' });
});

// CSRF token endpoint
app.get('/api/csrf-token', getCsrfToken);

// Guild context + API call tracking
app.use(guildContext);
app.use('/api', trackApiCalls);

// ── Version endpoint ────────────────────────────────────────────────────

const pkg = require('./package.json');
app.get('/api/version', (req, res) => {
    res.json({
        status: 'ok',
        version: pkg.version,
        isPreview: process.env.IS_PULL_REQUEST === 'true' || process.env.RENDER_SERVICE_TYPE === 'web' && !!process.env.RENDER_EXTERNAL_URL?.includes('-pr-')
    });
});


// ── Page routes ─────────────────────────────────────────────────────────

// Serve landing page for all users
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'assets/avatar.png'));
});

app.get(['/privacy', '/tos', '/guide', '/status', '/status-page', '/docs'], (req, res) => {
    let page = req.path.substring(1);
    let pageName = page;
    if (page === 'status-page') page = 'status';
    if (page === 'docs') {
        page = 'docs';
        pageName = 'api';
    }
    res.render(page, { pageName: pageName });
});

app.get('/servers', (req, res) => {
    res.render('servers');
});

app.get('/dashboard', (req, res) => {
    // Optionally validate server access
    const serverId = req.query.server;
    
    // Server-side auth gate: redirect unauthenticated users to landing page
    if (!req.session?.user && !serverId) {
        const host = req.get('host') || '';
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
            // Mock a local user session for dashboard development
            req.session.user = { 
                id: '123456789', 
                username: 'LocalDev', 
                avatar: null,
                discriminator: '0000'
            };
            req.session.accessibleGuilds = [
                { id: 'mock-1', name: 'Mock Server 1', icon: null, owner: true, permissions: '8' },
                { id: 'mock-2', name: 'Mock Server 2', icon: null, owner: false, permissions: '8' }
            ];
            // No redirect on localhost
        } else {
            return res.redirect('/login');
        }
    }
    
    // If they are logged in but didn't specify a server, send them to the picker
    if (req.session?.user && !serverId) {
        return res.redirect('/servers');
    }

    // If they specified a server, serve the dashboard. 
    res.render('dashboard');
});

// Admin/Owner routes should also be handled by legacy files for now
app.get('/owner', (req, res) => {
    res.render('owner');
});



// ── Health check ────────────────────────────────────────────────────────

const { getDb, isDbHealthy } = require('./db');

app.get('/api/health', async (req, res) => {
    try {
        if (isDbHealthy()) {
            const db = getDb();
            await db.execute('SELECT 1');
        }
        res.json({
            status: 'healthy',
            database: isDbHealthy() ? 'connected' : 'degraded',
            cache: cache.getStats().connected ? 'redis' : 'memory',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'degraded',
            database: 'disconnected',
            cache: cache.getStats().connected ? 'redis' : 'memory',
            timestamp: new Date().toISOString()
        });
    }
});

// ── Mount route modules ─────────────────────────────────────────────────

// Rate limiting for OAuth callback to prevent hammering Discord API
app.use('/callback', rateLimiters.auth);

app.use(authRoutes);
app.use(guildRoutes.router);
app.use(statsRoutes.router);
app.use(economyRoutes);
app.use(socialRoutes);
app.use(moderationRoutes);
app.use(fishingRoutes);
app.use(botRoutes);
app.use(guideRoutes);
app.use(privacyRoutes);
app.use(avatarProxyRoutes);
app.use(renderRoutes);


// Leaderboard routes
const leaderboardRoutes = require('./routes/leaderboard');
app.use(leaderboardRoutes);
app.use(statusRoutes);

// Realtime routes (not a Router — registers directly on app)
registerRealtimeRoutes(app);

// SPA Fallback removed; strict legacy routes only

// ── Socket.io + realtime monitoring ─────────────────────────────────────

// Inject io into bot routes so they can emit events
botRoutes.setIo(io);

// Wire Socket.io with session auth
initSocket(io, sessionMiddleware);

// ── Error handler ───────────────────────────────────────────────────────

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────────────────

async function startServer() {
    // Initialize cache with shared Redis client (if available)
    await cache.connect(redisClient);
    cache.startCleanup();

    await initDatabase();

    initializeRealTimeMonitoring();

    server.listen(PORT, () => {
        console.log(`Dashboard server running on port ${PORT}`);
        console.log(`Access dashboard at: http://localhost:${PORT}`);
        console.log(`WebSocket server ready for real-time updates`);
        console.log(`Cache: ${cache.getStats().connected ? 'Redis' : 'In-Memory'}`);
    });
}

startServer().catch(console.error);
