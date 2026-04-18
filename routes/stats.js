// Statistics routes: overview, recent activity, guild stats, commands, activity, channels
const express = require('express');
const axios = require('axios');
const router = express.Router();

const { getDb } = require('../db');
const { cache } = require('../cache');

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// ── Utility ─────────────────────────────────────────────────────────────

/**
 * Resolve Discord member info (username, avatar) for a guild.
 * Returns a Map of userId → { username, display_name, avatar, avatar_url, proxy_avatar_url }
 * Uses cache to avoid spamming Discord API.
 */
async function resolveGuildMembers(guildId) {
    const memberMap = {};
    if (!guildId) return memberMap;
    try {
        const cacheKey = `discord:members:${guildId}`;
        let members = await cache.get(cacheKey);
        if (!members && process.env.DISCORD_TOKEN) {
            // Paginate to fetch all members (Discord limits to 1000 per request)
            members = [];
            let after = '0';
            for (let page = 0; page < 10; page++) {  // cap at 10k members
                const resp = await axios.get(
                    `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000&after=${after}`, {
                    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                });
                const batch = resp.data;
                if (!batch || batch.length === 0) break;
                members.push(...batch.map(m => ({
                    id: m.user.id,
                    username: m.user.username,
                    display_name: m.nick || m.user.global_name || m.user.username,
                    avatar: m.user.avatar
                })));
                if (batch.length < 1000) break;  // last page
                after = batch[batch.length - 1].user.id;
            }
            console.log(`[resolveGuildMembers] Fetched ${members.length} members for guild ${guildId}`);
            await cache.set(cacheKey, members, 120);
        }
        if (members) {
            for (const m of members) {
                memberMap[m.id] = {
                    ...m,
                    avatar_url: m.avatar
                        ? `https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.${m.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
                        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(m.id) >> 22n) % 6n}.png`,
                    proxy_avatar_url: m.avatar
                        ? `/api/proxy/avatar/${m.id}?hash=${m.avatar}&size=64`
                        : `/api/proxy/avatar/${m.id}`
                };
            }
        }
    } catch (e) {
        console.warn('resolveGuildMembers failed:', e.message);
    }
    return memberMap;
}

/**
 * Resolve Discord channel names for a guild.
 * Returns a map of channelId → channel name string.
 */
async function resolveGuildChannels(guildId) {
    const channelMap = {};
    if (!guildId) return channelMap;
    try {
        const cacheKey = `discord:channels:${guildId}`;
        let channels = await cache.get(cacheKey);
        if (!channels && process.env.DISCORD_TOKEN) {
            const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
            });
            channels = resp.data;
            await cache.set(cacheKey, channels, 300);
        }
        if (channels) {
            for (const ch of channels) channelMap[ch.id] = ch.name;
        }
    } catch (e) {
        console.warn('resolveGuildChannels failed:', e.message);
    }
    return channelMap;
}

/**
 * Enrich an array of objects that have a `user_id` field 
 * with `username`, `avatar_url`, and `proxy_avatar_url`.
 */
function enrichWithMembers(rows, memberMap) {
    return rows.map(row => {
        const uid = String(row.user_id);
        const member = memberMap[uid];
        return {
            ...row,
            username: member?.display_name || member?.username || null,
            avatar_url: member?.avatar_url || null,
            proxy_avatar_url: member?.proxy_avatar_url || `/api/proxy/avatar/${uid}`
        };
    });
}

function timeAgo(date) {
    const now = new Date();
    const diffInMs = now - new Date(date);
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    
    if (diffInMinutes < 1) return 'just now';
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} days ago`;
}

function rangeDays(req) {
    const r = req.query.range || '7d';
    if (r === 'today' || r === '0') return 0;
    if (r === '30d') return 30;
    if (r === '14d') return 14;
    if (r === 'all') return -1;
    return 7;
}

/** Build a date-condition SQL fragment for either DATE or TIMESTAMP column. */
function dateCondition(col, days, isTimestamp = false) {
    if (days === -1) return '1=1'; // all time
    if (days === 0) {
        return isTimestamp ? `${col} >= CURDATE()` : `${col} = CURDATE()`;
    }
    return isTimestamp
        ? `${col} >= DATE_SUB(NOW(), INTERVAL ${parseInt(days)} DAY)`
        : `${col} >= DATE_SUB(CURDATE(), INTERVAL ${parseInt(days)} DAY)`;
}

// ── Overview Statistics ─────────────────────────────────────────────────

router.get('/api/stats/overview', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;

        if (!guildId || guildId === 'global') {
            return res.json({
                memberCount: 0,
                totalEconomyValue: 0,
                commandsToday: 0,
                newMembersToday: 0,
                noServerSelected: true
            });
        }

        // Per-guild: real member count from Discord API
        let memberCount = null;
        if (process.env.DISCORD_TOKEN) {
            try {
                const guildRes = await axios.get(
                    `${DISCORD_API_BASE}/guilds/${guildId}?with_counts=true`,
                    { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } }
                );
                memberCount = guildRes.data.approximate_member_count ?? guildRes.data.member_count ?? null;
            } catch (e) {
                console.warn('Discord guild member count fetch failed:', e.response?.data || e.message);
            }
        }

        let economyTotal = 0;
        let commandsTodayCount = 0;
        let newMembersTodayCount = 0;

        // Economy value: try tables in order of preference (v2 → v1 → global)
        // v2 migration drops server_users; the global `users` table is the source of truth
        // We scope to guild members by fetching the member list from Discord
        const tableExists = async (tableName) => {
            try {
                const [rows] = await db.execute(`SELECT 1 FROM ${tableName} LIMIT 1`);
                return true;
            } catch { return false; }
        };

        try {
            // Try server_users first (v1 schema)
            if (await tableExists('server_users')) {
                const [ev] = await db.execute(
                    'SELECT COALESCE(SUM(wallet + bank), 0) as total FROM server_users WHERE guild_id = ?',
                    [guildId]
                );
                economyTotal = Number(ev[0]?.total || 0);
            }
            // If server_users returned 0 or doesn't exist, try global users table with member scoping
            if (economyTotal === 0) {
                // Fetch guild member IDs for scoping
                let memberIds = null;
                try {
                    const { cache: appCache } = require('../cache');
                    const cacheKey = `discord:member_ids:${guildId}`;
                    memberIds = await appCache.get(cacheKey);
                    if (!memberIds && process.env.DISCORD_TOKEN) {
                        const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
                            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                        });
                        memberIds = resp.data.map(m => m.user.id);
                        await appCache.set(cacheKey, memberIds, 120);
                    }
                } catch (e) { console.warn('member fetch for economy scoping failed:', e.message); }

                if (memberIds && memberIds.length > 0) {
                    const placeholders = memberIds.map(() => '?').join(',');
                    const [ev] = await db.execute(
                        `SELECT COALESCE(SUM(wallet + COALESCE(bank, 0)), 0) as total FROM users WHERE user_id IN (${placeholders})`,
                        memberIds
                    );
                    economyTotal = Number(ev[0]?.total || 0);
                } else {
                    // No member list available; fall back to all users
                    const [ev] = await db.execute(
                        'SELECT COALESCE(SUM(wallet + COALESCE(bank, 0)), 0) as total FROM users'
                    );
                    economyTotal = Number(ev[0]?.total || 0);
                }
            }
        } catch (e) { console.warn('economy value query failed:', e.message); }

        // Commands today: use guild_command_usage first (same table the 7-day trend chart uses)
        // Then fall back to server_command_stats (v1) or command_stats
        try {
            const [guildCmds] = await db.execute(
                'SELECT COALESCE(SUM(use_count), 0) as count FROM guild_command_usage WHERE guild_id = ? AND usage_date = CURDATE()',
                [guildId]
            );
            commandsTodayCount = Number(guildCmds[0]?.count || 0);
        } catch (e) {
            try {
                const [guildCmds] = await db.execute(
                    'SELECT COUNT(*) as count FROM server_command_stats WHERE guild_id = ? AND used_at >= CURDATE()',
                    [guildId]
                );
                commandsTodayCount = Number(guildCmds[0]?.count || 0);
            } catch (e2) {
                // Final fallback: command_stats table
                try {
                    const [rows] = await db.execute(
                        'SELECT COUNT(*) as count FROM command_stats WHERE guild_id = ? AND used_at >= CURDATE()',
                        [guildId]
                    );
                    commandsTodayCount = Number(rows[0]?.count || 0);
                } catch (e3) { console.warn('commands today query failed:', e3.message); }
            }
        }

        // New members today: count members who joined today via Discord API guild info
        // We use the guild_member_events table if available, else approximate from Discord
        try {
            const [newMembers] = await db.execute(
                `SELECT COUNT(*) as count FROM guild_member_events WHERE guild_id = ? AND event_type = 'join' AND created_at >= CURDATE()`,
                [guildId]
            );
            newMembersTodayCount = Number(newMembers[0]?.count || 0);
        } catch (e) {
            console.warn('new members today query failed:', e.message);
        }

        res.json({
            memberCount,
            totalEconomyValue: economyTotal,
            commandsToday: commandsTodayCount,
            newMembersToday: newMembersTodayCount
        });
    } catch (error) {
        console.error('Overview stats error:', error);
        res.status(500).json({ error: 'Failed to fetch overview stats' });
    }
});

// ── Overview Trend (7-day multi-metric) ─────────────────────────────────

router.get('/api/stats/overview/trend', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const days = 7;

        if (!guildId || guildId === 'global') {
            return res.json({ labels: [], messages: [], activeUsers: [], newMembers: [], commands: [] });
        }

        // Build a full 7-day label array
        const labels = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            labels.push(d.toISOString().slice(0, 10));
        }

        const emptyMap = () => Object.fromEntries(labels.map(l => [l, 0]));

        // Messages per day
        const msgMap = emptyMap();
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date, COUNT(*) as cnt
                 FROM guild_message_events
                 WHERE guild_id = ? AND event_type = 'message'
                   AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at)`,
                [guildId, days]
            );
            rows.forEach(r => {
                const key = new Date(r.date).toISOString().slice(0, 10);
                if (key in msgMap) msgMap[key] = Number(r.cnt);
            });
        } catch (e) {
            try {
                const [rows] = await db.execute(
                    `SELECT stat_date as date, messages_count as cnt
                     FROM guild_daily_stats
                     WHERE guild_id = ? AND channel_id = '__guild__'
                       AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                     ORDER BY stat_date ASC`,
                    [guildId, days]
                );
                rows.forEach(r => {
                    const key = new Date(r.date).toISOString().slice(0, 10);
                    if (key in msgMap) msgMap[key] = Number(r.cnt || 0);
                });
            } catch (e2) { /* ignore */ }
        }

        // Active users per day
        const activeMap = emptyMap();
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as cnt
                 FROM guild_message_events
                 WHERE guild_id = ? AND user_id != '0'
                   AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at)`,
                [guildId, days]
            );
            rows.forEach(r => {
                const key = new Date(r.date).toISOString().slice(0, 10);
                if (key in activeMap) activeMap[key] = Number(r.cnt);
            });
        } catch (e) { /* ignore */ }

        // New members per day
        const memberMap = emptyMap();
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date, COUNT(*) as cnt
                 FROM guild_member_events
                 WHERE guild_id = ? AND event_type = 'join'
                   AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at)`,
                [guildId, days]
            );
            rows.forEach(r => {
                const key = new Date(r.date).toISOString().slice(0, 10);
                if (key in memberMap) memberMap[key] = Number(r.cnt);
            });
        } catch (e) { /* ignore */ }

        // Commands per day
        const cmdMap = emptyMap();
        try {
            const [rows] = await db.execute(
                `SELECT usage_date as date, SUM(use_count) as cnt
                 FROM guild_command_usage
                 WHERE guild_id = ? AND usage_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY usage_date`,
                [guildId, days]
            );
            rows.forEach(r => {
                const key = new Date(r.date).toISOString().slice(0, 10);
                if (key in cmdMap) cmdMap[key] = Number(r.cnt);
            });
        } catch (e) { /* ignore */ }

        res.json({
            labels,
            messages:    labels.map(l => msgMap[l]),
            activeUsers: labels.map(l => activeMap[l]),
            newMembers:  labels.map(l => memberMap[l]),
            commands:    labels.map(l => cmdMap[l])
        });
    } catch (error) {
        console.error('Overview trend error:', error);
        res.status(500).json({ error: 'Failed to fetch overview trend' });
    }
});

