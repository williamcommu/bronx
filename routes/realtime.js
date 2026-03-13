// Real-time monitoring: Socket.io setup, database pinging, stats broadcast, daily rollup
const { getDb } = require('../db');
const state = require('../state');
const { requireBotOwner } = require('../security');

let io = null;

// ── Export: attach io + session middleware, register Socket.io events ────

function initSocket(ioInstance, sessionMiddleware) {
    io = ioInstance;

    // Authenticate Socket.io connections with session
    io.use((socket, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    io.use((socket, next) => {
        const session = socket.request.session;
        if (session?.user) {
            socket.userId = session.user.id;
            socket.accessibleGuilds = session.accessibleGuilds || [];
            return next();
        }
        next(new Error('Authentication required'));
    });

    io.on('connection', (socket) => {
        state.connectedClients++;
        console.log(`🌐 Client connected. Total clients: ${state.connectedClients}`);

        // Send current stats to new client
        socket.emit('initial-stats', {
            dbStats: state.dbStats,
            apiCallStats: state.apiCallStats,
            serverStats: {
                uptime: process.uptime(),
                connectedClients: state.connectedClients,
                lastActivity: state.lastActivity
            }
        });

        // Handle client requesting specific server data
        socket.on('join-server', (serverId) => {
            const hasAccess = socket.accessibleGuilds.some(g => g.id === serverId);
            if (!hasAccess) {
                socket.emit('error', { message: 'You do not have access to this server' });
                return;
            }
            socket.join(`server-${serverId}`);
            console.log(`Client joined server room: ${serverId}`);
            getGuildRealtimeStats(serverId).then(guildStats => {
                if (guildStats) socket.emit('server-stats-update', guildStats);
            });
        });

        socket.on('leave-server', (serverId) => {
            socket.leave(`server-${serverId}`);
        });

        socket.on('disconnect', () => {
            state.connectedClients--;
            console.log(`🔌 Client disconnected. Total clients: ${state.connectedClients}`);
        });
    });
}

// ── Database monitoring ─────────────────────────────────────────────────

async function pingDatabase() {
    const db = getDb();
    const startTime = Date.now();
    try {
        await db.execute('SELECT 1 as ping');
        const responseTime = Date.now() - startTime;

        state.dbStats.connectionStatus = 'connected';
        state.dbStats.lastQuery = new Date();
        state.dbStats.averageResponseTime = Math.round((state.dbStats.averageResponseTime + responseTime) / 2);

        io.emit('db-ping', {
            status: 'connected',
            responseTime,
            timestamp: new Date()
        });

        return true;
    } catch (error) {
        state.dbStats.connectionStatus = 'error';
        console.error('Database ping failed:', error);

        io.emit('db-ping', {
            status: 'error',
            error: error.message,
            timestamp: new Date()
        });

        return false;
    }
}

async function getRealtimeStats() {
    try {
        const db = getDb();
        const [userCount] = await db.execute('SELECT COUNT(*) as count FROM users');
        const [commandStats] = await db.execute(`
            SELECT COUNT(*) as total_commands, 
                   COUNT(CASE WHEN used_at >= NOW() - INTERVAL 1 HOUR THEN 1 END) as last_hour
            FROM command_stats
        `);
        const [economyStats] = await db.execute('SELECT SUM(wallet + bank) as total_economy FROM users');
        const [fishStats] = await db.execute(`
            SELECT COUNT(*) as total_fish,
                   COUNT(CASE WHEN caught_at >= NOW() - INTERVAL 1 DAY THEN 1 END) as today_fish
            FROM fish_catches
        `);

        return {
            users: userCount[0]?.count || 0,
            commands: {
                total: commandStats[0]?.total_commands || 0,
                lastHour: commandStats[0]?.last_hour || 0
            },
            economy: economyStats[0]?.total_economy || 0,
            fishing: {
                total: fishStats[0]?.total_fish || 0,
                today: fishStats[0]?.today_fish || 0
            },
            timestamp: new Date()
        };
    } catch (error) {
        console.error('Failed to get realtime stats:', error);
        return null;
    }
}

async function getGuildRealtimeStats(guildId) {
    try {
        const db = getDb();
        const [[economyValue]] = await db.execute(
            'SELECT COALESCE(SUM(wallet + bank), 0) as total FROM server_users WHERE guild_id = ?',
            [guildId]
        );

        let commandsToday = { count: 0 };
        const [[guildCmds]] = await db.execute(
            'SELECT COUNT(*) as count FROM server_command_stats WHERE guild_id = ? AND used_at >= CURDATE()',
            [guildId]
        );
        commandsToday = guildCmds;

        let fishToday = { count: 0 };
        const [[guildFish]] = await db.execute(
            'SELECT COUNT(*) as count FROM server_fish_catches WHERE guild_id = ? AND caught_at >= CURDATE()',
            [guildId]
        );
        fishToday = guildFish;

        return {
            guildId,
            totalEconomyValue: economyValue.total || 0,
            commandsToday: commandsToday.count,
            fishCaughtToday: fishToday.count,
            timestamp: new Date()
        };
    } catch (error) {
        console.error(`Failed to get guild realtime stats for ${guildId}:`, error);
        return null;
    }
}

// ── Daily Stats Rollup ──────────────────────────────────────────────────

async function runDailyStatsRollup() {
    const db = getDb();
    console.log('[rollup] starting daily stats rollup...');
    try {
        await db.execute(`
            INSERT INTO guild_daily_stats (guild_id, stat_date, channel_id, messages_count, edits_count, deletes_count)
            SELECT guild_id, DATE(created_at), '__guild__',
                   SUM(event_type = 'message'),
                   SUM(event_type = 'edit'),
                   SUM(event_type = 'delete')
            FROM guild_message_events
            WHERE DATE(created_at) < CURDATE()
            GROUP BY guild_id, DATE(created_at)
            ON DUPLICATE KEY UPDATE
                messages_count = VALUES(messages_count),
                edits_count = VALUES(edits_count),
                deletes_count = VALUES(deletes_count)
        `);

        await db.execute(`
            INSERT INTO guild_daily_stats (guild_id, stat_date, channel_id, messages_count, edits_count, deletes_count)
            SELECT guild_id, DATE(created_at), channel_id,
                   SUM(event_type = 'message'),
                   SUM(event_type = 'edit'),
                   SUM(event_type = 'delete')
            FROM guild_message_events
            WHERE DATE(created_at) < CURDATE()
            GROUP BY guild_id, DATE(created_at), channel_id
            ON DUPLICATE KEY UPDATE
                messages_count = VALUES(messages_count),
                edits_count = VALUES(edits_count),
                deletes_count = VALUES(deletes_count)
        `);

        await db.execute(`
            INSERT INTO guild_daily_stats (guild_id, stat_date, channel_id, joins_count, leaves_count)
            SELECT guild_id, DATE(created_at), '__guild__',
                   SUM(event_type = 'join'),
                   SUM(event_type = 'leave')
            FROM guild_member_events
            WHERE DATE(created_at) < CURDATE()
              AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 8 DAY)
            GROUP BY guild_id, DATE(created_at)
            ON DUPLICATE KEY UPDATE
                joins_count = VALUES(joins_count),
                leaves_count = VALUES(leaves_count)
        `);

        await db.execute(`
            INSERT INTO guild_daily_stats (guild_id, stat_date, channel_id, commands_count)
            SELECT guild_id, usage_date, '__guild__', SUM(use_count)
            FROM guild_command_usage
            WHERE usage_date < CURDATE()
              AND usage_date >= DATE_SUB(CURDATE(), INTERVAL 8 DAY)
            GROUP BY guild_id, usage_date
            ON DUPLICATE KEY UPDATE
                commands_count = VALUES(commands_count)
        `);

        await db.execute(`
            INSERT INTO guild_daily_stats (guild_id, stat_date, channel_id, active_users)
            SELECT guild_id, DATE(created_at), '__guild__', COUNT(DISTINCT user_id)
            FROM guild_message_events
            WHERE user_id != '0' AND DATE(created_at) < CURDATE()
            GROUP BY guild_id, DATE(created_at)
            ON DUPLICATE KEY UPDATE
                active_users = VALUES(active_users)
        `);

        const [purgeResult] = await db.execute(
            `DELETE FROM guild_message_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );
        console.log(`[rollup] purged ${purgeResult?.affectedRows || 0} old message events`);

        console.log('[rollup] daily stats rollup complete');
    } catch (error) {
        console.error('[rollup] daily stats rollup failed:', error.message);
    }
}

// ── Start all monitoring intervals ──────────────────────────────────────

function initializeRealTimeMonitoring() {
    console.log('🚀 Initializing real-time monitoring...');

    // Database ping every 30 seconds
    setInterval(async () => {
        await pingDatabase();
    }, 30000);

    // Real-time stats every 5 seconds
    setInterval(async () => {
        const stats = await getRealtimeStats();
        if (stats) {
            io.emit('stats-update', stats);
        }

        const rooms = io.sockets.adapter.rooms;
        for (const [room] of rooms) {
            if (!room.startsWith('server-')) continue;
            const guildId = room.replace('server-', '');
            const guildStats = await getGuildRealtimeStats(guildId);
            if (guildStats) {
                io.to(room).emit('server-stats-update', guildStats);
            }
        }
    }, 5000);

    // API call rate calculation every minute
    setInterval(() => {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        state.apiCallStats.recentCalls = state.apiCallStats.recentCalls.filter(time => time > oneMinuteAgo);
        state.apiCallStats.callsPerMinute = state.apiCallStats.recentCalls.length;

        io.emit('api-stats-update', {
            callsPerMinute: state.apiCallStats.callsPerMinute,
            totalCalls: state.apiCallStats.totalCalls
        });
    }, 60000);

    // Daily rollup — run every hour, but only process yesterday's data once per day
    let lastRollupDate = null;
    setInterval(async () => {
        const today = new Date().toISOString().slice(0, 10);
        if (lastRollupDate === today) return;
        await runDailyStatsRollup();
        lastRollupDate = today;
    }, 60 * 60 * 1000);

    // Initial ping
    pingDatabase();
}

// ── Express routes for realtime endpoints ───────────────────────────────

function registerRoutes(app) {
    app.get('/api/realtime/status', (req, res) => {
        res.json({
            server: {
                uptime: process.uptime(),
                connectedClients: state.connectedClients,
                lastActivity: state.lastActivity
            },
            database: state.dbStats,
            apiStats: state.apiCallStats
        });
    });

    app.post('/api/realtime/trigger-update', async (req, res) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const stats = await getRealtimeStats();
        if (stats) {
            io.emit('manual-update', stats);
            res.json({ success: true, stats });
        } else {
            res.status(500).json({ error: 'Failed to get stats' });
        }
    });

    app.get('/api/realtime/performance', requireBotOwner, (req, res) => {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        res.json({
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            uptime: process.uptime(),
            connectedClients: state.connectedClients
        });
    });
}

module.exports = { initSocket, initializeRealTimeMonitoring, registerRoutes };
