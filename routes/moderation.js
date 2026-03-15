// Moderation routes: blacklist, whitelist, ML settings, cooldowns, suggestions
const express = require('express');
const router = express.Router();

const { getDb } = require('../db');
const { requireBotOwner, requireGuildAccess, validateSnowflake, isValidSnowflake } = require('../security');

// ── Blacklist ───────────────────────────────────────────────────────────

router.get('/api/moderation/blacklist', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const [blacklist] = await db.execute('SELECT * FROM global_blacklist ORDER BY added_at DESC');
        res.json(blacklist);
    } catch (error) {
        console.error('Blacklist error:', error);
        res.status(500).json({ error: 'Failed to fetch blacklist' });
    }
});

router.post('/api/moderation/blacklist', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { user_id, reason } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id is required' });
        if (!isValidSnowflake(user_id)) {
            return res.status(400).json({ error: 'Invalid user_id format' });
        }
        await db.execute('INSERT INTO global_blacklist (user_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)', [user_id, reason || null]);
        res.json({ success: true });
    } catch (error) {
        console.error('Blacklist add error:', error);
        res.status(500).json({ error: 'Failed to add to blacklist' });
    }
});

router.delete('/api/moderation/blacklist/:user_id', requireBotOwner, validateSnowflake('user_id'), async (req, res) => {
    try {
        const db = getDb();
        await db.execute('DELETE FROM global_blacklist WHERE user_id = ?', [req.params.user_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Blacklist delete error:', error);
        res.status(500).json({ error: 'Failed to remove from blacklist' });
    }
});

// ── Whitelist ───────────────────────────────────────────────────────────

router.get('/api/moderation/whitelist', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const [whitelist] = await db.execute('SELECT * FROM global_whitelist ORDER BY added_at DESC');
        res.json(whitelist);
    } catch (error) {
        console.error('Whitelist error:', error);
        res.status(500).json({ error: 'Failed to fetch whitelist' });
    }
});

router.post('/api/moderation/whitelist', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { user_id, reason } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id is required' });
        if (!isValidSnowflake(user_id)) {
            return res.status(400).json({ error: 'Invalid user_id format' });
        }
        await db.execute('INSERT INTO global_whitelist (user_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)', [user_id, reason || null]);
        res.json({ success: true });
    } catch (error) {
        console.error('Whitelist add error:', error);
        res.status(500).json({ error: 'Failed to add to whitelist' });
    }
});

router.delete('/api/moderation/whitelist/:user_id', requireBotOwner, validateSnowflake('user_id'), async (req, res) => {
    try {
        const db = getDb();
        await db.execute('DELETE FROM global_whitelist WHERE user_id = ?', [req.params.user_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Whitelist delete error:', error);
        res.status(500).json({ error: 'Failed to remove from whitelist' });
    }
});

// ── ML Settings ─────────────────────────────────────────────────────────

router.get('/api/ml/settings', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const [settings] = await db.execute('SELECT * FROM ml_settings');
        
        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.key] = setting.value;
        });

        res.json(settingsObj);
    } catch (error) {
        console.error('ML settings error:', error);
        res.status(500).json({ error: 'Failed to fetch ML settings' });
    }
});

router.post('/api/ml/settings', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { key, value } = req.body;

        await db.execute(`
            INSERT INTO ml_settings (\`key\`, \`value\`) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
        `, [key, value]);

        res.json({ success: true });
    } catch (error) {
        console.error('ML settings update error:', error);
        res.status(500).json({ error: 'Failed to update ML setting' });
    }
});

router.delete('/api/ml/settings/:key', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { key } = req.params;
        await db.execute('DELETE FROM ml_settings WHERE `key` = ?', [key]);
        res.json({ success: true });
    } catch (error) {
        console.error('ML setting delete error:', error);
        res.status(500).json({ error: 'Failed to delete ML setting' });
    }
});

// ── Moderation Logs ─────────────────────────────────────────────────────