// ── Recent Activity ─────────────────────────────────────────────────────

// Format time as 12-hour with AM/PM (e.g., "9:45 PM")
function formatTime12h(date) {
    const d = new Date(date);
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 becomes 12
    return `${hours}:${minutes} ${ampm}`;
}

// Build Discord avatar URL via proxy (avoids 404s when hash is stale)
function getAvatarUrl(userId, avatarHash) {
    if (!userId) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    if (avatarHash) {
        return `/api/proxy/avatar/${userId}?hash=${avatarHash}&size=64`;
    }
    // Default Discord avatar based on user ID
    const defaultIndex = (BigInt(userId) >> BigInt(22)) % BigInt(6);
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

router.get('/api/stats/recent-activity', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const limit = Math.min(parseInt(req.query.limit) || 5, 20);

        if (!guildId || guildId === 'global') return res.json([]);

        // Try new guild_activity_log table first
        let activities = [];
        let usedNewTable = false;

        try {
            const [rows] = await db.execute(`
                SELECT user_id, user_name, user_avatar, source, action, created_at
                FROM guild_activity_log
                WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                ORDER BY created_at DESC
                LIMIT ${limit}
            `, [guildId]);

            if (rows.length > 0) {
                usedNewTable = true;
                activities = rows.map(row => ({
                    avatar: getAvatarUrl(row.user_id, row.user_avatar),
                    user_name: row.user_name || null,
                    time: formatTime12h(row.created_at),
                    source: row.source, // 'DB' or 'DC'
                    action: row.action,
                    timestamp: row.created_at,
                    // Fallback icon for legacy frontend
                    icon: row.source === 'DB' ? 'cog' : 'discord',
                    description: row.action
                }));
            }
        } catch (e) {
            // Table might not exist yet — fall back to old behavior
            if (!e.message.includes("doesn't exist")) {
                console.warn('Activity log query failed:', e.message);
            }
        }

        // Fallback to old behavior if no activity log entries
        if (!usedNewTable) {
            let commandActivity = [];
            let fishActivity = [];

            try {
                [commandActivity] = await db.execute(`
                    SELECT 'terminal' as icon,
                           CONCAT('Command used: ', command_name) as description,
                           used_at as time
                    FROM command_stats
                    WHERE guild_id = ? AND used_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                    ORDER BY used_at DESC
                    LIMIT 3
                `, [guildId]);
            } catch (e) { console.warn('command activity query failed:', e.message); }

            try {
                [fishActivity] = await db.execute(`
                    SELECT 'fish' as icon,
                           CONCAT('Fish caught: ', COALESCE(fish_name, 'Unknown')) as description,
                           caught_at as time
                    FROM fish_catches
                    WHERE guild_id = ? AND caught_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                    ORDER BY caught_at DESC
                    LIMIT 2
                `, [guildId]);
            } catch (e) { console.warn('fish activity query failed:', e.message); }

            const allActivities = [...commandActivity, ...fishActivity]
                .sort((a, b) => new Date(b.time) - new Date(a.time))
                .slice(0, limit);

            activities = allActivities.map(activity => ({
                icon: activity.icon,
                description: activity.description,
                time: timeAgo(activity.time),
                // New format fields (empty for fallback)
                avatar: null,
                source: null,
                action: activity.description
            }));
        }

        res.json(activities);
    } catch (error) {
        console.error('Recent activity error:', error);
        res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
});

