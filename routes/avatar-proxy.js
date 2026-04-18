// Avatar & Icon Proxy — streams Discord CDN images through our server
// to avoid cross-site cookie blocking issues with cdn.discordapp.com
const express = require('express');
const axios = require('axios');
const router = express.Router();

const { cache } = require('../cache');

const CDN_BASE = 'https://cdn.discordapp.com';

// Default avatar hashes (Discord's built-in defaults)
const DEFAULT_AVATARS = [0, 1, 2, 3, 4, 5];

/**
 * Proxy a Discord CDN image and cache the result.
 * Returns the image as a stream with proper cache headers.
 */
async function proxyImage(url, res) {
    const cacheKey = cache.key('proxy', 'image', url);
    
    try {
        const cached = await cache.get(cacheKey);
        if (cached) {
            const buffer = Buffer.from(cached.data, 'base64');
            res.set({
                'Content-Type': cached.contentType,
                'Cache-Control': 'public, max-age=86400',
                'X-Cache': 'HIT'
            });
            return res.send(buffer);
        }

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: {
                'User-Agent': 'BronxBot-Dashboard/1.0',
                'Accept': 'image/*'
            },
            validateStatus: (status) => status < 500
        });

        if (response.status === 404 || response.status === 403) {
            return sendFallback(res);
        }

        const contentType = response.headers['content-type'] || 'image/png';
        const buffer = Buffer.from(response.data);

        // Cache the image for 24 hours
        await cache.set(cacheKey, {
            contentType,
            data: buffer.toString('base64')
        }, 86400);

        res.set({
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600, s-maxage=7200',
            'X-Proxy-Source': 'discord-cdn',
            'X-Cache': 'MISS'
        });
        return res.send(buffer);
    } catch (err) {
        console.warn('[avatar-proxy] Failed to proxy image:', url, err.message);
        return sendFallback(res);
    }
}

/**
 * Send a 1x1 transparent PNG as fallback.
 */
function sendFallback(res) {
    // 1x1 transparent PNG
    const pixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
    );
    res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300'
    });
    return res.status(200).send(pixel);
}

// ── User Avatar Proxy ───────────────────────────────────────────────────
// GET /api/proxy/avatar/:userId
// Query params: hash (avatar hash), size (default 64)
router.get('/api/proxy/avatar/:userId', async (req, res) => {
    const { userId } = req.params;
    const { hash, size = '64' } = req.query;

    if (!userId || !/^\d{17,20}$/.test(userId)) {
        return sendFallback(res);
    }

    // Default avatar URL based on user ID (used as fallback)
    const defaultIndex = Number((BigInt(userId) >> 22n) % 6n);
    const defaultUrl = `${CDN_BASE}/embed/avatars/${defaultIndex}.png`;

    if (hash) {
        const ext = hash.startsWith('a_') ? 'gif' : 'png';
        const url = `${CDN_BASE}/avatars/${userId}/${hash}.${ext}?size=${size}`;

        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 8000,
                headers: {
                    'User-Agent': 'BronxBot-Dashboard/1.0',
                    'Accept': 'image/*'
                },
                validateStatus: (status) => status < 500
            });

            if (response.status !== 404 && response.status !== 403) {
                const contentType = response.headers['content-type'] || 'image/png';
                res.set({
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=3600, s-maxage=7200',
                    'X-Proxy-Source': 'discord-cdn'
                });
                return res.send(Buffer.from(response.data));
            }
            // Hash was stale — fall through to default avatar
        } catch (err) {
            console.warn('[avatar-proxy] Hash lookup failed, using default:', err.message);
            // Network error — fall through to default avatar
        }
    }

    // No hash provided, or hash was stale/failed — serve default avatar
    return proxyImage(defaultUrl, res);
});

// ── Guild Icon Proxy ────────────────────────────────────────────────────
// GET /api/proxy/icon/:guildId
// Query params: hash (icon hash), size (default 64)
router.get('/api/proxy/icon/:guildId', async (req, res) => {
    const { guildId } = req.params;
    const { hash, size = '64' } = req.query;

    if (!guildId || !/^\d{17,20}$/.test(guildId)) {
        return sendFallback(res);
    }

    if (!hash) {
        return sendFallback(res);
    }

    const ext = hash.startsWith('a_') ? 'gif' : 'png';
    const url = `${CDN_BASE}/icons/${guildId}/${hash}.${ext}?size=${size}`;
    return proxyImage(url, res);
});

// ── Default Avatar ──────────────────────────────────────────────────────
// GET /api/proxy/avatar-default/:index
router.get('/api/proxy/avatar-default/:index', async (req, res) => {
    const index = parseInt(req.params.index) || 0;
    const safeIndex = Math.min(Math.max(index, 0), 5);
    const url = `${CDN_BASE}/embed/avatars/${safeIndex}.png`;
    return proxyImage(url, res);
});

module.exports = router;
