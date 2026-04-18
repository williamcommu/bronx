// Social routes: users, giveaways, reaction roles, autoroles, leaderboards
const express = require('express');
const axios = require('axios');
const router = express.Router();

const { getDb } = require('../db');
const { cache } = require('../cache');
const { requireGuildAccess, requireBotOwner, isValidSnowflake, validateSnowflake } = require('../security');
const { logActivity, formatAction } = require('../activity-logger');

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// ── Discord Resolution Helpers ──────────────────────────────────────────

/**
 * Fetch guild members from Discord, returning a Map of userId → member info.
 * Results are cached for 30 seconds.
 */
async function resolveGuildMembers(guildId) {
    const memberMap = {};
    try {
        const cacheKey = `discord:members:${guildId}`;
        let members = await appCache.get(cacheKey);
        if (!members && process.env.DISCORD_TOKEN) {
            console.log(`[resolveGuildMembers] Fetching members for guild ${guildId}`);
            const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
            });
            console.log(`[resolveGuildMembers] Got ${resp.data.length} members`);
            members = resp.data.map(m => ({
                id: m.user.id,
                username: m.user.username,
                display_name: m.nick || m.user.global_name || m.user.username,
                avatar: m.user.avatar
            }));
            await appCache.set(cacheKey, members, 30);
        } else if (members) {
            console.log(`[resolveGuildMembers] Using cached members for guild ${guildId}: ${members.length} entries`);
        }
        if (members) {
            for (const m of members) memberMap[m.id] = m;
        }
    } catch (e) {
        console.error('Failed to resolve guild members:', e.message, e.response?.data || '');
    }
    return memberMap;
}

/**
 * Fetch specific guild members by user ID. Rate-limit aware with sequential fetching.
 * Returns partial results immediately, marking unresolved users.
 */
