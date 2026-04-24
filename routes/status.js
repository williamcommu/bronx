const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

/**
 * @api {get} /status/heartbeats Fetch bot health metrics
 * @apiName GetHeartbeats
 * @apiGroup Status
 */
router.get('/api/status/heartbeats', async (req, res) => {
    try {
        const db = getDb();
        const [shards] = await db.execute('SELECT * FROM bot_heartbeats ORDER BY shard_id ASC');
        
        // Calculate aggregate stats
        const totalGuilds = shards.reduce((acc, s) => acc + s.guild_count, 0);
        const totalMemory = shards.reduce((acc, s) => acc + s.memory_usage_mb, 0);
        const maxUptime = Math.max(...shards.map(s => s.uptime_seconds), 0);
        
        res.json({
            success: true,
            shards: shards.map(s => ({
                id: s.shard_id,
                uptime: s.uptime_seconds,
                memory: s.memory_usage_mb,
                guilds: s.guild_count,
                status: s.status,
                lastUpdate: s.last_heartbeat
            })),
            totals: {
                guilds: totalGuilds,
                memory: totalMemory,
                uptime: maxUptime
            }
        });
    } catch (error) {
        console.error('Status API Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch status' });
    }
});

module.exports = router;
