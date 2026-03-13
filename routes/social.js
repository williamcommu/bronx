// Social routes: users, giveaways, reaction roles, autoroles, leaderboards
const express = require('express');
const router = express.Router();

const { getDb } = require('../db');
const { requireGuildAccess, requireBotOwner, isValidSnowflake, validateSnowflake } = require('../security');

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
        
        const enrichedUsers = users.map(user => ({
            guild_id: user.guild_id,
            user_id: user.user_id,
            wallet: user.wallet,
            bank: user.bank,
            bank_limit: user.bank_limit,
            commands_used: user.commands_used,
            last_active: user.last_active,
            networth: user.wallet + user.bank,
            bank_space: user.bank_limit - user.bank
        }));

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

        res.json(giveaways);
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
        res.json(history);
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
        const { role_id } = req.body;
        
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

        await db.execute(`
            INSERT INTO reaction_roles (guild_id, message_id, channel_id, emoji_raw, role_id)
            VALUES (?, ?, ?, ?, ?)
        `, [guildId, message_id, channel_id, emoji_raw, role_id]);

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
        
        res.json({ success: true, deleted: result.affectedRows });
    } catch (error) {
        console.error('Reaction role delete error:', error);
        res.status(500).json({ error: 'Failed to delete reaction role' });
    }
});

// ── Leaderboard ─────────────────────────────────────────────────────────

router.get('/api/leaderboard/:type', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { type } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        let query = '';
        let params = [];
        
        // For coins/fishing we need to filter by guild membership.
        // Fetch guild member IDs first so we can scope results.
        let memberIds = null;
        if (type === 'coins' || type === 'balance' || type === 'fishing' || 
            type === 'networth' || type === 'gambling') {
            try {
                const axios = require('axios');
                const DISCORD_API_BASE = 'https://discord.com/api/v10';
                const { cache: appCache } = require('../cache');
                const cacheKey = `discord:member_ids:${guildId}`;
                let ids = await appCache.get(cacheKey);
                if (!ids && process.env.DISCORD_TOKEN) {
                    const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
                        headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                    });
                    ids = resp.data.map(m => m.user.id);
                    await appCache.set(cacheKey, ids, 60);
                }
                memberIds = ids;
            } catch (e) {
                console.error('Failed to fetch guild members for leaderboard:', e.message);
            }
        }
        
        // Build a member filter clause for queries that need guild scoping
        const memberFilter = (memberIds && memberIds.length > 0)
            ? `AND user_id IN (${memberIds.map(() => '?').join(',')})`
            : '';
        const memberParams = (memberIds && memberIds.length > 0) ? memberIds : [];
        
        switch (type) {
            case 'xp':
                query = `
                    SELECT user_id, server_xp as value, server_level as level
                    FROM server_xp WHERE guild_id = ? AND server_xp > 0 
                    ORDER BY server_xp DESC LIMIT ${limit}
                `;
                params = [guildId];
                break;
            case 'level':
                query = `
                    SELECT user_id, server_level as value, server_xp as xp
                    FROM server_xp WHERE guild_id = ? AND server_level > 1 
                    ORDER BY server_level DESC, server_xp DESC LIMIT ${limit}
                `;
                params = [guildId];
                break;
            case 'coins':
            case 'balance':
            case 'networth':
                query = `
                    SELECT user_id, wallet + COALESCE(bank, 0) as value, wallet, bank
                    FROM users WHERE (wallet > 0 OR bank > 0) ${memberFilter}
                    ORDER BY (wallet + COALESCE(bank, 0)) DESC LIMIT ${limit}
                `;
                params = [...memberParams];
                break;
            case 'fishing':
                query = `
                    SELECT user_id, SUM(value) as value, COUNT(*) as catch_count
                    FROM fish_catches WHERE 1=1 ${memberFilter} GROUP BY user_id
                    HAVING value > 0
                    ORDER BY value DESC LIMIT ${limit}
                `;
                params = [...memberParams];
                break;
            case 'gambling':
                query = `
                    SELECT user_id, SUM(total_won) - SUM(total_lost) as value, SUM(games_played) as games_played
                    FROM gambling_stats WHERE 1=1 ${memberFilter} GROUP BY user_id
                    HAVING value > 0
                    ORDER BY value DESC LIMIT ${limit}
                `;
                params = [...memberParams];
                break;
            default:
                return res.status(400).json({ error: 'Invalid leaderboard type. Valid: xp, level, coins, fishing, gambling' });
        }
        
        const [rows] = params.length > 0 
            ? await db.query(query, params)
            : await db.query(query);
        
        // Resolve usernames and avatars from Discord
        let memberMap = {};
        try {
            const { cache: memberCache } = require('../cache');
            const cacheKey = `discord:members:${guildId}`;
            let members = await memberCache.get(cacheKey);
            if (!members && process.env.DISCORD_TOKEN) {
                const axios = require('axios');
                const DISCORD_API_BASE = 'https://discord.com/api/v10';
                const resp = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
                    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                });
                members = resp.data.map(m => ({
                    id: m.user.id,
                    username: m.user.username,
                    display_name: m.nick || m.user.global_name || m.user.username,
                    avatar: m.user.avatar
                }));
                await memberCache.set(cacheKey, members, 30);
            }
            if (members) {
                for (const m of members) {
                    memberMap[m.id] = m;
                }
            }
        } catch (e) {
            console.error('Failed to resolve member names:', e.message);
        }
        
        // Enrich rows with display names and avatar URLs
        const enriched = (rows || []).map(row => {
            const uid = String(row.user_id);
            const member = memberMap[uid];
            return {
                ...row,
                username: member?.display_name || member?.username || null,
                avatar_url: member?.avatar 
                    ? `https://cdn.discordapp.com/avatars/${uid}/${member.avatar}.${member.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(uid) >> 22n) % 6n}.png`
            };
        });
        
        res.json(enriched);
    } catch (error) {
        console.error('Leaderboard fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

module.exports = router;