async function resolveSpecificMembers(guildId, userIds) {
    const memberMap = {};
    const unresolved = [];
    const notInGuildSet = new Set();
    if (!userIds || userIds.length === 0 || !process.env.DISCORD_TOKEN) return { memberMap, unresolved, notInGuildSet };
    
    // Check cache first for each user
    const uncachedIds = [];
    let cacheHits = 0, notInGuildCached = 0;
    for (const uid of userIds) {
        const cacheKey = `discord:member:${guildId}:${uid}`;
        const cached = await appCache.get(cacheKey);
        if (cached === null || cached === undefined) {
            // Not in cache - need to fetch
            uncachedIds.push(uid);
        } else if (cached.notInGuild === true) {
            // Cached as "not found" - user left the guild
            notInGuildCached++;
            notInGuildSet.add(uid);
        } else {
            memberMap[uid] = cached;
            cacheHits++;
        }
    }
    
    // Fetch uncached members sequentially with delay to avoid rate limits
    let fetched = 0, notFound = 0, rateLimited = 0;
    if (uncachedIds.length > 0) {
        console.log(`[resolveSpecificMembers] Fetching ${uncachedIds.length} uncached members for guild ${guildId}`);
    }
    for (const uid of uncachedIds) {
        try {
            const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members/${uid}`, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
            });
            const m = resp.data;
            const member = {
                id: m.user.id,
                username: m.user.username,
                display_name: m.nick || m.user.global_name || m.user.username,
                avatar: m.user.avatar
            };
            // Cache for 5 minutes
            await appCache.set(`discord:member:${guildId}:${uid}`, member, 300);
            memberMap[uid] = member;
            fetched++;
            // Small delay between requests to avoid rate limiting
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {
            if (e.response?.status === 429) {
                // Rate limited - mark as unresolved so frontend can retry
                unresolved.push(uid);
                rateLimited++;
            } else if (e.response?.status === 404) {
                // User not in guild - cache with sentinel value
                await appCache.set(`discord:member:${guildId}:${uid}`, { notInGuild: true }, 300);
                notFound++;
                notInGuildSet.add(uid);
            } else {
                unresolved.push(uid);
                console.error(`[resolveSpecificMembers] Error fetching ${uid}:`, e.response?.status, e.message);
            }
        }
    }
    
    console.log(`[resolveSpecificMembers] guild=${guildId}: ${Object.keys(memberMap).length}/${userIds.length} (cache:${cacheHits}, fetched:${fetched}, notInGuild:${notFound + notInGuildCached}, rateLimited:${rateLimited})`);
    return { memberMap, unresolved, notInGuildSet };
}

/**
 * Fetch guild channels from Discord, returning a Map of channelId → channel info.
 * Results are cached using CacheTTL.SHORT.
 */
async function resolveGuildChannels(guildId) {
    const channelMap = {};
    try {
        const cacheKey = `discord:channels:${guildId}`;
        let channels = await appCache.get(cacheKey);
        if (!channels && process.env.DISCORD_TOKEN) {
            const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
            });
            channels = resp.data
                .filter(c => c.type === 0 || c.type === 5)
                .map(c => ({ id: c.id, name: c.name, type: c.type }));
            await appCache.set(cacheKey, channels, 300);
        }
        if (channels) {
            for (const c of channels) channelMap[c.id] = c;
        }
    } catch (e) {
        console.error('Failed to resolve guild channels:', e.message);
    }
    return channelMap;
}

/**
 * Enrich a user row with Discord display name and avatar URLs.
 * @param {Object} user - The user row from DB
 * @param {Object} memberMap - Map of user_id -> Discord member info
 * @param {Array} unresolved - List of user IDs that couldn't be resolved (rate limited)
 */
function enrichUserRow(user, memberMap, unresolved = []) {
    const uid = String(user.user_id);
    const member = memberMap[uid];
    const isLoading = unresolved.includes(uid);
    // Show "Loading..." for rate-limited users, fallback for left users
    const fallbackName = isLoading ? 'Loading...' : `User …${uid.slice(-4)}`;
    return {
        ...user,
        username: member?.display_name || member?.username || fallbackName,
        loading: isLoading,
        avatar_url: member?.avatar
            ? `https://cdn.discordapp.com/avatars/${uid}/${member.avatar}.${member.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(uid) >> 22n) % 6n}.png`,
        proxy_avatar_url: member?.avatar
            ? `/api/proxy/avatar/${uid}?hash=${member.avatar}&size=64`
            : `/api/proxy/avatar/${uid}`
    };
}

// ── Users Search ────────────────────────────────────────────────────────

router.get('/api/users/search', async (req, res) => {
    try {
        const db = getDb();
        const { q } = req.query;
        const guildId = req.guildId;
        
        if (!guildId || guildId === 'global') {
            return res.json({ error: 'Please select a server first', noServerSelected: true });
        }
        
        if (/^\d{17,20}$/.test(q) && !isValidSnowflake(q)) {
            return res.status(400).json({ error: 'Invalid user ID format' });
        }
        
        let query = '';
        let params = [];

        if (/^\d+$/.test(q)) {
            query = `
                SELECT su.guild_id, su.user_id, su.wallet, su.bank, su.bank_limit,
                       su.commands_used, su.last_active
                FROM server_users su
                WHERE su.user_id = ? AND su.guild_id = ?
            `;
            params = [q, guildId];
        } else {
            query = `
                SELECT su.guild_id, su.user_id, su.wallet, su.bank, su.bank_limit,
                       su.commands_used, su.last_active
                FROM server_users su
                WHERE su.guild_id = ?
                AND (su.user_id LIKE ? OR (su.wallet + su.bank) > 10000)
                ORDER BY (su.wallet + su.bank) DESC 
                LIMIT 20
            `;
            params = [guildId, `%${q}%`];
        }

        const [users] = await db.execute(query, params);
        
        // Resolve Discord display names and avatars
        const memberMap = await resolveGuildMembers(guildId);

        const enrichedUsers = users.map(user => enrichUserRow({
            guild_id: user.guild_id,
            user_id: user.user_id,
            wallet: user.wallet,
            bank: user.bank,
            bank_limit: user.bank_limit,
            commands_used: user.commands_used,
            last_active: user.last_active,
            networth: user.wallet + user.bank,
            bank_space: user.bank_limit - user.bank
        }, memberMap));

        res.json(enrichedUsers);
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// ── Badge Management (owner only) ───────────────────────────────────────

router.post('/api/users/badge', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { user_id, badge_type, action } = req.body;
        if (!user_id || !badge_type) {
            return res.status(400).json({ error: 'user_id and badge_type are required' });
        }
        if (!isValidSnowflake(user_id)) {
            return res.status(400).json({ error: 'Invalid user_id format' });
        }
        const validBadges = ['dev', 'admin', 'is_mod', 'maintainer', 'contributor', 'vip'];
        if (!validBadges.includes(badge_type)) {
            return res.status(400).json({ error: `Invalid badge type. Valid: ${validBadges.join(', ')}` });
        }
        if (action !== 'grant' && action !== 'revoke') {
            return res.status(400).json({ error: 'action must be either "grant" or "revoke"' });
        }
        const value = action === 'grant' ? 1 : 0;
        await db.execute(
            `UPDATE users SET \`${badge_type}\` = ? WHERE user_id = ?`,
            [value, user_id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Badge management error:', error);
        res.status(500).json({ error: 'Failed to update badge' });
    }
});

// ── Giveaways ───────────────────────────────────────────────────────────

router.get('/api/giveaways/active', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        
        if (!guildId || guildId === 'global') return res.json([]);

        const [giveaways] = await db.execute(`
            SELECT g.*, 
                   (SELECT COUNT(*) FROM giveaway_entries WHERE giveaway_id = g.id) as entry_count
            FROM giveaways g
            WHERE g.guild_id = ? AND g.active = true AND g.ends_at > NOW()
            ORDER BY g.ends_at ASC
        `, [guildId]);

        // Resolve channel names and creator names
        const [channelMap, memberMap] = await Promise.all([
            resolveGuildChannels(guildId),
            resolveGuildMembers(guildId)
        ]);

        const enriched = giveaways.map(g => {
            const ch = channelMap[g.channel_id];
            const creator = memberMap[g.created_by];
            return {
                ...g,
                channel_name: ch ? `#${ch.name}` : null,
                created_by_name: creator?.display_name || creator?.username || null
            };
        });

        res.json(enriched);
    } catch (error) {
        console.error('Active giveaways error:', error);
        res.status(500).json({ error: 'Failed to fetch active giveaways' });
    }
});

router.post('/api/giveaways', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { prize_amount, max_winners, duration_hours, channel_id } = req.body;
        
        if (channel_id && !isValidSnowflake(channel_id)) {
            return res.status(400).json({ error: 'Invalid channel_id format' });
        }
        
        const prizeNum = Number(prize_amount);
        const maxWinnersNum = Number(max_winners) || 1;
        const durationNum = Number(duration_hours);
        
        if (!Number.isFinite(prizeNum) || prizeNum < 0) {
            return res.status(400).json({ error: 'prize_amount must be a valid non-negative number' });
        }
        if (!Number.isFinite(durationNum) || durationNum <= 0) {
            return res.status(400).json({ error: 'duration_hours must be a positive number' });
        }
        
        const ends_at = new Date(Date.now() + durationNum * 60 * 60 * 1000);

        const [result] = await db.execute(`
            INSERT INTO giveaways (guild_id, channel_id, prize_amount, max_winners, ends_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [guildId, channel_id, prizeNum, maxWinnersNum, ends_at, req.session.user?.id || '0']);

        // Log activity
        await logActivity(guildId, req.session?.user, 'DB',
            formatAction('giveaway', 'created', `$${prizeNum.toLocaleString()}`));

        res.json({ success: true, giveaway_id: result.insertId });
    } catch (error) {
        console.error('Giveaway creation error:', error);
        res.status(500).json({ error: 'Failed to create giveaway' });
    }
});

router.put('/api/giveaways/:id', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const guildId = req.guildId;
        const { prize, max_winners, ends_at, channel_id } = req.body;
        
        if (channel_id && !isValidSnowflake(channel_id)) {
            return res.status(400).json({ error: 'Invalid channel_id format' });
        }
        
        const prizeNum = Number(prize);
        const maxWinnersNum = Number(max_winners) || 1;
        
        if (!Number.isFinite(prizeNum) || prizeNum < 0) {
            return res.status(400).json({ error: 'prize must be a valid non-negative number' });
        }
        
        const [result] = await db.execute(`
            UPDATE giveaways 
            SET prize = ?, max_winners = ?, ends_at = ?, channel_id = ?
            WHERE id = ? AND guild_id = ?
        `, [prizeNum, maxWinnersNum, ends_at, channel_id, id, guildId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Giveaway not found or access denied' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Giveaway update error:', error);
        res.status(500).json({ error: 'Failed to update giveaway' });
    }
});

router.delete('/api/giveaways/:id', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const guildId = req.guildId;
        
        const [result] = await db.execute(
            'DELETE FROM giveaways WHERE id = ? AND guild_id = ?', 
            [id, guildId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Giveaway not found or access denied' });
        }

        // Log activity
        await logActivity(guildId, req.session?.user, 'DB',
            formatAction('giveaway', 'deleted', `#${id}`));
        
        res.json({ success: true });
    } catch (error) {
        console.error('Giveaway delete error:', error);
        res.status(500).json({ error: 'Failed to delete giveaway' });
    }
});

router.post('/api/giveaways/:id/end', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const guildId = req.guildId;
        
        const [result] = await db.execute(`
            UPDATE giveaways SET ends_at = NOW(), status = 'ended' WHERE id = ? AND guild_id = ?
        `, [id, guildId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Giveaway not found or access denied' });
        }

        // Log activity
        await logActivity(guildId, req.session?.user, 'DB',
            formatAction('giveaway', 'ended', `#${id}`));
        
        res.json({ success: true, message: 'Giveaway ended' });
    } catch (error) {
        console.error('Giveaway end error:', error);
        res.status(500).json({ error: 'Failed to end giveaway' });
    }
});

