// Economy routes: balance, shop, daily deals, bazaar, market items
const express = require('express');
const router = express.Router();

const { getDb } = require('../db');
const { requireBotOwner, isValidSnowflake } = require('../security');
const { requireServerEconomy } = require('../middleware');

// ── Economy Mode ────────────────────────────────────────────────────────

router.get('/api/economy/mode', async (req, res) => {
    const guildId = req.guildId;
    if (!guildId || guildId === 'global') {
        return res.json({ economy_mode: 'global' });
    }
    res.json({ economy_mode: 'global' });
});

// ── Guild Balance ───────────────────────────────────────────────────────

router.get('/api/economy/guild-balance', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        
        if (!guildId || guildId === 'global') {
            return res.json({ balance: 0, total_donated: 0, total_given: 0, noServerSelected: true });
        }

        const [balance] = await db.execute('SELECT * FROM guild_balances WHERE guild_id = ?', [guildId]);

        if (balance.length === 0) {
            res.json({ balance: 0, total_donated: 0, total_given: 0 });
        } else {
            res.json(balance[0]);
        }
    } catch (error) {
        console.error('Guild balance error:', error);
        res.status(500).json({ error: 'Failed to fetch guild balance' });
    }
});

router.post('/api/economy/guild-balance/adjust', requireServerEconomy, async (req, res) => {
    try {
        const db = getDb();
        const { adjustment, reason } = req.body;

        await db.execute(`
            INSERT INTO guild_balances (guild_id, balance) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE balance = balance + ?
        `, [req.guildId, adjustment, adjustment]);

        res.json({ success: true });
    } catch (error) {
        console.error('Guild balance adjustment error:', error);
        res.status(500).json({ error: 'Failed to adjust guild balance' });
    }
});

// ── Interest Settings ───────────────────────────────────────────────────

router.get('/api/economy/interest-settings', async (req, res) => {
    res.json({ interest_rate: 0.02, interest_interval_hours: 24, max_bank_interest: 1000000 });
});

router.post('/api/economy/interest-settings', requireServerEconomy, async (req, res) => {
    res.status(403).json({ error: 'Server economy settings are not available. Economy runs in global mode.' });
});

// ── Shop Items ──────────────────────────────────────────────────────────

router.get('/api/shop/items', async (req, res) => {
    try {
        const db = getDb();
        const [items] = await db.execute(`
            SELECT item_id, name, category, price, level, max_quantity, description
            FROM shop_items ORDER BY category, level, name
        `);
        res.json(items);
    } catch (error) {
        console.error('Shop items error:', error);
        res.status(500).json({ error: 'Failed to fetch shop items' });
    }
});