// Paginated activity for "See More" modal
router.get('/api/stats/recent-activity/all', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = (page - 1) * limit;

        if (!guildId || guildId === 'global') {
            return res.json({ activities: [], total: 0, page: 1, totalPages: 0 });
        }

        // Get total count
        let total = 0;
        try {
            const [[{ cnt }]] = await db.execute(
                `SELECT COUNT(*) as cnt FROM guild_activity_log WHERE guild_id = ?`,
                [guildId]
            );
            total = cnt;
        } catch (e) {
            if (e.message.includes("doesn't exist")) {
                return res.json({ activities: [], total: 0, page: 1, totalPages: 0 });
            }
            throw e;
        }

        // Get page data
        const [rows] = await db.execute(`
            SELECT user_id, user_name, user_avatar, source, action, created_at
            FROM guild_activity_log
            WHERE guild_id = ?
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `, [guildId]);

        const activities = rows.map(row => ({
            avatar: getAvatarUrl(row.user_id, row.user_avatar),
            user_name: row.user_name || null,
            time: formatTime12h(row.created_at),
            source: row.source,
            action: row.action,
            timestamp: row.created_at
        }));

        res.json({
            activities,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Paginated activity error:', error);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// ── Guild Stats Summary ─────────────────────────────────────────────────

router.get('/api/stats', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({});
        const days = rangeDays(req);

        let commandsRun = 0, messagesSeen = 0, activeUsers = 0;
        let topCommands = [];

        try {
            const [rows] = await db.execute(
                `SELECT COALESCE(SUM(use_count), 0) as total FROM guild_command_usage
                 WHERE guild_id = ? AND usage_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                [guildId, days]
            );
            commandsRun = rows[0]?.total || 0;
        } catch (e) { console.warn('stats commands query failed:', e.message); }

        try {
            const [rows] = await db.execute(
                `SELECT COUNT(*) as total FROM guild_message_events
                 WHERE guild_id = ? AND event_type = 'message'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [guildId, days]
            );
            messagesSeen = rows[0]?.total || 0;
        } catch (e) {
            try {
                const [rows] = await db.execute(
                    `SELECT COALESCE(SUM(messages_count), 0) as total FROM guild_daily_stats
                     WHERE guild_id = ? AND channel_id = '__guild__'
                       AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                    [guildId, days]
                );
                messagesSeen = rows[0]?.total || 0;
            } catch (e2) { console.warn('stats messages query failed:', e2.message); }
        }

        try {
            const [rows] = await db.execute(
                `SELECT COUNT(DISTINCT user_id) as total FROM guild_message_events
                 WHERE guild_id = ? AND user_id != '0'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [guildId, days]
            );
            activeUsers = rows[0]?.total || 0;
        } catch (e) { console.warn('stats active users query failed:', e.message); }

        try {
            const [rows] = await db.execute(
                `SELECT command_name, SUM(use_count) as total
                 FROM guild_command_usage
                 WHERE guild_id = ? AND usage_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY command_name ORDER BY total DESC LIMIT 20`,
                [guildId, days]
            );
            topCommands = rows.map(r => ({ command: r.command_name, count: Number(r.total) }));
        } catch (e) { console.warn('stats top commands query failed:', e.message); }

        res.json({
            total_commands: commandsRun,
            total_messages: messagesSeen,
            active_users: activeUsers,
            popular_commands: topCommands,
            range: `${days}d`
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ── Detailed Command Stats ──────────────────────────────────────────────

router.get('/api/stats/commands', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ topCommands: [], commandsByChannel: [] });
        const days = rangeDays(req);
        const filterCmd = req.query.command || null;
        const filterChan = req.query.channel || null;

        let where = 'guild_id = ? AND usage_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)';
        let params = [guildId, days];
        if (filterCmd) { where += ' AND command_name = ?'; params.push(filterCmd); }
        if (filterChan) { where += ' AND channel_id = ?'; params.push(filterChan); }

        let topCommands = [];
        try {
            const [rows] = await db.execute(
                `SELECT command_name, SUM(use_count) as total
                 FROM guild_command_usage WHERE ${where}
                 GROUP BY command_name ORDER BY total DESC LIMIT 50`,
                params
            );
            topCommands = rows.map(r => ({ command: r.command_name, count: Number(r.total) }));
        } catch (e) { console.warn('stats/commands top query failed:', e.message); }

        let commandsByChannel = [];
        try {
            const [rows] = await db.execute(
                `SELECT channel_id, command_name, SUM(use_count) as total
                 FROM guild_command_usage WHERE ${where}
                 GROUP BY channel_id, command_name ORDER BY total DESC LIMIT 100`,
                params
            );
            commandsByChannel = rows.map(r => ({
                channel_id: r.channel_id,
                command: r.command_name,
                count: Number(r.total)
            }));
        } catch (e) { console.warn('stats/commands channel query failed:', e.message); }

        // Resolve channel names
        const channelMap = await resolveGuildChannels(guildId);
        commandsByChannel = commandsByChannel.map(r => ({
            ...r,
            channel_name: channelMap[r.channel_id] ? `#${channelMap[r.channel_id]}` : null
        })).filter(r => r.channel_name);

        let dailyTrend = [];
        try {
            const [rows] = await db.execute(
                `SELECT usage_date as date, SUM(use_count) as total
                 FROM guild_command_usage WHERE ${where}
                 GROUP BY usage_date ORDER BY usage_date ASC`,
                params
            );
            dailyTrend = rows.map(r => ({ date: r.date, count: Number(r.total) }));
        } catch (e) { console.warn('stats/commands trend query failed:', e.message); }

        res.json({ topCommands, commandsByChannel, dailyTrend });
    } catch (error) {
        console.error('Stats commands error:', error);
        res.status(500).json({ error: 'Failed to fetch command stats' });
    }
});

// ── Activity Stats ──────────────────────────────────────────────────────

router.get('/api/stats/activity', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({});
        const days = rangeDays(req);

        let dailyMessages = [], dailyMembers = [], dailyActiveUsers = [];
        let messagesToday = 0, activeToday = 0, newMembersWeek = 0, commandsToday = 0;

        // daily message breakdown
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date,
                        SUM(event_type = 'message') as messages,
                        SUM(event_type = 'edit') as edits,
                        SUM(event_type = 'delete') as deletes
                 FROM guild_message_events
                 WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at) ORDER BY date ASC`,
                [guildId, days]
            );
            dailyMessages = rows.map(r => ({
                date: r.date,
                messages: Number(r.messages || 0),
                edits: Number(r.edits || 0),
                deletes: Number(r.deletes || 0)
            }));
        } catch (e) {
            try {
                const [rows] = await db.execute(
                    `SELECT stat_date as date, messages_count as messages, edits_count as edits, deletes_count as deletes
                     FROM guild_daily_stats
                     WHERE guild_id = ? AND channel_id = '__guild__'
                       AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                     ORDER BY stat_date ASC`,
                    [guildId, days]
                );
                dailyMessages = rows.map(r => ({
                    date: r.date,
                    messages: Number(r.messages || 0),
                    edits: Number(r.edits || 0),
                    deletes: Number(r.deletes || 0)
                }));
            } catch (e2) { console.warn('activity messages fallback failed:', e2.message); }
        }

        // daily member events
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date,
                        SUM(event_type = 'join') as joins,
                        SUM(event_type = 'leave') as leaves
                 FROM guild_member_events
                 WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at) ORDER BY date ASC`,
                [guildId, days]
            );
            dailyMembers = rows.map(r => ({
                date: r.date,
                joins: Number(r.joins || 0),
                leaves: Number(r.leaves || 0),
                net: Number(r.joins || 0) - Number(r.leaves || 0)
            }));
        } catch (e) { console.warn('activity members query failed:', e.message); }

        // daily active users
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as count
                 FROM guild_message_events
                 WHERE guild_id = ? AND user_id != '0'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at) ORDER BY date ASC`,
                [guildId, days]
            );
            dailyActiveUsers = rows.map(r => ({ date: r.date, count: Number(r.count) }));
        } catch (e) { console.warn('activity active users query failed:', e.message); }

        // today's quick stats
        try {
            const [r1] = await db.execute(
                `SELECT COUNT(*) as c FROM guild_message_events
                 WHERE guild_id = ? AND event_type = 'message' AND created_at >= CURDATE()`, [guildId]);
            messagesToday = r1[0]?.c || 0;
        } catch (e) { /* ignore */ }

        try {
            const [r2] = await db.execute(
                `SELECT COUNT(DISTINCT user_id) as c FROM guild_message_events
                 WHERE guild_id = ? AND user_id != '0' AND created_at >= CURDATE()`, [guildId]);
            activeToday = r2[0]?.c || 0;
        } catch (e) { /* ignore */ }

        try {
            const [r3] = await db.execute(
                `SELECT COUNT(*) as c FROM guild_member_events
                 WHERE guild_id = ? AND event_type = 'join'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`, [guildId]);
            newMembersWeek = r3[0]?.c || 0;
        } catch (e) { /* ignore */ }

        try {
            const [r4] = await db.execute(
                `SELECT COALESCE(SUM(use_count), 0) as c FROM guild_command_usage
                 WHERE guild_id = ? AND usage_date = CURDATE()`, [guildId]);
            commandsToday = r4[0]?.c || 0;
        } catch (e) { /* ignore */ }

        res.json({
            dailyMessages,
            dailyMembers,
            dailyActiveUsers,
            messagesToday,
            dailyActiveUsersToday: activeToday,
            newMembersWeek,
            commandsToday,
            range: `${days}d`
        });
    } catch (error) {
        console.error('Activity stats error:', error);
        res.status(500).json({ error: 'Failed to fetch activity stats' });
    }
});

// ── Channel Stats ───────────────────────────────────────────────────────

router.get('/api/stats/channels', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json([]);
        const days = rangeDays(req);

        let channels = [];
        try {
            const [rows] = await db.execute(
                `SELECT channel_id, SUM(use_count) as total
                 FROM guild_command_usage
                 WHERE guild_id = ? AND usage_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY channel_id ORDER BY total DESC LIMIT 50`,
                [guildId, days]
            );
            channels = rows.map(r => ({ channel_id: r.channel_id, count: Number(r.total) }));
        } catch (e) { console.warn('stats/channels query failed:', e.message); }

        // Resolve channel names
        const channelMap = await resolveGuildChannels(guildId);
        channels = channels.map(ch => ({
            ...ch,
            channel_name: channelMap[ch.channel_id] ? `#${channelMap[ch.channel_id]}` : null
        })).filter(ch => ch.channel_name);

        res.json(channels);
    } catch (error) {
        console.error('Stats channels error:', error);
        res.status(500).json({ error: 'Failed to fetch channel stats' });
    }
});

