// Guild management routes: Discord proxy, settings, blocked channels, prefixes, modules, commands, scope rules
const express = require('express');
const axios = require('axios');
const router = express.Router();

const { getDb } = require('../db');
const { cache, CacheTTL } = require('../cache');
const { requireGuildAccess, isValidSnowflake } = require('../security');
const { logActivity, formatAction } = require('../activity-logger');

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

        // Get old settings for activity log
        const [oldRows] = await db.execute('SELECT prefix FROM guild_settings WHERE guild_id = ?', [req.guildId]);
        const oldPrefix = oldRows[0]?.prefix || 'b.';

        await db.execute(`
            INSERT INTO guild_settings (guild_id, prefix, logging_enabled, logging_channel)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            prefix = VALUES(prefix),
            logging_enabled = VALUES(logging_enabled),
            logging_channel = VALUES(logging_channel)
        `, [req.guildId, prefix, logging_enabled, logging_channel]);

        // Log activity if prefix changed
        if (prefix && prefix !== oldPrefix) {
            await logActivity(req.guildId, req.session?.user, 'DB',
                formatAction('prefix', 'changed', prefix, { from: oldPrefix, to: prefix }),
                { oldValue: oldPrefix, newValue: prefix });
        }

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
        const { channel_id, channel_name } = req.body;
        const [rows] = await db.execute('SELECT blocked_channels FROM guild_settings WHERE guild_id = ?', [req.guildId]);
        let channels = rows[0]?.blocked_channels ? JSON.parse(rows[0].blocked_channels) : [];
        if (!channels.includes(channel_id)) channels.push(channel_id);
        await db.execute(
            `INSERT INTO guild_settings (guild_id, blocked_channels) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE blocked_channels = VALUES(blocked_channels)`,
            [req.guildId, JSON.stringify(channels)]
        );

        // Log activity
        const displayName = channel_name || `#${channel_id}`;
        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('channel', 'added', displayName) + ' to blocked list');

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

        // Log activity
        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('channel', 'removed', `#${channelId}`) + ' from blocked list');

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

        // Log activity
        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('prefix', 'added', prefix));

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

        // Log activity
        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('prefix', 'removed', prefix));

        res.json({ success: true });
    } catch (error) {
        console.error('Remove prefix error:', error);
        res.status(500).json({ error: 'Failed to remove prefix' });
    }
});

router.put('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const db = getDb();
        const { oldPrefix, newPrefix } = req.body;
        if (!oldPrefix || !newPrefix) return res.status(400).json({ error: 'Both old and new prefix required' });
        
        // Update the prefix
        await db.execute(
            'UPDATE guild_prefixes SET prefix = ? WHERE guild_id = ? AND prefix = ?',
            [newPrefix, req.guildId, oldPrefix]
        );

        // Log as a single "edited" activity
        await logActivity(req.guildId, req.session?.user, 'DB',
            `Edited prefix <b>${oldPrefix}</b> → <b>${newPrefix}</b>`,
            { oldValue: oldPrefix, newValue: newPrefix });

        res.json({ success: true });
    } catch (error) {
        console.error('Edit prefix error:', error);
        res.status(500).json({ error: 'Failed to edit prefix' });
    }
});

// ── Modules ─────────────────────────────────────────────────────────────

// Static module definitions with their commands
const BOT_MODULES = {
    economy: {
        icon: 'fa-coins',
        description: 'Currency, banking, shop, and trading',
        commands: ['achievements', 'balance', 'bank', 'boosts', 'buy', 'daily', 'inv', 'item', 'lootboxes', 'market', 'passive', 'pay', 'prestige', 'rebirth', 'rob', 'sellitem', 'shop', 'supportdaily', 'supportshop', 'treasury', 'tuneprices', 'use', 'weekly', 'withdraw', 'work']
    },
    fishing: {
        icon: 'fa-fish',
        description: 'Fishing, equipment, and fish selling',
        commands: ['autofisher', 'equip', 'finfo', 'finv', 'fish', 'lockfish', 'sellfish']
    },
    gambling: {
        icon: 'fa-dice',
        description: 'Casino games and betting',
        commands: ['blackjack', 'bomb', 'coinflip', 'dice', 'frogger', 'jackpot', 'lottery', 'roulette', 'russian_roulette', 'slots']
    },
    moderation: {
        icon: 'fa-shield-alt',
        description: 'Server moderation tools',
        commands: []
    },
    fun: {
        icon: 'fa-laugh',
        description: 'Entertainment commands',
        commands: ['blacktea']
    },
    utility: {
        icon: 'fa-tools',
        description: 'Utility and management',
        commands: ['commands', 'giveaway', 'modules', 'payout', 'reactionrole']
    },
    leveling: {
        icon: 'fa-chart-line',
        description: 'XP and level progression',
        commands: ['levelconfig', 'levelroles', 'rank', 'xpblacklist']
    },
    mining: {
        icon: 'fa-gem',
        description: 'Mining and ore selling',
        commands: ['mine', 'minv', 'sellore']
    },
    games: {
        icon: 'fa-gamepad',
        description: 'Interactive games',
        commands: []
    },
    pets: {
        icon: 'fa-paw',
        description: 'Pet system',
        commands: ['pet']
    },
    skills: {
        icon: 'fa-tree',
        description: 'Skill trees and abilities',
        commands: ['skills']
    },
    challenges: {
        icon: 'fa-tasks',
        description: 'Daily and weekly challenges',
        commands: ['challenges', 'streak']
    },
    leaderboard: {
        icon: 'fa-trophy',
        description: 'Rankings and leaderboards',
        commands: ['leaderboard']
    },
    boss: {
        icon: 'fa-dragon',
        description: 'World boss fights',
        commands: ['boss', 'event']
    },
    endgame: {
        icon: 'fa-crown',
        description: 'Endgame content',
        commands: ['endgame']
    },
    guide: {
        icon: 'fa-book',
        description: 'Help and documentation',
        commands: ['guide', 'help']
    }
};

