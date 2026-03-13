// Custom middleware: guild context, server economy check, API call tracking
const { getDb } = require('./db');
const state = require('./state');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

// Middleware to add guild context from X-Guild-ID header
function guildContext(req, res, next) {
    const headerGuildId = req.headers['x-guild-id'];
    req.guildId = (headerGuildId && headerGuildId !== 'null' && headerGuildId !== 'undefined')
        ? headerGuildId
        : 'global';
    next();
}

// Middleware: require economy_mode = 'server' for economy modification endpoints
// Bot owner bypasses this check
async function requireServerEconomy(req, res, next) {
    if (req.session?.user?.id === BOT_OWNER_ID) return next();

    const guildId = req.guildId;
    if (!guildId || guildId === 'global') {
        return res.status(403).json({ error: 'Server economy is not enabled for this server.' });
    }

    try {
        const db = getDb();
        const [rows] = await db.execute(
            "SELECT JSON_EXTRACT(blocked_commands, '$.economy_mode') as mode FROM guild_settings WHERE guild_id = ?",
            [guildId]
        ).catch(() => [[]]);
        const mode = rows.length > 0 && rows[0].mode ? JSON.parse(rows[0].mode) : 'global';
        if (mode !== 'server') {
            return res.status(403).json({ error: 'Economy is in global mode. Only the bot owner can modify economy settings.' });
        }
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Economy is in global mode. Only the bot owner can modify economy settings.' });
    }
}

// Track API calls for real-time stats
function trackApiCalls(req, res, next) {
    state.apiCallStats.totalCalls++;
    state.apiCallStats.recentCalls.push(Date.now());
    state.lastActivity = new Date();
    next();
}

module.exports = { guildContext, requireServerEconomy, trackApiCalls };
