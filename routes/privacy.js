// Privacy API routes: opt-out management and data status
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../db');

// ── Privacy table auto-creation ─────────────────────────────────────────

async function ensurePrivacyTables() {
    try {
        await dbQuery(`CREATE TABLE IF NOT EXISTS user_privacy (
            user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            opted_out BOOLEAN NOT NULL DEFAULT FALSE,
            opted_out_at TIMESTAMP NULL DEFAULT NULL,
            data_deleted_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS encrypted_identity_cache (
            user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            encrypted_username VARBINARY(512) DEFAULT NULL,
            encrypted_nickname VARBINARY(512) DEFAULT NULL,
            encrypted_avatar VARBINARY(1024) DEFAULT NULL,
            encryption_iv VARBINARY(16) NOT NULL,
            cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            INDEX idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) {
        // tables might already exist — that's fine
    }
}

// run on module load
ensurePrivacyTables().catch(console.error);

// ── GET /api/privacy/status — check opt-out status for logged-in user ───

router.get('/api/privacy/status', async (req, res) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'not authenticated' });
    }

    const userId = req.session.user.id;

    try {
        const [rows] = await dbQuery(
            'SELECT opted_out, opted_out_at, data_deleted_at FROM user_privacy WHERE user_id = ?',
            [userId]
        );

        if (rows.length === 0) {
            return res.json({
                opted_out: false,
                opted_out_at: null,
                data_deleted_at: null
            });
        }

        return res.json({
            opted_out: !!rows[0].opted_out,
            opted_out_at: rows[0].opted_out_at,
            data_deleted_at: rows[0].data_deleted_at
        });
    } catch (error) {
        console.error('Error checking privacy status:', error);
        return res.status(500).json({ error: 'failed to check privacy status' });
    }
});

// ── POST /api/privacy/optout — opt out and delete all user data ─────────

router.post('/api/privacy/optout', async (req, res) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'not authenticated' });
    }

    const userId = req.session.user.id;

    try {
        // set opted out
        await dbQuery(
            `INSERT INTO user_privacy (user_id, opted_out, opted_out_at) VALUES (?, TRUE, NOW())
             ON DUPLICATE KEY UPDATE opted_out = TRUE, opted_out_at = NOW()`,
            [userId]
        );

        // delete all user data from every table
        const tables = [
            'users', 'server_users', 'loans', 'inventory', 'server_inventory',
            'wishlists', 'fish_catches', 'active_fishing_gear', 'autofishers',
            'autofish_storage', 'server_fish_catches', 'server_active_fishing_gear',
            'server_autofishers', 'server_autofish_storage', 'fish_ponds', 'pond_fish',
            'bazaar_stock', 'bazaar_visitors', 'bazaar_purchases',
            'gambling_stats', 'server_gambling_stats', 'lottery_entries',
            'user_xp', 'server_xp', 'user_skill_points',
            'daily_challenges', 'daily_stats', 'daily_streaks',
            'user_pets', 'mining_claims',
            'trades', 'server_trades',
            'giveaway_entries',
            'cooldowns', 'server_cooldowns',
            'afk_status', 'command_history', 'command_stats',
            'suggestions', 'bug_reports',
            'user_prefixes',
            'server_bot_admins', 'server_bot_mods',
            'encrypted_identity_cache',
            'guild_member_events', 'guild_message_events',
            'guild_voice_events', 'guild_boost_events',
            'server_command_stats'
        ];

        let totalDeleted = 0;
        for (const table of tables) {
            try {
                const [result] = await dbQuery(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
                totalDeleted += result.affectedRows || 0;
            } catch (e) {
                // table might not exist — skip
            }
        }

        // also handle initiator_id / recipient_id columns
        const extraCols = [
            ['trades', 'initiator_id'],
            ['trades', 'recipient_id'],
            ['server_trades', 'initiator_id'],
            ['server_trades', 'recipient_id'],
            ['giveaways', 'created_by']
        ];
        for (const [table, col] of extraCols) {
            try {
                const [result] = await dbQuery(`DELETE FROM ${table} WHERE ${col} = ?`, [userId]);
                totalDeleted += result.affectedRows || 0;
            } catch (e) {
                // skip
            }
        }

        // mark deletion time
        await dbQuery(
            'UPDATE user_privacy SET data_deleted_at = NOW() WHERE user_id = ?',
            [userId]
        );

        console.log(`[Privacy] User ${userId} opted out — ${totalDeleted} rows deleted`);

        return res.json({
            success: true,
            rows_deleted: totalDeleted,
            message: 'all data has been deleted and you have been opted out'
        });
    } catch (error) {
        console.error('Error processing opt-out:', error);
        return res.status(500).json({ error: 'failed to process opt-out' });
    }
});

// ── POST /api/privacy/optin — opt back in ───────────────────────────────

router.post('/api/privacy/optin', async (req, res) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'not authenticated' });
    }

    const userId = req.session.user.id;

    try {
        await dbQuery(
            `INSERT INTO user_privacy (user_id, opted_out, opted_out_at) VALUES (?, FALSE, NULL)
             ON DUPLICATE KEY UPDATE opted_out = FALSE, opted_out_at = NULL`,
            [userId]
        );

        console.log(`[Privacy] User ${userId} opted back in`);

        return res.json({
            success: true,
            message: 'you have been opted back in — you can use the bot again'
        });
    } catch (error) {
        console.error('Error processing opt-in:', error);
        return res.status(500).json({ error: 'failed to process opt-in' });
    }
});

// ── GET /api/privacy/data-summary — show what data types exist ──────────

router.get('/api/privacy/data-summary', async (req, res) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'not authenticated' });
    }

    const userId = req.session.user.id;

    try {
        const summary = {};

        // check each data category
        const checks = [
            { key: 'economy', query: 'SELECT 1 FROM users WHERE user_id = ? LIMIT 1' },
            { key: 'fishing', query: 'SELECT 1 FROM fish_catches WHERE user_id = ? LIMIT 1' },
            { key: 'inventory', query: 'SELECT 1 FROM inventory WHERE user_id = ? LIMIT 1' },
            { key: 'gambling', query: 'SELECT 1 FROM gambling_stats WHERE user_id = ? LIMIT 1' },
            { key: 'leveling', query: 'SELECT 1 FROM user_xp WHERE user_id = ? LIMIT 1' },
            { key: 'pets', query: 'SELECT 1 FROM user_pets WHERE user_id = ? LIMIT 1' },
            { key: 'challenges', query: 'SELECT 1 FROM daily_challenges WHERE user_id = ? LIMIT 1' },
            { key: 'command_history', query: 'SELECT 1 FROM command_stats WHERE user_id = ? LIMIT 1' }
        ];

        for (const check of checks) {
            try {
                const [rows] = await dbQuery(check.query, [userId]);
                summary[check.key] = rows.length > 0;
            } catch (e) {
                summary[check.key] = false;
            }
        }

        return res.json(summary);
    } catch (error) {
        console.error('Error fetching data summary:', error);
        return res.status(500).json({ error: 'failed to fetch data summary' });
    }
});

module.exports = router;