// ── Economy Analytics ───────────────────────────────────────────────────

router.get('/api/stats/economy', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ error: 'No guild selected' });
        
        // Economy overview for the guild
        let totalWealth = 0, totalWallet = 0, totalBank = 0, userCount = 0;
        let topEarners = [], wealthDistribution = [];
        let gamblingOverview = { totalGames: 0, totalBet: 0, totalWon: 0, totalLost: 0, gameBreakdown: [] };
        
        // Try server-scoped tables first, fall back to global
        // v2 migration drops server_users, so try users table with member scoping
        let serverUsersExists = false;
        try {
            await db.execute('SELECT 1 FROM server_users LIMIT 1');
            serverUsersExists = true;
        } catch { /* table doesn't exist */ }
        
        if (serverUsersExists) {
            try {
                const [overview] = await db.execute(
                    `SELECT COUNT(*) as user_count, 
                            COALESCE(SUM(wallet),0) as total_wallet, 
                            COALESCE(SUM(bank),0) as total_bank,
                            COALESCE(SUM(wallet + COALESCE(bank,0)),0) as total_wealth
                     FROM server_users WHERE guild_id = ?`, [guildId]
                );
                if (overview[0]) {
                    totalWealth = Number(overview[0].total_wealth);
                    totalWallet = Number(overview[0].total_wallet);
                    totalBank = Number(overview[0].total_bank);
                    userCount = Number(overview[0].user_count);
                }
            } catch (e) { console.warn('server_users economy failed:', e.message); }
        }
        
        // If server_users didn't exist or returned 0, try global users with member scoping
        if (totalWealth === 0) {
            try {
                // Get guild member IDs
                let memberIds = null;
                try {
                    const { cache: memberCache } = require('../cache');
                    const cacheKey = `discord:member_ids:${guildId}`;
                    memberIds = await memberCache.get(cacheKey);
                    if (!memberIds && process.env.DISCORD_TOKEN) {
                        const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
                            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                        });
                        memberIds = resp.data.map(m => m.user.id);
                        await memberCache.set(cacheKey, memberIds, 120);
                    }
                } catch (me) { console.warn('member fetch for economy scoping:', me.message); }

                if (memberIds && memberIds.length > 0) {
                    const placeholders = memberIds.map(() => '?').join(',');
                    const [overview] = await db.execute(
                        `SELECT COUNT(*) as user_count, 
                                COALESCE(SUM(wallet),0) as total_wallet, 
                                COALESCE(SUM(bank),0) as total_bank
                         FROM users WHERE (wallet > 0 OR bank > 0) AND user_id IN (${placeholders})`,
                        memberIds
                    );
                    if (overview[0]) {
                        totalWallet = Number(overview[0].total_wallet);
                        totalBank = Number(overview[0].total_bank);
                        totalWealth = totalWallet + totalBank;
                        userCount = Number(overview[0].user_count);
                    }
                } else {
                    const [overview] = await db.execute(
                        `SELECT COUNT(*) as user_count, 
                                COALESCE(SUM(wallet),0) as total_wallet, 
                                COALESCE(SUM(bank),0) as total_bank
                         FROM users WHERE wallet > 0 OR bank > 0`
                    );
                    if (overview[0]) {
                        totalWallet = Number(overview[0].total_wallet);
                        totalBank = Number(overview[0].total_bank);
                        totalWealth = totalWallet + totalBank;
                        userCount = Number(overview[0].user_count);
                    }
                }
            } catch (e2) { console.warn('economy overview failed:', e2.message); }
        }
        
        // Wealth distribution brackets
        try {
            const brackets = [
                { label: '0-1K', min: 0, max: 1000 },
                { label: '1K-10K', min: 1000, max: 10000 },
                { label: '10K-100K', min: 10000, max: 100000 },
                { label: '100K-1M', min: 100000, max: 1000000 },
                { label: '1M+', min: 1000000, max: 999999999999 }
            ];
            // Determine which table to use
            const wealthTable = serverUsersExists ? 'server_users' : 'users';
            const wealthFilter = serverUsersExists
                ? 'guild_id = ? AND'
                : '';
            const wealthCol = '(wallet + COALESCE(bank,0))';
            for (const b of brackets) {
                try {
                    const params = serverUsersExists ? [guildId, b.min, b.max] : [b.min, b.max];
                    const [rows] = await db.execute(
                        `SELECT COUNT(*) as cnt FROM ${wealthTable} 
                         WHERE ${wealthFilter} ${wealthCol} >= ? AND ${wealthCol} < ?`,
                        params
                    );
                    wealthDistribution.push({ label: b.label, count: Number(rows[0]?.cnt || 0) });
                } catch {
                    wealthDistribution.push({ label: b.label, count: 0 });
                }
            }
        } catch (e) { console.warn('wealth distribution failed:', e.message); }
        
        // Gambling overview
        try {
            const [gameRows] = await db.execute(
                `SELECT game_type, SUM(games_played) as games, SUM(total_bet) as bet, 
                        SUM(total_won) as won, SUM(total_lost) as lost,
                        MAX(biggest_win) as biggest_win
                 FROM user_gambling_stats WHERE guild_id = ? GROUP BY game_type ORDER BY games DESC`,
                [guildId]
            );
            for (const r of gameRows) {
                gamblingOverview.totalGames += Number(r.games);
                gamblingOverview.totalBet += Number(r.bet);
                gamblingOverview.totalWon += Number(r.won);
                gamblingOverview.totalLost += Number(r.lost);
                gamblingOverview.gameBreakdown.push({
                    game: r.game_type,
                    games: Number(r.games),
                    bet: Number(r.bet),
                    won: Number(r.won),
                    lost: Number(r.lost),
                    biggestWin: Number(r.biggest_win)
                });
            }
        } catch (e) { console.warn('gambling stats failed:', e.message); }
        
        res.json({
            totalWealth, totalWallet, totalBank, userCount,
            wealthDistribution,
            gambling: gamblingOverview
        });
    } catch (error) {
        console.error('Economy stats error:', error);
        res.status(500).json({ error: 'Failed to fetch economy stats' });
    }
});