// Build flat command→module map
const COMMAND_MODULE_MAP = {};
for (const [mod, data] of Object.entries(BOT_MODULES)) {
    for (const cmd of data.commands) {
        COMMAND_MODULE_MAP[cmd] = mod;
    }
}

router.get('/api/modules', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json([]);

        // Fetch enabled states for all modules
        const [rows] = await db.execute(
            'SELECT module, enabled FROM guild_module_settings WHERE guild_id = ?',
            [guildId]
        );
        const stateMap = {};
        rows.forEach(r => { stateMap[r.module] = r.enabled; });

        // Return array with full module info
        const result = Object.entries(BOT_MODULES).map(([name, data]) => ({
            module: name,
            icon: data.icon,
            description: data.description,
            commandCount: data.commands.length,
            enabled: stateMap[name] !== undefined ? Boolean(stateMap[name]) : true
        }));

        res.json(result);
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

        // Log activity
        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('module', enabled ? 'enabled' : 'disabled', module));

        res.json({ success: true });
    } catch (error) {
        console.error('Module toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle module' });
    }
});

// Get advanced settings for a module
router.get('/api/modules/:module/settings', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const moduleName = req.params.module;
        
        if (!BOT_MODULES[moduleName]) {
            return res.status(404).json({ error: 'Module not found' });
        }

        // Get module enabled state and scope settings
        const [modRows] = await db.execute(
            'SELECT enabled FROM guild_module_settings WHERE guild_id = ? AND module = ?',
            [guildId, moduleName]
        );

        // Get scope rules for this module
        const [scopeRows] = await db.execute(
            `SELECT scope_type, scope_id, enabled, exclusive 
             FROM guild_module_scope_settings 
             WHERE guild_id = ? AND module = ?`,
            [guildId, moduleName]
        );

        // Get list of commands in this module with their states
        const moduleCommands = BOT_MODULES[moduleName].commands;
        const [cmdRows] = await db.execute(
            `SELECT command, enabled FROM guild_command_settings 
             WHERE guild_id = ? AND command IN (${moduleCommands.map(() => '?').join(',') || "''"})`
            , [guildId, ...moduleCommands]
        );
        const cmdMap = {};
        cmdRows.forEach(r => { cmdMap[r.command] = r.enabled; });

        res.json({
            module: moduleName,
            info: BOT_MODULES[moduleName],
            enabled: modRows.length > 0 ? Boolean(modRows[0].enabled) : true,
            scopes: scopeRows.map(s => ({
                type: s.scope_type,
                id: s.scope_id,
                enabled: Boolean(s.enabled),
                exclusive: Boolean(s.exclusive)
            })),
            commands: moduleCommands.map(cmd => ({
                name: cmd,
                enabled: cmdMap[cmd] !== undefined ? Boolean(cmdMap[cmd]) : true
            }))
        });
    } catch (error) {
        console.error('Module settings error:', error);
        res.status(500).json({ error: 'Failed to fetch module settings' });
    }
});

