// Guild management routes: Discord proxy, settings, blocked channels, prefixes, modules, commands, scope rules
const express = require('express');
const axios = require('axios');
const router = express.Router();

const { getDb } = require('../db');
const { cache, CacheTTL } = require('../cache');
const { requireGuildAccess, isValidSnowflake } = require('../security');

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// ════════════════════════════════════════════════════════════════════════════
//  Discord API Proxy Endpoints (channels, roles, members)
// ════════════════════════════════════════════════════════════════════════════

router.get('/api/discord/channels', requireGuildAccess, async (req, res) => {
    try {
        const guildId = req.guildId;
        const cacheKey = `discord:channels:${guildId}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);
        
        if (!process.env.DISCORD_TOKEN) {
            return res.status(500).json({ error: 'Bot token not configured' });
        }
        
        const response = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
        });
        
        const channels = response.data
            .filter(c => c.type === 0 || c.type === 5)
            .sort((a, b) => a.position - b.position)
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                parent_id: c.parent_id,
                position: c.position
            }));
        
        cache.set(cacheKey, channels, CacheTTL.SHORT);
        res.json(channels);
    } catch (error) {
        console.error('Discord channels fetch error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

router.get('/api/discord/roles', requireGuildAccess, async (req, res) => {
    try {
        const guildId = req.guildId;
        const cacheKey = `discord:roles:${guildId}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);
        
        if (!process.env.DISCORD_TOKEN) {
            return res.status(500).json({ error: 'Bot token not configured' });
        }
        
        const response = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
        });
        
        const roles = response.data
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.color,
                position: r.position,
                managed: r.managed,
                permissions: r.permissions
            }));
        
        cache.set(cacheKey, roles, CacheTTL.SHORT);
        res.json(roles);
    } catch (error) {
        console.error('Discord roles fetch error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

router.get('/api/discord/members', requireGuildAccess, async (req, res) => {
    try {
        const guildId = req.guildId;
        const cacheKey = `discord:members:${guildId}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);
        
        if (!process.env.DISCORD_TOKEN) {
            return res.status(500).json({ error: 'Bot token not configured' });
        }
        
        const response = await axios.get(`${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
        });
        
        const members = response.data.map(m => ({
            id: m.user.id,
            username: m.user.username,
            display_name: m.nick || m.user.global_name || m.user.username,
            avatar: m.user.avatar,
            bot: m.user.bot || false
        }));
        
        cache.set(cacheKey, members, 30000);
        res.json(members);
    } catch (error) {
        console.error('Discord members fetch error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
//  Guild Settings
// ════════════════════════════════════════════════════════════════════════════

router.get('/api/guild/settings', async (req, res) => {
    try {
        const db = getDb();
        if (req.guildId === 'global') {
            return res.json({ prefix: 'bb ', logging_enabled: false, logging_channel: null });
        }

        const cacheKey = cache.key('guild', 'settings', req.guildId);
        const settings = await cache.getOrSet(cacheKey, async () => {
            const [rows] = await db.execute('SELECT * FROM guild_settings WHERE guild_id = ?', [req.guildId]);
            return rows[0] || { prefix: 'bb ', logging_enabled: false, logging_channel: null };
        }, CacheTTL.GUILD_SETTINGS);

        res.json(settings);
    } catch (error) {
        console.error('Guild settings error:', error);
        res.status(500).json({ error: 'Failed to fetch guild settings' });
    }
});

router.put('/api/guild/settings', async (req, res) => {
    try {
        const db = getDb();
        const { prefix, logging_enabled, logging_channel } = req.body;

        if (req.guildId === 'global') {
            return res.status(400).json({ error: 'Cannot modify global settings' });
        }

        await db.execute(`
            INSERT INTO guild_settings (guild_id, prefix, logging_enabled, logging_channel)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            prefix = VALUES(prefix),
            logging_enabled = VALUES(logging_enabled),
            logging_channel = VALUES(logging_channel)
        `, [req.guildId, prefix, logging_enabled, logging_channel]);

        await cache.del(cache.key('guild', 'settings', req.guildId));
        res.json({ success: true });
    } catch (error) {
        console.error('Guild settings update error:', error);
        res.status(500).json({ error: 'Failed to update guild settings' });
    }
});

// ── Blocked Channels ────────────────────────────────────────────────────

router.get('/api/guild/blocked-channels', async (req, res) => {
    try {
        const db = getDb();
        const [rows] = await db.execute('SELECT blocked_channels FROM guild_settings WHERE guild_id = ?', [req.guildId]);
        const channels = rows[0]?.blocked_channels ? JSON.parse(rows[0].blocked_channels) : [];
        res.json(channels.map(id => ({ channel_id: id })));
    } catch (error) {
        console.error('Blocked channels error:', error);
        res.status(500).json({ error: 'Failed to fetch blocked channels' });
    }
});

router.post('/api/guild/blocked-channels', async (req, res) => {
    try {
        const db = getDb();
        const { channel_id } = req.body;
        const [rows] = await db.execute('SELECT blocked_channels FROM guild_settings WHERE guild_id = ?', [req.guildId]);
        let channels = rows[0]?.blocked_channels ? JSON.parse(rows[0].blocked_channels) : [];
        if (!channels.includes(channel_id)) channels.push(channel_id);
        await db.execute(
            `INSERT INTO guild_settings (guild_id, blocked_channels) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE blocked_channels = VALUES(blocked_channels)`,
            [req.guildId, JSON.stringify(channels)]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Add blocked channel error:', error);
        res.status(500).json({ error: 'Failed to add blocked channel' });
    }
});

router.delete('/api/guild/blocked-channels/:channelId', async (req, res) => {
    try {
        const db = getDb();
        const { channelId } = req.params;
        const [rows] = await db.execute('SELECT blocked_channels FROM guild_settings WHERE guild_id = ?', [req.guildId]);
        let channels = rows[0]?.blocked_channels ? JSON.parse(rows[0].blocked_channels) : [];
        channels = channels.filter(id => id !== channelId);
        await db.execute(
            `INSERT INTO guild_settings (guild_id, blocked_channels) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE blocked_channels = VALUES(blocked_channels)`,
            [req.guildId, JSON.stringify(channels)]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Remove blocked channel error:', error);
        res.status(500).json({ error: 'Failed to remove blocked channel' });
    }
});

// ── Custom Prefixes ─────────────────────────────────────────────────────

router.get('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const db = getDb();
        const [rows] = await db.execute('SELECT prefix FROM guild_prefixes WHERE guild_id = ?', [req.guildId]);
        res.json(rows);
    } catch (error) {
        console.error('Custom prefixes error:', error);
        res.status(500).json({ error: 'Failed to fetch custom prefixes' });
    }
});

router.post('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const db = getDb();
        const { prefix } = req.body;
        if (!prefix) return res.status(400).json({ error: 'Prefix required' });
        await db.execute('INSERT IGNORE INTO guild_prefixes (guild_id, prefix) VALUES (?, ?)', [req.guildId, prefix]);
        res.json({ success: true });
    } catch (error) {
        console.error('Add prefix error:', error);
        res.status(500).json({ error: 'Failed to add prefix' });
    }
});

router.delete('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const db = getDb();
        const { prefix } = req.body;
        await db.execute('DELETE FROM guild_prefixes WHERE guild_id = ? AND prefix = ?', [req.guildId, prefix]);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove prefix error:', error);
        res.status(500).json({ error: 'Failed to remove prefix' });
    }
});

// ── Modules ─────────────────────────────────────────────────────────────

router.get('/api/modules', async (req, res) => {
    try {
        const db = getDb();
        const modules = ['economy', 'fishing', 'gambling', 'moderation', 'fun', 'utility'];
        const moduleStates = {};

        for (const module of modules) {
            const [result] = await db.execute(
                'SELECT enabled FROM guild_module_settings WHERE guild_id = ? AND module = ?',
                [req.guildId, module]
            );
            moduleStates[module] = result.length > 0 ? result[0].enabled : true;
        }

        res.json(moduleStates);
    } catch (error) {
        console.error('Modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

router.post('/api/modules/toggle', async (req, res) => {
    try {
        const db = getDb();
        const { module, enabled } = req.body;

        await db.execute(`
            INSERT INTO guild_module_settings (guild_id, module, enabled)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)
        `, [req.guildId, module, enabled]);

        res.json({ success: true });
    } catch (error) {
        console.error('Module toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle module' });
    }
});

// ── Commands ────────────────────────────────────────────────────────────

router.get('/api/commands', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        
        if (!guildId || guildId === 'global') return res.json([]);
        
        const [commands] = await db.execute(`
            SELECT DISTINCT command_name as name, COUNT(*) as usage_count
            FROM command_stats 
            WHERE guild_id = ? AND used_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY command_name 
            ORDER BY usage_count DESC
        `, [guildId]);

        const commandStates = [];
        for (const command of commands) {
            const [result] = await db.execute(
                'SELECT enabled FROM guild_command_settings WHERE guild_id = ? AND command = ?',
                [guildId, command.name]
            );
            commandStates.push({
                name: command.name,
                enabled: result.length > 0 ? result[0].enabled : true,
                usage: command.usage_count
            });
        }

        res.json(commandStates);
    } catch (error) {
        console.error('Commands error:', error);
        res.status(500).json({ error: 'Failed to fetch commands' });
    }
});

// ── Scope Rules ─────────────────────────────────────────────────────────

router.get('/api/scope-rules', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId || req.query.guild_id;
        if (!guildId || guildId === 'global' || guildId === 'null') return res.json([]);

        const [rows] = await db.execute(
            'SELECT * FROM command_scope_rules WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Scope rules error:', error);
        res.status(500).json({ error: 'Failed to fetch scope rules' });
    }
});