router.get('/api/giveaways/history', async (req, res) => {
    try {
        const db = getDb();
        const [history] = await db.execute(`
            SELECT * FROM giveaways 
            WHERE ends_at < NOW() OR status = 'ended'
            ORDER BY ends_at DESC 
            LIMIT 50
        `);

        // Resolve channel names for history entries
        // Collect unique guild IDs from history rows
        const guildIds = [...new Set(history.map(g => g.guild_id).filter(Boolean))];
        const allChannelMaps = {};
        await Promise.all(guildIds.map(async gid => {
            allChannelMaps[gid] = await resolveGuildChannels(gid);
        }));

        const enrichedHistory = history.map(g => {
            const chMap = allChannelMaps[g.guild_id] || {};
            const ch = chMap[g.channel_id];
            return {
                ...g,
                channel_name: ch ? `#${ch.name}` : null
            };
        });

        res.json(enrichedHistory);
    } catch (error) {
        console.error('Giveaway history error:', error);
        res.json([]);
    }
});

// ── Autoroles ───────────────────────────────────────────────────────────

router.get('/api/autoroles', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const [rows] = await db.execute(
            'SELECT id, role_id, added_by, created_at FROM autoroles WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Autoroles fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch autoroles' });
    }
});

router.post('/api/autoroles', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { role_id, role_name } = req.body;
        
        if (!role_id || !isValidSnowflake(role_id)) {
            return res.status(400).json({ error: 'Valid role_id is required' });
        }
        
        const addedBy = req.session?.user?.id || '0';
        
        const [result] = await db.execute(
            'INSERT IGNORE INTO autoroles (guild_id, role_id, added_by) VALUES (?, ?, ?)',
            [guildId, role_id, addedBy]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'This role is already an autorole' });
        }

        // Log activity
        const displayName = role_name || `@${role_id}`;
        await logActivity(guildId, req.session?.user, 'DB',
            formatAction('autorole', 'added', displayName));
        
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Autorole add error:', error);
        res.status(500).json({ error: 'Failed to add autorole' });
    }
});

