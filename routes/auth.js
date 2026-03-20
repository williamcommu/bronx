// OAuth2 authentication routes: login, callback, logout, user/guild info
const express = require('express');
const axios = require('axios');
const router = express.Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

// ── Exponential Backoff Retry Helper ────────────────────────────────────
// Handles transient errors like Cloudflare rate limits (1015, 429)
// Maximum wait time is capped at 60 seconds to prevent hanging forever
async function retryWithExponentialBackoff(fn, maxRetries = 5, initialDelayMs = 1000) {
    const MAX_WAIT_MS = 60 * 1000; // Cap at 60 seconds max
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // Check if error is retryable (rate limit, gateway timeout, temporary network)
            const status = error.response?.status;
            const isRateLimited = status === 429 || error.response?.data?.error_code === 1015;
            const isTemporary = status === 503 || status === 502 || status === 504 || status === 500;
            const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || 
                                   error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH';

            if (!isRateLimited && !isTemporary && !isNetworkError && attempt > 0) {
                // Non-retryable error, throw immediately
                throw error;
            }

            if (attempt === maxRetries - 1) break; // Last attempt, don't delay

            // Calculate exponential backoff: 2s, 4s, 8s, 16s, 32s...
            const backoffMs = initialDelayMs * Math.pow(2, attempt);
            const jitter = Math.random() * backoffMs * 0.1; // Add 10% jitter
            let suggestedDelayMs = backoffMs + jitter;

            // Check for server-suggested delay from headers or response body
            const retryAfterHeader = error.response?.headers?.['retry-after'];
            const retryAfterBody = error.response?.data?.retry_after;
            
            if (retryAfterHeader) {
                // retry-after header is in seconds, but could be very large
                const headerDelaySeconds = parseInt(retryAfterHeader);
                const headerDelayMs = headerDelaySeconds * 1000;
                // Use header value if it's reasonable but never exceed our max
                if (headerDelaySeconds > 0 && headerDelaySeconds <= 60) {
                    suggestedDelayMs = headerDelayMs;
                }
            } else if (retryAfterBody) {
                // Some APIs return retry_after in response body (Cloudflare, etc)
                const bodyDelaySeconds = parseInt(retryAfterBody);
                if (bodyDelaySeconds > 0 && bodyDelaySeconds <= 60) {
                    suggestedDelayMs = bodyDelaySeconds * 1000;
                }
            }

            // Cap the wait time at our maximum to prevent infinite/excessively long waits
            const waitMs = Math.min(suggestedDelayMs, MAX_WAIT_MS);

            console.log(`⚠️  Attempt ${attempt + 1}/${maxRetries} failed (${status || error.code}), ` +
                        `retrying in ${(waitMs / 1000).toFixed(1)}s... ` +
                        `(${error.response?.data?.error_name || error.message})`);

            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
    throw lastError;
}

// Build redirect URI dynamically from the incoming request so it works
// on localhost, Render, and any custom domain without changing .env
function getRedirectUri(req) {
    if (process.env.DISCORD_REDIRECT_URI) {
        return process.env.DISCORD_REDIRECT_URI;
    }
    const protocol = req.protocol;            // respects trust proxy
    const host = req.get('host');             // includes port if non-standard
    return `${protocol}://${host}/callback`;
}

// ── OAuth2 Helper Functions ─────────────────────────────────────────────

async function getDiscordUser(accessToken) {
    try {
        const user = await retryWithExponentialBackoff(
            () => axios.get(`${DISCORD_API_BASE}/users/@me`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
        );
        return user.data;
    } catch (error) {
        console.error('❌ Error fetching Discord user after retries:', error.response?.data || error.message);
        return null;
    }
}

async function getDiscordGuilds(accessToken) {
    try {
        const guilds = await retryWithExponentialBackoff(
            () => axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
        );
        return guilds.data;
    } catch (error) {
        console.error('❌ Error fetching Discord guilds after retries:', error.response?.data || error.message);
        return [];
    }
}

async function getBotGuilds() {
    try {
        if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'your_actual_bot_token_here') {
            console.warn('⚠️  Bot token not configured. Users will have access to 0 servers.');
            return [];
        }
        const botGuilds = await retryWithExponentialBackoff(
            () => axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
            })
        );
        return botGuilds.data;
    } catch (error) {
        console.error('❌ Error fetching bot guilds after retries:', error.response?.data || error.message);
        console.warn('⚠️  Bot token may be invalid or rate limited. Users will have access to 0 servers.');
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
    const redirectUri = getRedirectUri(req);
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes.join('%20')}`;
    res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).send('Authorization code not provided');
    }
    
    try {
        // Exchange code for access token with retry logic
        const redirectUri = getRedirectUri(req);
        const tokenResponse = await retryWithExponentialBackoff(
            () => axios.post(`${DISCORD_API_BASE}/oauth2/token`, 
                new URLSearchParams({
                    client_id: DISCORD_CLIENT_ID,
                    client_secret: DISCORD_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri
                }).toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            )
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
        
        // Include guilds where user has management permissions
        // Mark whether the bot is present in each guild
        const accessibleGuilds = userGuilds.filter(guild => {
            const perms = getUserPermissions(guild);
            return perms.isOwner || perms.canManage || perms.canAdmin;
        }).map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            permissions: getUserPermissions(guild),
            botPresent: botGuildIds.has(guild.id)
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