// Update module scope restrictions
router.put('/api/modules/:module/settings', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const moduleName = req.params.module;
        const { enabled, scopes } = req.body;

        if (!BOT_MODULES[moduleName]) {
            return res.status(404).json({ error: 'Module not found' });
        }

        // Update enabled state
        if (enabled !== undefined) {
            await db.execute(`
                INSERT INTO guild_module_settings (guild_id, module, enabled)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)
            `, [guildId, moduleName, enabled]);
        }

        // Update scope rules if provided
        if (Array.isArray(scopes)) {
            // Clear existing scopes
            await db.execute(
                'DELETE FROM guild_module_scope_settings WHERE guild_id = ? AND module = ?',
                [guildId, moduleName]
            );
            // Insert new scopes
            for (const scope of scopes) {
                if (scope.type && scope.id) {
                    await db.execute(`
                        INSERT INTO guild_module_scope_settings 
                        (guild_id, module, scope_type, scope_id, enabled, exclusive)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [guildId, moduleName, scope.type, scope.id, 
                        scope.enabled !== false, scope.exclusive || false]);
                }
            }
        }

        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('module', 'updated settings for', moduleName));

        res.json({ success: true });
    } catch (error) {
        console.error('Module settings update error:', error);
        res.status(500).json({ error: 'Failed to update module settings' });
    }
});

// ── Commands ────────────────────────────────────────────────────────────

// Get all bot commands with their module, enabled state, and usage stats
router.get('/api/commands', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        
        if (!guildId || guildId === 'global') return res.json([]);

        // Get usage stats from last 30 days
        const [usageRows] = await db.execute(`
            SELECT command_name as name, COUNT(*) as usage_count
            FROM command_stats 
            WHERE guild_id = ? AND used_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY command_name
        `, [guildId]);
        const usageMap = {};
        usageRows.forEach(r => { usageMap[r.name] = r.usage_count; });

        // Get enabled states for all commands
        const [stateRows] = await db.execute(
            'SELECT command, enabled FROM guild_command_settings WHERE guild_id = ?',
            [guildId]
        );
        const stateMap = {};
        stateRows.forEach(r => { stateMap[r.command] = r.enabled; });

        // Build full command list from BOT_MODULES
        const allCommands = [];
        for (const [moduleName, moduleData] of Object.entries(BOT_MODULES)) {
            for (const cmdName of moduleData.commands) {
                allCommands.push({
                    name: cmdName,
                    module: moduleName,
                    moduleIcon: moduleData.icon,
                    enabled: stateMap[cmdName] !== undefined ? Boolean(stateMap[cmdName]) : true,
                    usage: usageMap[cmdName] || 0
                });
            }
        }

        // Sort by usage (descending), then alphabetically
        allCommands.sort((a, b) => {
            if (b.usage !== a.usage) return b.usage - a.usage;
            return a.name.localeCompare(b.name);
        });

        res.json(allCommands);
    } catch (error) {
        console.error('Commands error:', error);
        res.status(500).json({ error: 'Failed to fetch commands' });
    }
});

// Toggle a command's enabled state
router.post('/api/commands/toggle', async (req, res) => {
    try {
        const db = getDb();
        const { command, enabled } = req.body;
        if (!command) return res.status(400).json({ error: 'Command name required' });

        await db.execute(`
            INSERT INTO guild_command_settings (guild_id, command, enabled)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)
        `, [req.guildId, command, enabled]);

        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('command', enabled ? 'enabled' : 'disabled', command));

        res.json({ success: true });
    } catch (error) {
        console.error('Command toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle command' });
    }
});

// Get detailed config for a specific command (scopes, restrictions)
router.get('/api/commands/:cmd/config', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const cmdName = req.params.cmd;
        const moduleName = COMMAND_MODULE_MAP[cmdName];

        // Get command enabled state
        const [cmdRows] = await db.execute(
            'SELECT enabled FROM guild_command_settings WHERE guild_id = ? AND command = ?',
            [guildId, cmdName]
        );

        // Get scope rules for this command (from bot's table)
        const [scopeRows] = await db.execute(
            `SELECT scope_type, scope_id, enabled, exclusive 
             FROM guild_command_scope_settings 
             WHERE guild_id = ? AND command = ?`,
            [guildId, cmdName]
        );

        res.json({
            command: cmdName,
            module: moduleName || null,
            enabled: cmdRows.length > 0 ? Boolean(cmdRows[0].enabled) : true,
            scopes: scopeRows.map(s => ({
                type: s.scope_type,  // 'channel', 'role', 'user'
                id: s.scope_id,
                enabled: Boolean(s.enabled),
                exclusive: Boolean(s.exclusive)
            }))
        });
    } catch (error) {
        console.error('Command config error:', error);
        res.status(500).json({ error: 'Failed to fetch command config' });
    }
});

// Update command config (enabled + scopes)
router.put('/api/commands/:cmd/config', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const cmdName = req.params.cmd;
        const { enabled, scopes } = req.body;

        // Update enabled state
        if (enabled !== undefined) {
            await db.execute(`
                INSERT INTO guild_command_settings (guild_id, command, enabled)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)
            `, [guildId, cmdName, enabled]);
        }

        // Update scope rules if provided
        if (Array.isArray(scopes)) {
            // Clear existing scopes for this command
            await db.execute(
                'DELETE FROM guild_command_scope_settings WHERE guild_id = ? AND command = ?',
                [guildId, cmdName]
            );
            // Insert new scopes
            for (const scope of scopes) {
                if (scope.type && scope.id) {
                    await db.execute(`
                        INSERT INTO guild_command_scope_settings 
                        (guild_id, command, scope_type, scope_id, enabled, exclusive)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [guildId, cmdName, scope.type, scope.id,
                        scope.enabled !== false, scope.exclusive || false]);
                }
            }
        }

        await logActivity(req.guildId, req.session?.user, 'DB',
            formatAction('command', 'updated config for', cmdName));

        res.json({ success: true });
    } catch (error) {
        console.error('Command config update error:', error);
        res.status(500).json({ error: 'Failed to update command config' });
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

// Get a single scope rule by ID
router.get('/api/scope-rules/:id', async (req, res) => {
    try {
        const db = getDb();
        const [rows] = await db.execute(
            'SELECT * FROM command_scope_rules WHERE id = ? AND guild_id = ?',
            [req.params.id, req.guildId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Scope rule not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Scope rule fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch scope rule' });
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