router.delete('/api/autoroles/:roleId', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { roleId } = req.params;
        
        if (!isValidSnowflake(roleId)) {
            return res.status(400).json({ error: 'Invalid role ID' });
        }
        
        const [result] = await db.execute(
            'DELETE FROM autoroles WHERE guild_id = ? AND role_id = ?',
            [guildId, roleId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Autorole not found' });
        }

        // Log activity
        await logActivity(guildId, req.session?.user, 'DB',
            formatAction('autorole', 'removed', `@${roleId}`));
        
        res.json({ success: true });
    } catch (error) {
        console.error('Autorole delete error:', error);
        res.status(500).json({ error: 'Failed to delete autorole' });
    }
});

// ── Reaction Roles ──────────────────────────────────────────────────────

router.get('/api/reaction-roles', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const [roles] = await db.execute(
            'SELECT * FROM reaction_roles WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
        res.json(roles);
    } catch (error) {
        console.error('Reaction roles error:', error);
        res.status(500).json({ error: 'Failed to fetch reaction roles' });
    }
});

router.post('/api/reaction-roles', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { message_id, channel_id, emoji_raw, role_id, role_name } = req.body;
        
        if (message_id && !isValidSnowflake(message_id)) {
            return res.status(400).json({ error: 'Invalid message_id format' });
        }
        if (channel_id && !isValidSnowflake(channel_id)) {
            return res.status(400).json({ error: 'Invalid channel_id format' });
        }
        if (role_id && !isValidSnowflake(role_id)) {
            return res.status(400).json({ error: 'Invalid role_id format' });
        }

        await db.execute(`
            INSERT INTO reaction_roles (guild_id, message_id, channel_id, emoji_raw, role_id)
            VALUES (?, ?, ?, ?, ?)
        `, [guildId, message_id, channel_id, emoji_raw, role_id]);

        // Log activity
        const displayEmoji = emoji_raw || '(emoji)';
        const displayRole = role_name || `@${role_id}`;
        await logActivity(guildId, req.session?.user, 'DB',
            `Added <b>${displayEmoji}</b> → <b>${displayRole}</b> reaction role`);

        res.json({ success: true });
    } catch (error) {
        console.error('Reaction role creation error:', error);
        res.status(500).json({ error: 'Failed to create reaction role' });
    }
});

