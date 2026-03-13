// OAuth2 authentication routes: login, callback, logout, user/guild info
const express = require('express');
const axios = require('axios');
const router = express.Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

// ── OAuth2 Helper Functions ─────────────────────────────────────────────

async function getDiscordUser(accessToken) {
    try {
        const response = await axios.get(`${DISCORD_API_BASE}/users/@me`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching Discord user:', error.response?.data || error.message);
        return null;
    }
}

async function getDiscordGuilds(accessToken) {
    try {
        const response = await axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching Discord guilds:', error.response?.data || error.message);
        return [];
    }
}

async function getBotGuilds() {
    try {
        if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'your_actual_bot_token_here') {
            console.warn('⚠️  Bot token not configured. Users will have access to 0 servers.');
            return [];
        }
        const response = await axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Error fetching bot guilds:', error.response?.data || error.message);
        console.warn('⚠️  Bot token may be invalid. Users will have access to 0 servers.');
        return [];
    }
}

function getUserPermissions(userGuild) {
    const permissions = parseInt(userGuild.permissions);
    return {
        isOwner: userGuild.owner || false,
        canManage: (permissions & 0x20) !== 0,
        canAdmin: (permissions & 0x8) !== 0
    };
}

// ── OAuth2 Routes ───────────────────────────────────────────────────────

router.get('/login', (req, res) => {
    const scopes = ['identify', 'guilds'];
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${scopes.join('%20')}`;
    res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).send('Authorization code not provided');
    }
    
    try {
        // Exchange code for access token
        const tokenResponse = await axios.post(`${DISCORD_API_BASE}/oauth2/token`, 
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );
        
        const { access_token } = tokenResponse.data;
        
        // Get user info
        const user = await getDiscordUser(access_token);
        if (!user) {
            return res.status(500).send('Failed to get user information');
        }
        
        // Get user's guilds
        const userGuilds = await getDiscordGuilds(access_token);
        
        // Get bot's guilds
        const botGuilds = await getBotGuilds();
        const botGuildIds = new Set(botGuilds.map(g => g.id));
        
        // Filter guilds where user has management permissions AND bot is present
        const accessibleGuilds = userGuilds.filter(guild => {
            const perms = getUserPermissions(guild);
            return (perms.isOwner || perms.canManage || perms.canAdmin) && botGuildIds.has(guild.id);
        }).map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            permissions: getUserPermissions(guild)
        }));
        
        // Store in session
        req.session.user = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            global_name: user.global_name
        };
        req.session.accessToken = access_token;
        req.session.accessibleGuilds = accessibleGuilds;
        
        console.log(`✓ User ${user.username} authenticated with access to ${accessibleGuilds.length} servers`);
        console.log(`Session ID: ${req.sessionID}, Cookie: ${JSON.stringify(req.session.cookie)}`);
        
        // Redirect to server selection
        res.redirect('/servers');
        
    } catch (error) {
        console.error('OAuth2 callback error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
        }
        res.redirect('/servers');
    });
});

// ── Auth API endpoints ──────────────────────────────────────────────────

router.get('/api/auth/user', (req, res) => {
    console.log(`Auth check - Session ID: ${req.sessionID}, Has user: ${!!req.session.user}`);
    if (!req.session.user) {
        return res.json({ authenticated: false });
    }
    
    const isBotOwner = req.session.user.id === BOT_OWNER_ID;
    
    res.json({
        authenticated: true,
        user: req.session.user,
        guilds: req.session.accessibleGuilds || [],
        isBotOwner
    });
});

router.get('/api/auth/guilds', (req, res) => {
    // requireAuth is applied at the app level for non-public paths
    res.json(req.session.accessibleGuilds || []);
});

module.exports = router;