// ── Fishing Analytics ───────────────────────────────────────────────────

router.get('/api/stats/fishing', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ totalCaught: 0, totalValue: 0, uniqueFishers: 0, rarityBreakdown: [], catchTrend: [], topFish: [] });
        const days = rangeDays(req);
        
        let totalCaught = 0, totalValue = 0, uniqueFishers = 0;
        let rarityBreakdown = [], catchTrend = [], topFish = [];
        
        // Try v2 table first, then v1 tables
        let fishTable = 'user_fish_catches';
        let guildFilter = `guild_id = '${guildId}'`;
        let usingFallback = false;
        
        // Test if v2 table exists
        try {
            await db.execute(`SELECT 1 FROM user_fish_catches LIMIT 1`);
        } catch {
            // Try server_fish_catches (v1)
            try {
                await db.execute(`SELECT 1 FROM server_fish_catches LIMIT 1`);
                fishTable = 'server_fish_catches';
            } catch {
                // Last resort: fish_catches (legacy)
                fishTable = 'fish_catches';
                usingFallback = true;
            }
        }
        
        try {
            const [overview] = await db.execute(
                `SELECT COUNT(*) as total_caught, COALESCE(SUM(value),0) as total_value,
                        COUNT(DISTINCT user_id) as unique_fishers
                 FROM ${fishTable} WHERE ${guildFilter} AND caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [days]
            );
            if (overview[0]) {
                totalCaught = Number(overview[0].total_caught);
                totalValue = Number(overview[0].total_value);
                uniqueFishers = Number(overview[0].unique_fishers);
            }
        } catch (e) {
            // Fall back to global fish_catches
            try {
                const [overview] = await db.execute(
                    `SELECT COUNT(*) as total_caught, COALESCE(SUM(value),0) as total_value,
                            COUNT(DISTINCT user_id) as unique_fishers
                     FROM fish_catches WHERE caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                    [days]
                );
                if (overview[0]) {
                    totalCaught = Number(overview[0].total_caught);
                    totalValue = Number(overview[0].total_value);
                    uniqueFishers = Number(overview[0].unique_fishers);
                }
            } catch (e2) { console.warn('fishing overview failed:', e2.message); }
        }
        
        // Rarity breakdown
        try {
            const [rows] = await db.execute(
                `SELECT rarity, COUNT(*) as count, COALESCE(SUM(value),0) as total_value, 
                        COALESCE(AVG(weight),0) as avg_weight
                 FROM ${fishTable} WHERE ${guildFilter} AND caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY rarity ORDER BY count DESC`,
                [days]
            );
            rarityBreakdown = rows.map(r => ({
                rarity: r.rarity,
                count: Number(r.count),
                totalValue: Number(r.total_value),
                avgWeight: Number(r.avg_weight)
            }));
        } catch (e) {
            try {
                const [rows] = await db.execute(
                    `SELECT rarity, COUNT(*) as count, COALESCE(SUM(value),0) as total_value
                     FROM fish_catches WHERE caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                     GROUP BY rarity ORDER BY count DESC`,
                    [days]
                );
                rarityBreakdown = rows.map(r => ({
                    rarity: r.rarity, count: Number(r.count), totalValue: Number(r.total_value), avgWeight: 0
                }));
            } catch (e2) { console.warn('rarity breakdown failed:', e2.message); }
        }
        
        // Daily catch trend
        try {
            const [rows] = await db.execute(
                `SELECT DATE(caught_at) as day, COUNT(*) as count, COALESCE(SUM(value),0) as value
                 FROM ${fishTable} WHERE ${guildFilter} AND caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(caught_at) ORDER BY day`,
                [days]
            );
            catchTrend = rows.map(r => ({ day: r.day, count: Number(r.count), value: Number(r.value) }));
        } catch (e) {
            try {
                const [rows] = await db.execute(
                    `SELECT DATE(caught_at) as day, COUNT(*) as count, COALESCE(SUM(value),0) as value
                     FROM fish_catches WHERE caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                     GROUP BY DATE(caught_at) ORDER BY day`,
                    [days]
                );
                catchTrend = rows.map(r => ({ day: r.day, count: Number(r.count), value: Number(r.value) }));
            } catch (e2) { console.warn('catch trend failed:', e2.message); }
        }
        
        // Top fish by value
        try {
            const [rows] = await db.execute(
                `SELECT fish_name, rarity, MAX(value) as max_value, MAX(weight) as max_weight, COUNT(*) as times_caught
                 FROM ${fishTable} WHERE ${guildFilter} AND caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY fish_name, rarity ORDER BY max_value DESC LIMIT 10`,
                [days]
            );
            topFish = rows.map(r => ({
                name: r.fish_name, rarity: r.rarity, maxValue: Number(r.max_value),
                maxWeight: Number(r.max_weight), timesCaught: Number(r.times_caught)
            }));
        } catch (e) { console.warn('top fish failed:', e.message); }
        
        res.json({
            totalCaught, totalValue, uniqueFishers,
            rarityBreakdown, catchTrend, topFish,
            range: `${days}d`
        });
    } catch (error) {
        console.error('Fishing stats error:', error);
        res.status(500).json({ error: 'Failed to fetch fishing stats' });
    }
});

// ── Voice Analytics ─────────────────────────────────────────────────────

// Helper: base CTE that attaches "next event time" to each voice event via LEAD()
// This correctly handles missing leave events by using the next event (join/leave/etc.)
// by the same user as the implicit session end. Only the truly latest session per user
// gets NOW() as fallback (i.e. is genuinely active).
function voiceSessionsCTE(guildId, days) {
    return {
        sql: `voice_sessions AS (
            SELECT id, user_id, channel_id, created_at AS join_time, event_type,
                   LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS next_time,
                   TIMESTAMPDIFF(SECOND, created_at,
                       COALESCE(LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at), NOW())
                   ) AS duration_sec
            FROM guild_voice_events
            WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        )`,
        params: [guildId, days]
    };
}

