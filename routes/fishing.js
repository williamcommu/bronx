// Fishing routes: stats and gear CRUD
const express = require('express');
const router = express.Router();

const { getDb } = require('../db');

// ── Fishing Statistics ──────────────────────────────────────────────────

router.get('/api/fishing/stats', async (req, res) => {
    try {
        const db = getDb();
        const [totalFish] = await db.execute('SELECT COUNT(*) as count FROM fish_catches').catch(() => [[{ count: 0 }]]);
        const [valuableFish] = await db.execute('SELECT MAX(value) as max_value FROM fish_catches').catch(() => [[{ max_value: 0 }]]);
        const [legendaryFish] = await db.execute("SELECT COUNT(*) as count FROM fish_catches WHERE rarity = 'legendary'").catch(() => [[{ count: 0 }]]);

        res.json({
            total_caught: totalFish[0]?.count || 0,
            most_valuable: valuableFish[0]?.max_value || 0,
            legendary_count: legendaryFish[0]?.count || 0,
            active_autofishers: 0
        });
    } catch (error) {
        console.error('Fishing stats error:', error);
        res.json({ total_caught: 0, most_valuable: 0, legendary_count: 0, active_autofishers: 0 });
    }
});

// ── Fishing Gear (rods & bait from shop_items) ──────────────────────────

router.get('/api/fishing/gear', async (req, res) => {
    try {
        const db = getDb();
        const [items] = await db.execute(
            "SELECT item_id, name, description, category, price, level, max_quantity FROM shop_items WHERE category IN ('rod','bait') ORDER BY category, level"
        );
        res.json({
            rods: items.filter(i => i.category === 'rod'),
            bait: items.filter(i => i.category === 'bait')
        });
    } catch (error) {
        console.error('Fishing gear error:', error);
        res.status(500).json({ error: 'Failed to fetch fishing gear' });
    }
});

router.post('/api/fishing/gear', async (req, res) => {
    try {
        const db = getDb();
        const { item_id, name, description, category, price, level, max_quantity } = req.body;
        if (!['rod', 'bait'].includes(category)) {
            return res.status(400).json({ error: 'category must be rod or bait' });
        }
        await db.execute(
            'INSERT INTO shop_items (item_id, name, description, category, price, level, max_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [item_id, name, description || '', category, price, level || 1, max_quantity || 1]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Fishing gear create error:', error);
        res.status(500).json({ error: 'Failed to create gear item' });
    }
});

router.put('/api/fishing/gear/:item_id', async (req, res) => {
    try {
        const db = getDb();
        const { name, description, price, level, max_quantity } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        await db.execute(
            "UPDATE shop_items SET name = ?, description = ?, price = ?, level = ?, max_quantity = ? WHERE item_id = ? AND category IN ('rod','bait')",
            [name, description || '', price, level || 1, max_quantity || 1, req.params.item_id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Fishing gear update error:', error);
        res.status(500).json({ error: 'Failed to update gear item' });
    }
});

router.delete('/api/fishing/gear/:item_id', async (req, res) => {
    try {
        const db = getDb();
        await db.execute(
            "DELETE FROM shop_items WHERE item_id = ? AND category IN ('rod','bait')",
            [req.params.item_id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Fishing gear delete error:', error);
        res.status(500).json({ error: 'Failed to delete gear item' });
    }
});

module.exports = router;