router.post('/api/scope-rules', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId || req.body.guild_id;
        const { command_name, scope_type, target_type, target_id } = req.body;
        if (!command_name) return res.status(400).json({ error: 'command_name is required' });
        await db.execute(
            'INSERT INTO command_scope_rules (guild_id, command_name, scope_type, target_type, target_id) VALUES (?, ?, ?, ?, ?)',
            [guildId, command_name, scope_type || 'allow', target_type || 'channel', target_id || null]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Scope rule create error:', error);
        res.status(500).json({ error: 'Failed to create scope rule' });
    }
});

router.put('/api/scope-rules/:id', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { command_name, scope_type, target_type, target_id } = req.body;
        if (!command_name) return res.status(400).json({ error: 'command_name is required' });
        await db.execute(
            'UPDATE command_scope_rules SET command_name = ?, scope_type = ?, target_type = ?, target_id = ? WHERE id = ? AND guild_id = ?',
            [command_name, scope_type || 'allow', target_type || 'channel', target_id || null, req.params.id, guildId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Scope rule update error:', error);
        res.status(500).json({ error: 'Failed to update scope rule' });
    }
});

router.delete('/api/scope-rules/:id', async (req, res) => {
    try {
        const db = getDb();
        await db.execute('DELETE FROM command_scope_rules WHERE id = ? AND guild_id = ?', [req.params.id, req.guildId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Scope rule delete error:', error);
        res.status(500).json({ error: 'Failed to delete scope rule' });
    }
});

router.delete('/api/scope-rules/exclusive/:command', async (req, res) => {
    try {
        const db = getDb();
        const { command } = req.params;
        await db.execute('DELETE FROM scope_rules WHERE command_name = ? AND scope_type = ?', [command, 'exclusive']);
        res.json({ success: true });
    } catch (error) {
        console.error('Exclusive scope rule delete error:', error);
        res.status(500).json({ error: 'Failed to delete exclusive rule' });
    }
});

// ── Settings Bulk Save ──────────────────────────────────────────────────

router.post('/api/settings/save-all', async (req, res) => {
    try {
        const guildId = req.headers['x-guild-id'];
        const { settings } = req.body;
        res.json({ success: true, message: 'Settings saved' });
    } catch (error) {
        console.error('Settings save error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

module.exports = router;
