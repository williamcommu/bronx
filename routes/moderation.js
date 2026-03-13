// Moderation routes: blacklist, whitelist, ML settings, cooldowns, suggestions
const express = require('express');
const router = express.Router();

const { getDb } = require('../db');
const { requireBotOwner, validateSnowflake, isValidSnowflake } = require('../security');

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

module.exports = router;
