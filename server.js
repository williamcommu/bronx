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

// ── App & server setup ──────────────────────────────────────────────────

const app = express();
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
const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3
});

redisClient.on('error', (err) => {
    console.error('⚠️  Redis connection error. Falling back to MemoryStore:', err.message);
    // Sessions will still work but won't persist across restarts
});

redisClient.on('connect', () => {
    console.log('✓ Redis connected for session storage');
});

redisClient.on('ready', () => {
    console.log('✓ Redis ready for session storage');
});

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

// ── Global middleware ───────────────────────────────────────────────────

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// Session middleware (shared with Socket.io)
const sessionMiddleware = session({
    store: new RedisStore({ client: redisClient, prefix: 'bronx:session:' }),
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
const PUBLIC_API_PATHS = ['/health', '/csrf-token', '/auth/user', '/bot/log', '/bot/events', '/guide', '/privacy/status', '/proxy/avatar', '/proxy/icon', '/proxy/avatar-default'];
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
app.use('/api', (req, res, next) => {
    const guildId = req.headers['x-guild-id'];
    if (!guildId || guildId === 'null' || guildId === 'undefined' || guildId === 'global') {
        return next();
    }
    if (req.session?.user) {
        const userGuilds = req.session.accessibleGuilds || [];
        const hasAccess = userGuilds.some(g => g.id === guildId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'You do not have access to this server' });
        }
    }
    next();
});

// CSRF token endpoint
app.get('/api/csrf-token', getCsrfToken);

// Guild context + API call tracking
app.use(guildContext);
app.use('/api', trackApiCalls);

// ── Page routes ─────────────────────────────────────────────────────────

// Serve landing page for all users
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/servers', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/servers.html'));
});

app.get('/dashboard', (req, res) => {
    // Server-side auth gate: redirect unauthenticated users to landing page
    if (!req.session?.user) {
        return res.redirect('/');
    }
    // Optionally validate server access
    const serverId = req.query.server;
    if (serverId && req.session.accessibleGuilds) {
        const hasAccess = req.session.accessibleGuilds.some(g => g.id === serverId);
        if (!hasAccess) {
            return res.redirect('/servers');
        }
    }
    res.sendFile(path.join(__dirname, 'html/dashboard.html'));
});

app.get('/owner', requireAuth, (req, res) => {
    if (req.session.user.id !== BOT_OWNER_ID) {
        return res.redirect('/servers');
    }
    res.sendFile(path.join(__dirname, 'html/owner.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/privacy.html'));
});

app.get('/sitemap', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/sitemap.html'));
});

// ── Health check ────────────────────────────────────────────────────────

const { getDb, isDbHealthy } = require('./db');

app.get('/api/health', async (req, res) => {
    try {
        if (!isDbHealthy()) {
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

app.use(authRoutes);
app.use(guildRoutes);
app.use(statsRoutes);
app.use(economyRoutes);
app.use(socialRoutes);
app.use(moderationRoutes);
app.use(fishingRoutes);
app.use(botRoutes);
app.use(guideRoutes);
app.use(privacyRoutes);
app.use(avatarProxyRoutes);

// Leaderboard routes
const leaderboardRoutes = require('./routes/leaderboard');
app.use(leaderboardRoutes);

// Realtime routes (not a Router — registers directly on app)
registerRealtimeRoutes(app);

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
    await cache.connect();
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