router.get('/api/moderation/logs', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;

        const action = req.query.action || '';
        const userId = req.query.user_id || '';

        let where = `guild_id = ?`;
        const params = [guildId];

        if (action) {
            where += ` AND type = ?`;
            params.push(action);
        }
        if (userId) {
            where += ` AND (user_id = ? OR moderator_id = ?)`;
            params.push(userId, userId);
        }

        const [rows] = await db.execute(
            `SELECT case_number, user_id, moderator_id, type, reason, points, active, created_at
             FROM guild_infractions
             WHERE ${where}
             ORDER BY created_at DESC LIMIT 50`,
            params
        );

        // Map to expected frontend format
        const logs = rows.map(r => ({
            action: r.type,
            target_id: r.user_id,
            moderator_id: r.moderator_id,
            reason: r.reason,
            points: r.points,
            active: r.active,
            case_number: r.case_number,
            created_at: r.created_at
        }));

        res.json(logs);
    } catch (error) {
        console.warn('Moderation logs fetch:', error.message);
        res.json([]);
    }
});

// ── Cooldowns ───────────────────────────────────────────────────────────

router.get('/api/moderation/cooldowns', async (req, res) => {
    try {
        const db = getDb();
        const [cooldowns] = await db.execute('SELECT * FROM command_cooldowns ORDER BY command ASC');
        res.json(cooldowns);
    } catch (error) {
        console.error('Cooldowns fetch error:', error);
        res.json([]);
    }
});