router.post('/api/shop/items', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { item_id, name, description, category, price, level, max_quantity } = req.body;
        
        if (!item_id || !name || !category) {
            return res.status(400).json({ error: 'item_id, name, and category are required' });
        }
        
        const priceNum = Number(price);
        const levelNum = Number(level) || 1;
        const maxQtyNum = Number(max_quantity) || 1;
        
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({ error: 'price must be a valid non-negative number' });
        }

        await db.execute(`
            INSERT INTO shop_items (item_id, name, description, category, price, level, max_quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [item_id, name, description || null, category, priceNum, levelNum, maxQtyNum]);

        res.json({ success: true });
    } catch (error) {
        console.error('Shop items creation error:', error);
        res.status(500).json({ error: 'Failed to create shop item' });
    }
});

router.put('/api/shop/items/:item_id', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { item_id } = req.params;
        const { name, description, category, price, level, max_quantity } = req.body;
        
        const priceNum = Number(price);
        const levelNum = Number(level) || 1;
        const maxQtyNum = Number(max_quantity) || 1;
        
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({ error: 'price must be a valid non-negative number' });
        }
        
        await db.execute(`
            UPDATE shop_items 
            SET name = ?, description = ?, category = ?, price = ?, level = ?, max_quantity = ?
            WHERE item_id = ?
        `, [name, description || null, category, priceNum, levelNum, maxQtyNum, item_id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Shop item update error:', error);
        res.status(500).json({ error: 'Failed to update shop item' });
    }
});

router.delete('/api/shop/items/:item_id', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { item_id } = req.params;
        await db.execute('DELETE FROM shop_items WHERE item_id = ?', [item_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Shop item delete error:', error);
        res.status(500).json({ error: 'Failed to delete shop item' });
    }
});

// ── Daily Deals ─────────────────────────────────────────────────────────

router.get('/api/shop/daily-deals', async (req, res) => {
    try {
        const db = getDb();
        const [deals] = await db.execute(`
            SELECT dd.*, si.name as item_name
            FROM daily_deals dd
            JOIN shop_items si ON dd.item_id = si.item_id
            WHERE dd.active_date = CURDATE()
        `);
        res.json(deals);
    } catch (error) {
        console.error('Daily deals error:', error);
        res.status(500).json({ error: 'Failed to fetch daily deals' });
    }
});

router.post('/api/shop/daily-deals', async (req, res) => {
    try {
        const db = getDb();
        const { item_id, discount, stock } = req.body;
        
        await db.execute(`
            INSERT INTO daily_deals (item_id, discount, stock, active_date)
            VALUES (?, ?, ?, CURDATE())
            ON DUPLICATE KEY UPDATE discount = VALUES(discount), stock = VALUES(stock)
        `, [item_id, discount, stock || null]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Daily deal creation error:', error);
        res.status(500).json({ error: 'Failed to create daily deal' });
    }
});

router.put('/api/shop/daily-deals/:id', async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const { item_id, discount, stock } = req.body;
        
        await db.execute(`
            UPDATE daily_deals SET item_id = ?, discount = ?, stock = ? WHERE id = ? OR item_id = ?
        `, [item_id, discount, stock, id, id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Daily deal update error:', error);
        res.status(500).json({ error: 'Failed to update daily deal' });
    }
});

router.delete('/api/shop/daily-deals/:id', async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        await db.execute('DELETE FROM daily_deals WHERE id = ? OR item_id = ?', [id, id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Daily deal delete error:', error);
        res.status(500).json({ error: 'Failed to delete daily deal' });
    }
});

// ── Bazaar Stats ────────────────────────────────────────────────────────

router.get('/api/bazaar/stats', async (req, res) => {
    try {
        const db = getDb();
        const [[listingCount]] = await db.execute('SELECT COUNT(*) as count FROM bazaar_listings WHERE active = 1').catch(() => [[{ count: 0 }]]);
        const [[totalVolume]] = await db.execute('SELECT COALESCE(SUM(price * quantity), 0) as total FROM bazaar_listings WHERE active = 1').catch(() => [[{ total: 0 }]]);
        const [[recentSales]] = await db.execute('SELECT COUNT(*) as count FROM bazaar_transactions WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)').catch(() => [[{ count: 0 }]]);
        const [topItems] = await db.execute(
            'SELECT item_id, SUM(quantity) as qty FROM bazaar_listings WHERE active = 1 GROUP BY item_id ORDER BY qty DESC LIMIT 5'
        ).catch(() => [[]]);

        res.json({
            active_listings: listingCount.count,
            total_volume: totalVolume.total,
            sales_24h: recentSales.count,
            top_items: topItems
        });
    } catch (error) {
        console.error('Bazaar stats error:', error);
        res.json({ active_listings: 0, total_volume: 0, sales_24h: 0, top_items: [] });
    }
});

// ── Server Market Items (per-guild) ─────────────────────────────────────

router.get('/api/market/items', async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        if (!guildId || guildId === 'global') return res.json([]);

        const [items] = await db.execute(
            `SELECT item_id, name, description, category, price, max_quantity, metadata, expires_at
             FROM market_items WHERE guild_id = ? ORDER BY category, name`,
            [guildId]
        );
        res.json(items);
    } catch (error) {
        console.error('Market items error:', error);
        res.status(500).json({ error: 'Failed to fetch market items' });
    }
});

router.post('/api/market/items', requireServerEconomy, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { item_id, name, description, category, price, max_quantity, metadata } = req.body;
        if (!item_id || !name || !category || !price) {
            return res.status(400).json({ error: 'item_id, name, category, and price are required' });
        }
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({ error: 'price must be a valid non-negative number' });
        }
        await db.execute(
            `INSERT INTO market_items (guild_id, item_id, name, description, category, price, max_quantity, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [guildId, item_id, name, description || null, category, priceNum, max_quantity || null, metadata ? JSON.stringify(metadata) : null]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Market item creation error:', error);
        res.status(500).json({ error: 'Failed to create market item' });
    }
});

router.put('/api/market/items/:item_id', requireServerEconomy, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { item_id } = req.params;
        const { name, description, category, price, max_quantity, metadata } = req.body;
        if (!name || !price) {
            return res.status(400).json({ error: 'name and price are required' });
        }
        const [result] = await db.execute(
            `UPDATE market_items SET name = ?, description = ?, category = ?, price = ?, max_quantity = ?, metadata = ?
             WHERE guild_id = ? AND item_id = ?`,
            [name, description || null, category, Number(price), max_quantity || null, metadata ? JSON.stringify(metadata) : null, guildId, item_id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Market item not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Market item update error:', error);
        res.status(500).json({ error: 'Failed to update market item' });
    }
});

router.delete('/api/market/items/:item_id', requireServerEconomy, async (req, res) => {
    try {
        const db = getDb();
        const guildId = req.guildId;
        const { item_id } = req.params;
        const [result] = await db.execute(
            'DELETE FROM market_items WHERE guild_id = ? AND item_id = ?',
            [guildId, item_id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Market item not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Market item deletion error:', error);
        res.status(500).json({ error: 'Failed to delete market item' });
    }
});

// ── Global Discovery Approval ──────────────────────────────────────────

router.get('/api/owner/pending-global', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { fetchGuildMetadata } = require('./guild');
        
        const [rows] = await db.execute('SELECT guild_id FROM guild_settings WHERE global_stats = 1');
        
        const pending = await Promise.all(rows.map(async (row) => {
            const metadata = await fetchGuildMetadata(row.guild_id);
            return {
                id: row.guild_id,
                name: metadata.name,
                icon: metadata.icon
            };
        }));
        
        res.json(pending);
    } catch (error) {
        console.error('Pending global error:', error);
        res.status(500).json({ error: 'Failed to fetch pending requests' });
    }
});

router.post('/api/owner/approve-global', requireBotOwner, async (req, res) => {
    try {
        const db = getDb();
        const { guild_id, approved } = req.body;
        
        if (!guild_id) return res.status(400).json({ error: 'guild_id required' });
        
        const newState = approved ? 2 : 0;
        await db.execute('UPDATE guild_settings SET global_stats = ? WHERE guild_id = ?', [newState, guild_id]);
        
        res.json({ success: true, state: newState });
    } catch (error) {
        console.error('Approve global error:', error);
        res.status(500).json({ error: 'Failed to update approval state' });
    }
});

module.exports = router;
