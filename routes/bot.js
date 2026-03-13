// Bot integration routes: command logging and event ingestion
// These endpoints are called by the Discord bot, authenticated via API key.
const express = require('express');
const router = express.Router();

const { getDb } = require('../db');

// io (socket.io) is injected via module.exports function
let io = null;

function setIo(ioInstance) {
    io = ioInstance;
}

// ── Bot Logging Endpoint ────────────────────────────────────────────────

router.post('/api/bot/log', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.BOT_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = getDb();
    const { type, guild_id, user_id, command_name, fish_name } = req.body;

    if (!type || !guild_id || !user_id) {
        return res.status(400).json({ error: 'Missing required fields: type, guild_id, user_id' });
    }

    try {
        if (type === 'command') {
            if (!command_name) return res.status(400).json({ error: 'command_name required for type=command' });
            await db.execute(
                'INSERT INTO command_stats (user_id, guild_id, command_name) VALUES (?, ?, ?)',
                [user_id, guild_id, command_name]
            );
        } else if (type === 'fish') {
            await db.execute(
                'INSERT INTO fish_catches (user_id, guild_id, fish_name) VALUES (?, ?, ?)',
                [user_id, guild_id, fish_name || null]
            );
        } else {
            return res.status(400).json({ error: 'type must be "command" or "fish"' });
        }

        res.json({ ok: true });
    } catch (error) {
        console.error('Bot log error:', error);
        res.status(500).json({ error: 'Failed to log event' });
    }
});

// ── Bot Events Endpoint ─────────────────────────────────────────────────

router.post('/api/bot/events', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.BOT_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = getDb();
    const events = Array.isArray(req.body) ? req.body : [req.body];
    let inserted = 0;

    for (const ev of events) {
        const { type, guild_id, user_id, channel_id, command_name } = ev;
        if (!type || !guild_id) continue;

        try {
            switch (type) {
                case 'join':
                case 'leave':
                    await db.execute(
                        'INSERT INTO guild_member_events (guild_id, user_id, event_type) VALUES (?, ?, ?)',
                        [guild_id, user_id || '0', type]
                    );
                    if (io) io.to(`server-${guild_id}`).emit('member-event', { type, user_id, timestamp: new Date() });
                    break;

                case 'message':
                case 'edit':
                case 'delete':
                    await db.execute(
                        'INSERT INTO guild_message_events (guild_id, user_id, channel_id, event_type) VALUES (?, ?, ?, ?)',
                        [guild_id, user_id || '0', channel_id || '0', type]
                    );
                    if (io) io.to(`server-${guild_id}`).emit('message-stats-update', { type, channel_id, timestamp: new Date() });
                    break;

                case 'command':
                    if (command_name) {
                        await db.execute(
                            `INSERT INTO guild_command_usage (guild_id, command_name, channel_id, usage_date, use_count) 
                             VALUES (?, ?, ?, CURDATE(), 1) 
                             ON DUPLICATE KEY UPDATE use_count = use_count + 1`,
                            [guild_id, command_name, channel_id || '0']
                        );
                        if (io) io.to(`server-${guild_id}`).emit('command-stats-update', { command_name, channel_id, timestamp: new Date() });
                    }
                    break;
            }
            inserted++;
        } catch (error) {
            console.error(`Bot event error (${type}):`, error.message);
        }
    }

    res.json({ ok: true, inserted });
});

module.exports = router;
module.exports.setIo = setIo;