router.post('/api/moderation/cooldowns', async (req, res) => {
    try {
        const db = getDb();
        const { command, cooldown_seconds } = req.body;
        
        await db.execute(`
            INSERT INTO command_cooldowns (command, cooldown_seconds)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE cooldown_seconds = VALUES(cooldown_seconds)
        `, [command, cooldown_seconds]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Cooldown update error:', error);
        res.status(500).json({ error: 'Failed to update cooldown' });
    }
});

// ── Suggestions ─────────────────────────────────────────────────────────

router.get('/api/suggestions', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const [suggestions] = await db.execute(`
            SELECT s.*, u.user_id 
            FROM suggestions s 
            JOIN users u ON s.user_id = u.user_id
            ORDER BY s.submitted_at DESC 
            LIMIT 50
        `);
        res.json(suggestions);
    } catch (error) {
        console.error('Suggestions error:', error);
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

// ── Infractions ─────────────────────────────────────────────────────────

// GET /api/moderation/infractions — Paginated infraction list with filters
router.get('/api/moderation/infractions', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = BigInt(req.guildId);
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
        const offset = (page - 1) * limit;

        let where = `guild_id = ?`;
        const params = [guildId];

        if (req.query.user_id) {
            where += ` AND user_id = ?`;
            params.push(req.query.user_id);
        }
        if (req.query.type) {
            where += ` AND type = ?`;
            params.push(req.query.type);
        }
        if (req.query.active !== undefined) {
            where += ` AND active = ?`;
            params.push(req.query.active === 'true' ? 1 : 0);
        }
        if (req.query.moderator_id) {
            where += ` AND moderator_id = ?`;
            params.push(req.query.moderator_id);
        }

        const [[{ total }]] = await db.execute(
            `SELECT COUNT(*) as total FROM guild_infractions WHERE ${where}`,
            params
        );

        const [infractions] = await db.execute(
            `SELECT * FROM guild_infractions WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        res.json({
            infractions,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Infractions list error:', error);
        res.status(500).json({ error: 'Failed to fetch infractions' });
    }
});

// GET /api/moderation/infractions/:caseNumber — Single case detail
router.get('/api/moderation/infractions/:caseNumber', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const caseNumber = parseInt(req.params.caseNumber);

        const [rows] = await db.execute(
            `SELECT * FROM guild_infractions WHERE guild_id = ? AND case_number = ?`,
            [guildId, caseNumber]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Infraction not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Infraction detail error:', error);
        res.status(500).json({ error: 'Failed to fetch infraction' });
    }
});

// POST /api/moderation/infractions/:caseNumber/pardon — Pardon an infraction
router.post('/api/moderation/infractions/:caseNumber/pardon', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const caseNumber = parseInt(req.params.caseNumber);
        const { reason } = req.body;
        const pardonerId = req.session.user.id;

        const [result] = await db.execute(
            `UPDATE guild_infractions SET pardoned = 1, pardoned_by = ?, pardoned_at = NOW(), pardoned_reason = ?, active = 0 WHERE guild_id = ? AND case_number = ? AND pardoned = 0`,
            [pardonerId, reason || null, guildId, caseNumber]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Infraction not found or already pardoned' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Pardon infraction error:', error);
        res.status(500).json({ error: 'Failed to pardon infraction' });
    }
});

// GET /api/moderation/user/:userId/summary — User moderation summary
router.get('/api/moderation/user/:userId/summary', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const userId = req.params.userId;

        const [[{ total }]] = await db.execute(
            `SELECT COUNT(*) as total FROM guild_infractions WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );

        const [[{ active }]] = await db.execute(
            `SELECT COUNT(*) as active FROM guild_infractions WHERE guild_id = ? AND user_id = ? AND active = 1`,
            [guildId, userId]
        );

        const [[{ pardoned }]] = await db.execute(
            `SELECT COUNT(*) as pardoned FROM guild_infractions WHERE guild_id = ? AND user_id = ? AND pardoned = 1`,
            [guildId, userId]
        );

        const [[{ active_points }]] = await db.execute(
            `SELECT COALESCE(SUM(points), 0) as active_points FROM guild_infractions WHERE guild_id = ? AND user_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [guildId, userId]
        );

        const [recent] = await db.execute(
            `SELECT * FROM guild_infractions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10`,
            [guildId, userId]
        );

        const [breakdownRows] = await db.execute(
            `SELECT type, COUNT(*) as count FROM guild_infractions WHERE guild_id = ? AND user_id = ? GROUP BY type`,
            [guildId, userId]
        );

        const breakdown = {};
        breakdownRows.forEach(r => { breakdown[r.type] = r.count; });

        res.json({ total, active, pardoned, active_points, recent, breakdown });
    } catch (error) {
        console.error('User summary error:', error);
        res.status(500).json({ error: 'Failed to fetch user summary' });
    }
});

// GET /api/moderation/moderator/:modId/summary — Moderator action summary
router.get('/api/moderation/moderator/:modId/summary', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const modId = req.params.modId;

        const [[{ total }]] = await db.execute(
            `SELECT COUNT(*) as total FROM guild_infractions WHERE guild_id = ? AND moderator_id = ?`,
            [guildId, modId]
        );

        const [breakdownRows] = await db.execute(
            `SELECT type, COUNT(*) as count FROM guild_infractions WHERE guild_id = ? AND moderator_id = ? GROUP BY type`,
            [guildId, modId]
        );

        const breakdown = {};
        breakdownRows.forEach(r => { breakdown[r.type] = r.count; });

        const [recent] = await db.execute(
            `SELECT * FROM guild_infractions WHERE guild_id = ? AND moderator_id = ? ORDER BY created_at DESC LIMIT 10`,
            [guildId, modId]
        );

        res.json({ total, breakdown, recent });
    } catch (error) {
        console.error('Moderator summary error:', error);
        res.status(500).json({ error: 'Failed to fetch moderator summary' });
    }
});

// ── Infraction Config ───────────────────────────────────────────────────

// GET /api/moderation/config — Get infraction config for guild
router.get('/api/moderation/config', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;

        const [rows] = await db.execute(
            `SELECT * FROM guild_infraction_config WHERE guild_id = ?`,
            [guildId]
        );

        if (rows.length === 0) {
            return res.json({
                guild_id: guildId,
                point_warn: 0.10,
                point_timeout: 0.25,
                point_mute: 0.50,
                point_kick: 2.00,
                point_ban: 5.00,
                escalation_rules: '[]',
                dm_on_action: true,
                log_channel_id: null
            });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Infraction config error:', error);
        res.status(500).json({ error: 'Failed to fetch infraction config' });
    }
});

// POST /api/moderation/config — Update infraction config
router.post('/api/moderation/config', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const {
            point_warn, point_timeout, point_mute, point_kick, point_ban,
            escalation_rules, dm_on_action, log_channel_id
        } = req.body;

        // Validate points >= 0
        const pointFields = { point_warn, point_timeout, point_mute, point_kick, point_ban };
        for (const [key, val] of Object.entries(pointFields)) {
            if (val !== undefined && (typeof val !== 'number' || val < 0)) {
                return res.status(400).json({ error: `${key} must be a non-negative number` });
            }
        }

        // Validate escalation_rules is valid JSON array if provided
        if (escalation_rules !== undefined) {
            try {
                const parsed = typeof escalation_rules === 'string' ? JSON.parse(escalation_rules) : escalation_rules;
                if (!Array.isArray(parsed)) {
                    return res.status(400).json({ error: 'escalation_rules must be a JSON array' });
                }
            } catch (e) {
                return res.status(400).json({ error: 'escalation_rules must be valid JSON' });
            }
        }

        const escalationStr = escalation_rules !== undefined
            ? (typeof escalation_rules === 'string' ? escalation_rules : JSON.stringify(escalation_rules))
            : '[]';

        await db.execute(
            `INSERT INTO guild_infraction_config
                (guild_id, point_warn, point_timeout, point_mute, point_kick, point_ban,
                 escalation_rules, dm_on_action, log_channel_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                point_warn        = VALUES(point_warn),
                point_timeout     = VALUES(point_timeout),
                point_mute        = VALUES(point_mute),
                point_kick        = VALUES(point_kick),
                point_ban         = VALUES(point_ban),
                escalation_rules  = VALUES(escalation_rules),
                dm_on_action      = VALUES(dm_on_action),
                log_channel_id    = VALUES(log_channel_id)`,
            [
                guildId,
                point_warn   ?? 0.10,
                point_timeout ?? 0.25,
                point_mute   ?? 0.50,
                point_kick   ?? 2.00,
                point_ban    ?? 5.00,
                escalationStr,
                dm_on_action !== undefined ? (dm_on_action ? 1 : 0) : 1,
                log_channel_id || null
            ]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Infraction config update error:', error);
        res.status(500).json({ error: 'Failed to update infraction config' });
    }
});

// ── Automod Config ──────────────────────────────────────────────────────

// GET /api/moderation/automod — Get automod config
router.get('/api/moderation/automod', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;

        const [rows] = await db.execute(
            `SELECT * FROM guild_automod_config WHERE guild_id = ?`,
            [guildId]
        );

        const r = rows.length > 0 ? rows[0] : {};

        // Reshape flat columns into nested structure the frontend expects
        res.json({
            guild_id: guildId,
            account_age: {
                enabled:  !!r.account_age_enabled,
                min_days: r.account_age_days ?? 7
            },
            avatar: {
                enabled:        !!r.default_avatar_enabled,
                require_avatar: !!r.default_avatar_enabled
            },
            mutual_servers: {
                enabled:    !!r.mutual_servers_enabled,
                min_mutual: r.mutual_servers_min ?? 1
            },
            nickname_sanitizer: {
                enabled:          !!r.nickname_sanitize_enabled,
                sanitize_pattern: r.nickname_sanitize_format ?? ''
            },
            escalation: {
                enabled:              !!r.infraction_escalation_enabled,
                enabled_escalation:   !!r.infraction_escalation_enabled
            }
        });
    } catch (error) {
        console.error('Automod config error:', error);
        res.status(500).json({ error: 'Failed to fetch automod config' });
    }
});

// POST /api/moderation/automod — Update automod config
router.post('/api/moderation/automod', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;

        // Frontend sends nested: { account_age: { enabled, min_days }, avatar: { require_avatar }, ... }
        // Schema stores flat columns — flatten here
        const {
            account_age = {},
            avatar = {},
            mutual_servers = {},
            nickname_sanitizer = {},
            escalation = {}
        } = req.body;

        await db.execute(
            `INSERT INTO guild_automod_config
                (guild_id,
                 account_age_enabled, account_age_days,
                 default_avatar_enabled,
                 mutual_servers_enabled, mutual_servers_min,
                 nickname_sanitize_enabled,
                 infraction_escalation_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                account_age_enabled           = VALUES(account_age_enabled),
                account_age_days              = VALUES(account_age_days),
                default_avatar_enabled        = VALUES(default_avatar_enabled),
                mutual_servers_enabled        = VALUES(mutual_servers_enabled),
                mutual_servers_min            = VALUES(mutual_servers_min),
                nickname_sanitize_enabled     = VALUES(nickname_sanitize_enabled),
                infraction_escalation_enabled = VALUES(infraction_escalation_enabled)`,
            [
                guildId,
                account_age.enabled      ? 1 : 0,
                account_age.min_days     ?? 7,
                avatar.require_avatar    ? 1 : 0,
                mutual_servers.enabled   ? 1 : 0,
                mutual_servers.min_mutual ?? 1,
                nickname_sanitizer.enabled ? 1 : 0,
                escalation.enabled_escalation ? 1 : 0
            ]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Automod config update error:', error);
        res.status(500).json({ error: 'Failed to update automod config' });
    }
});

// ── Role Classes ────────────────────────────────────────────────────────

// GET /api/moderation/role-classes — List role classes for guild
router.get('/api/moderation/role-classes', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;

        const [classes] = await db.execute(
            `SELECT * FROM guild_role_classes WHERE guild_id = ? ORDER BY priority DESC`,
            [guildId]
        );

        // Attach role members to each class
        for (const cls of classes) {
            const [members] = await db.execute(
                `SELECT role_id FROM guild_role_class_members WHERE class_id = ?`,
                [cls.id]
            );
            cls.roles = members.map(m => m.role_id);
        }

        res.json(classes);
    } catch (error) {
        console.error('Role classes error:', error);
        res.status(500).json({ error: 'Failed to fetch role classes' });
    }
});

// POST /api/moderation/role-classes — Create or update role class
router.post('/api/moderation/role-classes', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { id, name, priority, inherit_lower, restrictions } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        // Validate restrictions is valid JSON if provided
        let restrictionsStr = null;
        if (restrictions !== undefined) {
            try {
                restrictionsStr = typeof restrictions === 'string' ? restrictions : JSON.stringify(restrictions);
                JSON.parse(restrictionsStr); // validate
            } catch (e) {
                return res.status(400).json({ error: 'restrictions must be valid JSON' });
            }
        }

        if (id) {
            // Update existing
            await db.execute(
                `UPDATE guild_role_classes SET name = ?, priority = ?, inherit_lower = ?, restrictions = ? WHERE id = ? AND guild_id = ?`,
                [name, priority || 0, inherit_lower ? 1 : 0, restrictionsStr, id, guildId]
            );
            res.json({ success: true, id });
        } else {
            // Insert new
            const [result] = await db.execute(
                `INSERT INTO guild_role_classes (guild_id, name, priority, inherit_lower, restrictions) VALUES (?, ?, ?, ?, ?)`,
                [guildId, name, priority || 0, inherit_lower ? 1 : 0, restrictionsStr]
            );
            res.json({ success: true, id: result.insertId });
        }
    } catch (error) {
        console.error('Role class create/update error:', error);
        res.status(500).json({ error: 'Failed to save role class' });
    }
});

// DELETE /api/moderation/role-classes/:id — Delete role class
router.delete('/api/moderation/role-classes/:id', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const classId = req.params.id;

        await db.execute(
            `DELETE FROM guild_role_classes WHERE id = ? AND guild_id = ?`,
            [classId, guildId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Role class delete error:', error);
        res.status(500).json({ error: 'Failed to delete role class' });
    }
});

// POST /api/moderation/role-classes/:id/roles — Assign role to class
router.post('/api/moderation/role-classes/:id/roles', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const classId = req.params.id;
        const { role_id } = req.body;

        if (!role_id) {
            return res.status(400).json({ error: 'role_id is required' });
        }

        await db.execute(
            `INSERT INTO guild_role_class_members (guild_id, role_id, class_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE class_id = ?`,
            [guildId, role_id, classId, classId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Role class assign error:', error);
        res.status(500).json({ error: 'Failed to assign role to class' });
    }
});

// DELETE /api/moderation/role-classes/:id/roles/:roleId — Remove role from class
router.delete('/api/moderation/role-classes/:id/roles/:roleId', requireGuildAccess, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const classId = req.params.id;
        const roleId = req.params.roleId;

        await db.execute(
            `DELETE FROM guild_role_class_members WHERE guild_id = ? AND role_id = ? AND class_id = ?`,
            [guildId, roleId, classId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Role class remove role error:', error);
        res.status(500).json({ error: 'Failed to remove role from class' });
    }
});

module.exports = router;