router.put('/api/reaction-roles/:id', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const guildId = req.guildId;
        const { message_id, channel_id, emoji_raw, role_id } = req.body;
        
        if (message_id && !isValidSnowflake(message_id)) {
            return res.status(400).json({ error: 'Invalid message_id format' });
        }
        if (channel_id && !isValidSnowflake(channel_id)) {
            return res.status(400).json({ error: 'Invalid channel_id format' });
        }
        if (role_id && !isValidSnowflake(role_id)) {
            return res.status(400).json({ error: 'Invalid role_id format' });
        }
        
        const [result] = await db.execute(`
            UPDATE reaction_roles 
            SET message_id = ?, channel_id = ?, emoji_raw = ?, role_id = ?
            WHERE (id = ? OR message_id = ?) AND guild_id = ?
        `, [message_id, channel_id, emoji_raw, role_id, id, id, guildId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Reaction role not found or access denied' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Reaction role update error:', error);
        res.status(500).json({ error: 'Failed to update reaction role' });
    }
});

router.delete('/api/reaction-roles/:message_id', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const { message_id } = req.params;
        const emoji_raw = req.query.emoji_raw ? decodeURIComponent(req.query.emoji_raw) : null;
        const guildId = req.guildId;
        
        let result;
        if (emoji_raw) {
            [result] = await db.execute(
                'DELETE FROM reaction_roles WHERE message_id = ? AND emoji_raw = ? AND guild_id = ?', 
                [message_id, emoji_raw, guildId]
            );
        } else {
            [result] = await db.execute(
                'DELETE FROM reaction_roles WHERE message_id = ? AND guild_id = ?', 
                [message_id, guildId]
            );
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Reaction role not found or access denied' });
        }

        // Log activity
        const displayEmoji = emoji_raw || '';
        await logActivity(guildId, req.session?.user, 'DB',
            `Removed <b>${displayEmoji}</b> reaction role`);
        
        res.json({ success: true, deleted: result.affectedRows });
    } catch (error) {
        console.error('Reaction role delete error:', error);
        res.status(500).json({ error: 'Failed to delete reaction role' });
    }
});

// ── Leaderboard ─────────────────────────────────────────────────────────