router.get('/api/stats/voice', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ error: 'No guild selected' });
        const days = rangeDays(req);

        let totalSessions = 0, uniqueUsers = 0, totalMinutes = 0, avgSessionMin = 0;
        let dailyVoice = [], topChannels = [], topUsers = [], peakHours = [];
        let recentSessions = [];

        // ── summary: total join events & unique users ──
        try {
            const [rows] = await db.execute(
                `SELECT COUNT(*) as sessions, COUNT(DISTINCT user_id) as users
                 FROM guild_voice_events
                 WHERE guild_id = ? AND event_type = 'join'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [guildId, days]
            );
            totalSessions = Number(rows[0]?.sessions || 0);
            uniqueUsers = Number(rows[0]?.users || 0);
        } catch (e) { console.warn('voice summary failed:', e.message); }

        // ── compute session durations using LEAD() window function ──
        // Pairs each join with the NEXT event by the same user (join/leave/etc.)
        // Only the truly latest session per user falls back to NOW()
        try {
            const cte = voiceSessionsCTE(guildId, days);
            const [rows] = await db.execute(
                `WITH ${cte.sql}
                 SELECT COALESCE(SUM(duration_sec), 0) as total_sec,
                        COALESCE(AVG(duration_sec), 0) as avg_sec,
                        COUNT(*) as paired
                 FROM voice_sessions
                 WHERE event_type = 'join' AND duration_sec > 0 AND duration_sec < 86400`,
                cte.params
            );
            totalMinutes = Math.round(Number(rows[0]?.total_sec || 0) / 60);
            avgSessionMin = Math.round(Number(rows[0]?.avg_sec || 0) / 60);
        } catch (e) { console.warn('voice duration calc failed:', e.message); }

        // ── daily voice activity (joins / leaves per day) ──
        try {
            const [rows] = await db.execute(
                `SELECT DATE(created_at) as date,
                        SUM(event_type = 'join') as joins,
                        SUM(event_type = 'leave') as leaves
                 FROM guild_voice_events
                 WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at) ORDER BY date ASC`,
                [guildId, days]
            );
            dailyVoice = rows.map(r => ({
                date: r.date,
                joins: Number(r.joins || 0),
                leaves: Number(r.leaves || 0)
            }));
        } catch (e) { console.warn('daily voice failed:', e.message); }

        // ── top channels by sessions & total time ──
        try {
            const [rows] = await db.execute(
                `SELECT channel_id,
                        COUNT(*) as sessions,
                        COUNT(DISTINCT user_id) as unique_users
                 FROM guild_voice_events
                 WHERE guild_id = ? AND event_type = 'join'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY channel_id ORDER BY sessions DESC LIMIT 15`,
                [guildId, days]
            );
            const channelIds = rows.map(r => r.channel_id);
            // compute time per channel
            let channelTimes = {};
            if (channelIds.length > 0) {
                try {
                    const cte = voiceSessionsCTE(guildId, days);
                    const placeholders = channelIds.map(() => '?').join(',');
                    const [timeRows] = await db.execute(
                        `WITH ${cte.sql}
                         SELECT channel_id, COALESCE(SUM(duration_sec), 0) as total_sec
                         FROM voice_sessions
                         WHERE event_type = 'join' AND duration_sec > 0 AND duration_sec < 86400
                           AND channel_id IN (${placeholders})
                         GROUP BY channel_id`,
                        [...cte.params, ...channelIds]
                    );
                    for (const tr of timeRows) {
                        channelTimes[tr.channel_id] = Number(tr.total_sec || 0);
                    }
                } catch (e) { console.warn('channel time calc failed:', e.message); }
            }
            topChannels = rows.map(r => ({
                channel_id: r.channel_id,
                sessions: Number(r.sessions),
                unique_users: Number(r.unique_users),
                total_minutes: Math.round((channelTimes[r.channel_id] || 0) / 60)
            }));
        } catch (e) { console.warn('top voice channels failed:', e.message); }

        // ── top users by sessions & total time ──
        try {
            const [rows] = await db.execute(
                `SELECT user_id,
                        COUNT(*) as sessions,
                        COUNT(DISTINCT channel_id) as channels_used
                 FROM guild_voice_events
                 WHERE guild_id = ? AND event_type = 'join'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY user_id ORDER BY sessions DESC LIMIT 15`,
                [guildId, days]
            );
            const userIds = rows.map(r => r.user_id);
            let userTimes = {};
            if (userIds.length > 0) {
                try {
                    const cte = voiceSessionsCTE(guildId, days);
                    const placeholders = userIds.map(() => '?').join(',');
                    const [timeRows] = await db.execute(
                        `WITH ${cte.sql}
                         SELECT user_id, COALESCE(SUM(duration_sec), 0) as total_sec
                         FROM voice_sessions
                         WHERE event_type = 'join' AND duration_sec > 0 AND duration_sec < 86400
                           AND user_id IN (${placeholders})
                         GROUP BY user_id`,
                        [...cte.params, ...userIds]
                    );
                    for (const tr of timeRows) {
                        userTimes[tr.user_id] = Number(tr.total_sec || 0);
                    }
                } catch (e) { console.warn('user time calc failed:', e.message); }
            }
            topUsers = rows.map(r => ({
                user_id: r.user_id,
                sessions: Number(r.sessions),
                channels_used: Number(r.channels_used),
                total_minutes: Math.round((userTimes[r.user_id] || 0) / 60)
            }));
        } catch (e) { console.warn('top voice users failed:', e.message); }

        // ── peak hours (hour-of-day distribution) ──
        try {
            const [rows] = await db.execute(
                `SELECT HOUR(created_at) as hour, COUNT(*) as joins
                 FROM guild_voice_events
                 WHERE guild_id = ? AND event_type = 'join'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY HOUR(created_at) ORDER BY hour ASC`,
                [guildId, days]
            );
            // fill all 24 hours
            const hourMap = {};
            for (const r of rows) hourMap[r.hour] = Number(r.joins);
            for (let h = 0; h < 24; h++) {
                peakHours.push({ hour: h, joins: hourMap[h] || 0 });
            }
        } catch (e) { console.warn('peak hours failed:', e.message); }

        // ── recent sessions (last 20 join events with duration & active flag) ──
        try {
            const cte = voiceSessionsCTE(guildId, days);
            const [rows] = await db.execute(
                `WITH ${cte.sql}
                 SELECT user_id, channel_id, join_time, duration_sec,
                        CASE WHEN next_time IS NULL THEN 1 ELSE 0 END as is_active
                 FROM voice_sessions
                 WHERE event_type = 'join'
                 ORDER BY join_time DESC LIMIT 20`,
                cte.params
            );
            recentSessions = rows.map(r => ({
                user_id: r.user_id,
                channel_id: r.channel_id,
                join_time: r.join_time,
                duration_sec: r.is_active ? null : (r.duration_sec ? Number(r.duration_sec) : null),
                is_active: !!r.is_active
            }));
        } catch (e) { console.warn('recent sessions failed:', e.message); }

        // Resolve user names for top users and recent sessions
        const memberMap = await resolveGuildMembers(guildId);

        // Resolve channel names from Discord
        const channelMap = await resolveGuildChannels(guildId);

        // Enrich top users
        const enrichedTopUsers = topUsers.map(u => ({
            ...u,
            username: memberMap[u.user_id]?.display_name || memberMap[u.user_id]?.username || null,
            proxy_avatar_url: memberMap[u.user_id]?.proxy_avatar_url || `/api/proxy/avatar/${u.user_id}`
        }));

        // Enrich top channels
        const enrichedTopChannels = topChannels.map(ch => ({
            ...ch,
            channel_name: channelMap[ch.channel_id] || null
        })).filter(ch => ch.channel_name);

        // Enrich recent sessions
        const enrichedRecentSessions = recentSessions.map(s => ({
            ...s,
            username: memberMap[s.user_id]?.display_name || memberMap[s.user_id]?.username || null,
            channel_name: channelMap[s.channel_id] || null
        }));

        res.json({
            totalSessions,
            uniqueUsers,
            totalMinutes,
            avgSessionMin,
            dailyVoice,
            topChannels: enrichedTopChannels,
            topUsers: enrichedTopUsers,
            peakHours,
            recentSessions: enrichedRecentSessions,
            range: `${days}d`
        });
    } catch (error) {
        console.error('Voice stats error:', error);
        res.status(500).json({ error: 'Failed to fetch voice stats' });
    }
});

// ── Top Users (messages, VC hours, commands) ────────────────────────────

router.get('/api/stats/top-users', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ messages: [], voice: [], commands: [] });
        const days = rangeDays(req);
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const dc = (col, ts) => dateCondition(col, days, ts);

        let topMessages = [], topVoice = [], topCommands = [];

        // Top messages — try rollup table first, fallback to raw events if empty/missing
        try {
            const [rows] = await db.execute(
                `SELECT user_id, SUM(messages) as total FROM guild_user_activity_daily
                 WHERE guild_id = ? AND ${dc('stat_date')}
                 GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`,
                [guildId]
            );
            topMessages = rows.map(r => ({ user_id: r.user_id, total: Number(r.total) }));
        } catch (e) { /* table missing or error — will try fallback */ }
        if (!topMessages.length) {
            try {
                const [rows] = await db.execute(
                    `SELECT user_id, COUNT(*) as total FROM guild_message_events
                     WHERE guild_id = ? AND event_type = 'message' AND ${dc('created_at', true)}
                     GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`,
                    [guildId]
                );
                topMessages = rows.map(r => ({ user_id: r.user_id, total: Number(r.total) }));
            } catch (e2) { console.warn('top messages fallback failed:', e2.message); }
        }

        // Top voice (minutes) — try rollup table first, fallback to LEAD()-based computation
        try {
            const [rows] = await db.execute(
                `SELECT user_id, SUM(voice_minutes) as total FROM guild_user_activity_daily
                 WHERE guild_id = ? AND ${dc('stat_date')}
                 GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`,
                [guildId]
            );
            topVoice = rows.map(r => ({ user_id: r.user_id, total: Number(r.total) }));
        } catch (e) { /* table missing or error — will try fallback */ }
        if (!topVoice.length) {
            try {
                const effectiveDays = days === -1 ? 36500 : days;
                const cte = voiceSessionsCTE(guildId, effectiveDays);
                const [rows] = await db.execute(
                    `WITH ${cte.sql}
                     SELECT user_id, ROUND(SUM(duration_sec) / 60) as total
                     FROM voice_sessions
                     WHERE event_type = 'join' AND duration_sec > 0 AND duration_sec < 86400
                     GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`,
                    cte.params
                );
                topVoice = rows.map(r => ({ user_id: r.user_id, total: Number(r.total) }));
            } catch (e2) { console.warn('top voice fallback failed:', e2.message); }
        }

        // Top commands — try rollup table first, fallback to command_stats
        try {
            const [rows] = await db.execute(
                `SELECT user_id, SUM(commands_used) as total FROM guild_user_activity_daily
                 WHERE guild_id = ? AND ${dc('stat_date')}
                 GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`,
                [guildId]
            );
            topCommands = rows.map(r => ({ user_id: r.user_id, total: Number(r.total) }));
        } catch (e) { /* table missing or error — will try fallback */ }
        if (!topCommands.length) {
            try {
                const [rows] = await db.execute(
                    `SELECT user_id, COUNT(*) as total FROM command_stats
                     WHERE guild_id = ? AND ${dc('used_at', true)}
                     GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`,
                    [guildId]
                );
                topCommands = rows.map(r => ({ user_id: r.user_id, total: Number(r.total) }));
            } catch (e2) { console.warn('top commands fallback failed:', e2.message); }
        }

        // Resolve usernames for all user IDs
        const allUserIds = new Set([
            ...topMessages.map(u => u.user_id),
            ...topVoice.map(u => u.user_id),
            ...topCommands.map(u => u.user_id)
        ]);
        const memberMap = allUserIds.size > 0 ? await resolveGuildMembers(guildId) : {};

        res.json({
            messages: enrichWithMembers(topMessages, memberMap),
            voice: enrichWithMembers(topVoice, memberMap),
            commands: enrichWithMembers(topCommands, memberMap)
        });
    } catch (error) {
        console.error('Top users error:', error);
        res.status(500).json({ error: 'Failed to fetch top users' });
    }
});

// ── User Profile ────────────────────────────────────────────────────────

router.get('/api/stats/user/:userId', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ error: 'No guild selected' });
        const userId = req.params.userId;
        const days = rangeDays(req);
        const dc = (col, ts) => dateCondition(col, days, ts);

        let totals = { messages: 0, voice_minutes: 0, commands: 0, most_active_day: null };
        let daily = [];

        // Totals
        try {
            const [rows] = await db.execute(
                `SELECT COALESCE(SUM(messages),0) as messages,
                        COALESCE(SUM(voice_minutes),0) as voice_minutes,
                        COALESCE(SUM(commands_used),0) as commands_used
                 FROM guild_user_activity_daily
                 WHERE guild_id = ? AND user_id = ? AND ${dc('stat_date')}`,
                [guildId, userId]
            );
            if (rows[0]) {
                totals.messages = Number(rows[0].messages);
                totals.voice_minutes = Number(rows[0].voice_minutes);
                totals.commands = Number(rows[0].commands_used);
            }
        } catch (e) { console.warn('user totals failed:', e.message); }

        // Most active day
        try {
            const [rows] = await db.execute(
                `SELECT stat_date, (messages + commands_used) as activity FROM guild_user_activity_daily
                 WHERE guild_id = ? AND user_id = ? AND ${dc('stat_date')}
                 ORDER BY activity DESC LIMIT 1`,
                [guildId, userId]
            );
            if (rows[0]) totals.most_active_day = rows[0].stat_date;
        } catch (e) { /* ignore */ }

        // Daily breakdown
        try {
            const [rows] = await db.execute(
                `SELECT stat_date as date, messages, voice_minutes, commands_used
                 FROM guild_user_activity_daily
                 WHERE guild_id = ? AND user_id = ? AND ${dc('stat_date')}
                 ORDER BY stat_date ASC`,
                [guildId, userId]
            );
            daily = rows.map(r => ({
                date: r.date,
                messages: Number(r.messages),
                voice_minutes: Number(r.voice_minutes),
                commands: Number(r.commands_used)
            }));
        } catch (e) { console.warn('user daily failed:', e.message); }

        res.json({ userId, totals, daily });
    } catch (error) {
        console.error('User profile error:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

// ── Activity Heatmap ────────────────────────────────────────────────────

router.get('/api/stats/heatmap', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json({ matrix: [] });
        const days = rangeDays(req);
        const effectiveDays = days > 0 ? days : 30;

        let matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));

        try {
            const [rows] = await db.execute(
                `SELECT DAYOFWEEK(created_at) - 1 as dow, HOUR(created_at) as hr, COUNT(*) as cnt
                 FROM guild_message_events
                 WHERE guild_id = ? AND event_type = 'message'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY dow, hr`,
                [guildId, effectiveDays]
            );
            for (const r of rows) {
                const d = Number(r.dow);
                const h = Number(r.hr);
                if (d >= 0 && d < 7 && h >= 0 && h < 24) {
                    matrix[d][h] = Number(r.cnt);
                }
            }
        } catch (e) { console.warn('heatmap query failed:', e.message); }

        const rowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const colLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

        res.json({ matrix, rowLabels, colLabels });
    } catch (error) {
        console.error('Heatmap error:', error);
        res.status(500).json({ error: 'Failed to fetch heatmap data' });
    }
});

// ── Channel Analytics ───────────────────────────────────────────────────

router.get('/api/stats/channels/analytics', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json([]);
        const days = rangeDays(req);
        const dc = (col, ts) => dateCondition(col, days, ts);

        let channels = [];
        try {
            const [rows] = await db.execute(
                `SELECT channel_id,
                        COUNT(*) as total_messages,
                        SUM(event_type = 'message') as messages,
                        SUM(event_type = 'edit') as edits,
                        SUM(event_type = 'delete') as deletes,
                        COUNT(DISTINCT user_id) as unique_users
                 FROM guild_message_events
                 WHERE guild_id = ? AND ${dc('created_at', true)}
                 GROUP BY channel_id ORDER BY total_messages DESC LIMIT 50`,
                [guildId]
            );
            channels = rows.map(r => ({
                channel_id: r.channel_id,
                total_messages: Number(r.total_messages),
                messages: Number(r.messages || 0),
                edits: Number(r.edits || 0),
                deletes: Number(r.deletes || 0),
                unique_users: Number(r.unique_users)
            }));
        } catch (e) { console.warn('channel analytics query failed:', e.message); }

        // Resolve channel names
        const channelMap = await resolveGuildChannels(guildId);
        channels = channels.map(ch => ({
            ...ch,
            channel_name: channelMap[ch.channel_id] || null
        })).filter(ch => ch.channel_name);

        res.json(channels);
    } catch (error) {
        console.error('Channel analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch channel analytics' });
    }
});

// ── Compare Users ───────────────────────────────────────────────────────

router.get('/api/stats/compare', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json([]);
        const days = rangeDays(req);
        const dc = (col) => dateCondition(col, days, false);

        // Accept comma-separated user IDs
        const userIds = (req.query.users || '').split(',').filter(id => /^\d+$/.test(id)).slice(0, 5);
        if (userIds.length < 2) return res.status(400).json({ error: 'Provide at least 2 user ids via ?users=id1,id2' });

        const placeholders = userIds.map(() => '?').join(',');
        const results = [];

        for (const uid of userIds) {
            let totals = { user_id: uid, messages: 0, voice_minutes: 0, commands: 0 };
            let daily = [];

            try {
                const [rows] = await db.execute(
                    `SELECT COALESCE(SUM(messages),0) as m, COALESCE(SUM(voice_minutes),0) as v,
                            COALESCE(SUM(commands_used),0) as c
                     FROM guild_user_activity_daily WHERE guild_id = ? AND user_id = ? AND ${dc('stat_date')}`,
                    [guildId, uid]
                );
                if (rows[0]) { totals.messages = Number(rows[0].m); totals.voice_minutes = Number(rows[0].v); totals.commands = Number(rows[0].c); }
            } catch (e) { /* ignore */ }

            try {
                const [rows] = await db.execute(
                    `SELECT stat_date as date, messages, voice_minutes, commands_used
                     FROM guild_user_activity_daily WHERE guild_id = ? AND user_id = ? AND ${dc('stat_date')}
                     ORDER BY stat_date ASC`,
                    [guildId, uid]
                );
                daily = rows.map(r => ({ date: r.date, messages: Number(r.messages), voice_minutes: Number(r.voice_minutes), commands: Number(r.commands_used) }));
            } catch (e) { /* ignore */ }

            results.push({ ...totals, daily });
        }

        res.json(results);
    } catch (error) {
        console.error('Compare users error:', error);
        res.status(500).json({ error: 'Failed to compare users' });
    }
});

// ── CSV Export ──────────────────────────────────────────────────────────

router.get('/api/stats/export/:type', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.status(400).json({ error: 'No guild selected' });
        const { type } = req.params;
        const days = rangeDays(req);
        
        let rows = [];
        let filename = `${type}_export.csv`;
        let headers = [];
        
        switch (type) {
            case 'commands': {
                [rows] = await db.execute(
                    `SELECT command_name, channel_id, usage_date, use_count
                     FROM guild_command_usage WHERE guild_id = ? AND usage_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                     ORDER BY usage_date DESC, use_count DESC`,
                    [guildId, days]
                );
                headers = ['command', 'channel_id', 'date', 'count'];
                filename = `commands_${guildId}_${days}d.csv`;
                break;
            }
            case 'activity': {
                [rows] = await db.execute(
                    `SELECT stat_date, channel_id, messages, edits, deletes, joins, leaves, active_users
                     FROM guild_daily_stats WHERE guild_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                     ORDER BY stat_date DESC`,
                    [guildId, days]
                );
                headers = ['date', 'channel_id', 'messages', 'edits', 'deletes', 'joins', 'leaves', 'active_users'];
                filename = `activity_${guildId}_${days}d.csv`;
                break;
            }
            case 'economy': {
                try {
                    [rows] = await db.execute(
                        `SELECT user_id, wallet, bank, (wallet + COALESCE(bank,0)) as networth, 
                                total_gambled, total_won, total_lost, commands_used
                         FROM server_users WHERE guild_id = ? ORDER BY (wallet + COALESCE(bank,0)) DESC LIMIT 500`,
                        [guildId]
                    );
                } catch {
                    [rows] = await db.execute(
                        `SELECT user_id, wallet, bank, (wallet + COALESCE(bank,0)) as networth
                         FROM users WHERE wallet > 0 OR bank > 0 ORDER BY (wallet + COALESCE(bank,0)) DESC LIMIT 500`
                    );
                }
                headers = ['user_id', 'wallet', 'bank', 'networth'];
                if (rows[0]?.total_gambled !== undefined) headers.push('total_gambled', 'total_won', 'total_lost', 'commands_used');
                filename = `economy_${guildId}.csv`;
                break;
            }
            case 'fishing': {
                try {
                    [rows] = await db.execute(
                        `SELECT user_id, fish_name, rarity, weight, value, caught_at
                         FROM server_fish_catches WHERE guild_id = ? AND caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                         ORDER BY caught_at DESC LIMIT 5000`,
                        [guildId, days]
                    );
                } catch {
                    [rows] = await db.execute(
                        `SELECT user_id, fish_name, rarity, weight, value, caught_at
                         FROM fish_catches WHERE caught_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                         ORDER BY caught_at DESC LIMIT 5000`,
                        [days]
                    );
                }
                headers = ['user_id', 'fish_name', 'rarity', 'weight', 'value', 'caught_at'];
                filename = `fishing_${guildId}_${days}d.csv`;
                break;
            }
            default:
                return res.status(400).json({ error: 'Invalid export type. Valid: commands, activity, economy, fishing' });
        }
        
        // Build CSV
        const escapeCSV = (val) => {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        
        let csv = headers.join(',') + '\n';
        for (const row of rows) {
            csv += headers.map(h => escapeCSV(row[h] ?? row[h.replace('command', 'command_name')] ?? row[h.replace('date', 'usage_date') || h.replace('date', 'stat_date')] ?? '')).join(',') + '\n';
        }
        
        // Simpler approach: use object keys
        csv = headers.join(',') + '\n';
        for (const row of rows) {
            const values = Object.values(row);
            csv += values.map(v => escapeCSV(v)).join(',') + '\n';
        }
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// ── Custom Query ────────────────────────────────────────────────────────

const ALLOWED_TABLES = new Set([
    'guild_command_usage', 'guild_daily_stats', 'guild_message_events', 'guild_member_events',
    'server_users', 'server_fish_catches', 'user_xp', 'server_command_stats',
    'gambling_stats', 'leaderboard_cache'
]);

router.get('/api/stats/query', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.status(400).json({ error: 'No guild selected' });
        const { table, columns, orderBy, limit: rawLimit, where } = req.query;
        
        if (!table || !ALLOWED_TABLES.has(table)) {
            return res.status(400).json({ 
                error: 'Invalid or missing table parameter',
                allowed: Array.from(ALLOWED_TABLES)
            });
        }
        
        // Sanitize columns (only alphanumeric + underscore)
        const colRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
        let selectCols = '*';
        if (columns) {
            const cols = columns.split(',').map(c => c.trim()).filter(c => colRegex.test(c));
            if (cols.length > 0) selectCols = cols.join(', ');
        }
        
        // Build query with mandatory guild scoping
        const limit = Math.min(parseInt(rawLimit) || 100, 500);
        let guildCol = 'guild_id';
        let query = `SELECT ${selectCols} FROM ${table} WHERE ${guildCol} = ? `;
        let params = [guildId];
        
        // Optional where filter (only simple comparisons allowed)
        if (where) {
            // Parse simple filters like "column=value" or "column>value"
            const filterRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|>|<|>=|<=|!=)\s*(.+)$/;
            const filters = where.split(';').map(f => f.trim());
            for (const f of filters) {
                const match = f.match(filterRegex);
                if (match && colRegex.test(match[1])) {
                    query += `AND ${match[1]} ${match[2]} ? `;
                    params.push(match[3]);
                }
            }
        }
        
        // Order by
        if (orderBy && colRegex.test(orderBy.replace(/^-/, ''))) {
            const desc = orderBy.startsWith('-');
            query += `ORDER BY ${orderBy.replace(/^-/, '')} ${desc ? 'DESC' : 'ASC'} `;
        }
        
        query += `LIMIT ${limit}`;
        
        const [rows] = await db.execute(query, params);
        res.json({ table, count: rows.length, data: rows });
    } catch (error) {
        console.error('Custom query error:', error);
        res.status(500).json({ error: 'Query failed: ' + error.message });
    }
});

module.exports = router;