router.get('/api/leaderboard/:type', requireGuildAccess, async (req, res) => {
    console.log(`[Leaderboard] Request for type=${req.params.type}, guild=${req.guildId}`);
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { type } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 15, 50);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        
        const cacheKey = cache.key('leaderboard', type, guildId, limit, offset);
        const cachedResponse = await cache.get(cacheKey);
        if (cachedResponse) {
            console.log(`[Leaderboard] Cache hit: ${cacheKey}`);
            return res.json(cachedResponse);
        }
        
        let query = '';
        let params = [];
        switch (type) {
            case 'xp':
                query = `
                    SELECT user_id, total_xp as value, level
                    FROM user_xp WHERE guild_id = ? AND total_xp > 0
                    ORDER BY total_xp DESC LIMIT ${limit} OFFSET ${offset}
                `;
                params = [guildId];
                break;
            case 'level':
                query = `
                    SELECT user_id, level as value, total_xp as xp
                    FROM user_xp WHERE guild_id = ? AND level > 1
                    ORDER BY level DESC, total_xp DESC LIMIT ${limit} OFFSET ${offset}
                `;
                params = [guildId];
                break;
            case 'coins':
            case 'balance':
            case 'networth':
                query = `
                    SELECT u.user_id, u.wallet + COALESCE(u.bank, 0) as value, u.wallet, u.bank
                    FROM users u
                    INNER JOIN user_xp ux ON ux.user_id = u.user_id AND ux.guild_id = ?
                    WHERE (u.wallet > 0 OR u.bank > 0)
                    ORDER BY (u.wallet + COALESCE(u.bank, 0)) DESC LIMIT ${limit} OFFSET ${offset}
                `;
                params = [guildId];
                break;
            case 'fishing':
                // Try user_fish_catches first (v2), then fish_catches (v1)
                let fishingQuery;
                try {
                    await db.query('SELECT 1 FROM user_fish_catches LIMIT 1');
                    fishingQuery = `
                        SELECT user_id, SUM(value) as value, COUNT(*) as catch_count
                        FROM user_fish_catches WHERE sold = FALSE GROUP BY user_id
                        HAVING value > 0
                        ORDER BY value DESC LIMIT ${limit} OFFSET ${offset}
                    `;
                } catch {
                    // Fall back to fish_catches (no guild_id filter)
                    fishingQuery = `
                        SELECT user_id, SUM(value) as value, COUNT(*) as catch_count
                        FROM fish_catches GROUP BY user_id
                        HAVING value > 0
                        ORDER BY value DESC LIMIT ${limit} OFFSET ${offset}
                    `;
                }
                query = fishingQuery;
                params = [];
                break;
            case 'gambling':
                query = `
                    SELECT user_id, SUM(total_won) - SUM(total_lost) as value, SUM(games_played) as games_played
                    FROM user_gambling_stats WHERE guild_id = ? GROUP BY user_id
                    HAVING value > 0
                    ORDER BY value DESC LIMIT ${limit} OFFSET ${offset}
                `;
                params = [guildId];
                break;
            case 'messages':
                query = `
                    SELECT user_id, SUM(messages) as value
                    FROM user_activity_daily
                    WHERE guild_id = ? AND user_id > 0
                    GROUP BY user_id
                    HAVING value > 0
                    ORDER BY value DESC LIMIT ? OFFSET ?
                `;
                params = [guildId, parseInt(limit), parseInt(offset)];
                break;
            default:
                return res.status(400).json({ error: 'Invalid leaderboard type. Valid: xp, level, coins, fishing, gambling, messages' });
        }
        
        const [rows] = params.length > 0 
            ? await db.query(query, params)
            : await db.query(query);
        
        // Only fetch Discord info for the users we're actually showing
        const userIds = (rows || []).map(r => String(r.user_id));
        const { memberMap, unresolved, notInGuildSet } = await resolveSpecificMembers(guildId, userIds);
        
        // Enrich rows, filtering out users who left the guild
        const enriched = (rows || [])
            .filter(row => !notInGuildSet.has(String(row.user_id)))
            .map(row => enrichUserRow(row, memberMap, unresolved));
        
        // Return with metadata so frontend knows to retry
        const responseData = {
            type,
            guildId,
            limit,
            offset,
            total: enriched.length,
            leaderboard: enriched
        };

        // Cache the fully resolved response for 5 minutes
        await cache.set(cacheKey, responseData, 300);

        res.json(responseData);
    } catch (error) {
        console.error('Leaderboard fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

module.exports = router;
