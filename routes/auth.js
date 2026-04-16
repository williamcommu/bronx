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
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 10000  // 10 second timeout per request
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
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 10000  // 10 second timeout per request
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
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
                timeout: 10000  // 10 second timeout per request
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

// ── Request Deduplication ──────────────────────────────────────────────
// Prevent duplicate token exchanges for the same authorization code
const pendingCodeExchanges = new Map();

function getPendingExchange(code) {
    return pendingCodeExchanges.get(code);
}

function setPendingExchange(code, promise) {
    pendingCodeExchanges.set(code, promise);
    // Clean up after 5 minutes to prevent memory leak
    setTimeout(() => pendingCodeExchanges.delete(code), 5 * 60 * 1000);
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
    
    // Check if this code is already being exchanged
    const existing = getPendingExchange(code);
    if (existing) {
        console.log(`⏳ Reusing pending exchange for code ${code.substring(0, 8)}...`);
        try {
            await existing;
            // Note: This is a race condition if the first request is still writing the session.
            // In production, share the session data via Redis instead.
            return res.redirect('/servers');
        } catch (error) {
            return res.status(500).send('Authentication temporarily unavailable');
        }
    }
    
    // Set a 20-second timeout for the entire OAuth flow to prevent infinite loading
    const timeoutId = setTimeout(() => {
        if (!res.headersSent) {
            res.status(504).send(
                `<html><head><title>Authorization Timeout</title></head><body>
                <h1>Authorization Timeout</h1>
                <p>The Discord authorization took too long to complete.</p>
                <p>This usually means Discord or your network is experiencing issues.</p>
                <p><a href="/landing">Try again</a></p>
                </body></html>`
            );
        }
    }, 20000); // 20 seconds max
    
    // Create a promise for this exchange and store it
    const exchangePromise = (async () => {
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
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 10000  // 10 second timeout per request
                    }
                ),
                3, // Reduce retries from 5 to 3 for faster failure
                1000 // Keep initial delay at 1 second
            );
            
            const { access_token } = tokenResponse.data;
            
            // Get user info
            const user = await getDiscordUser(access_token);
            if (!user) {
                throw new Error('Failed to get user information');
            }
            
            // Get user's guilds
            const userGuilds = await getDiscordGuilds(access_token);
            
            // Include guilds where user has management permissions
            // Fetch bot guilds asynchronously (don't block callback response)
            const accessibleGuilds = userGuilds.filter(guild => {
                const perms = getUserPermissions(guild);
                return perms.isOwner || perms.canManage || perms.canAdmin;
            }).map(guild => ({
                id: guild.id,
                name: guild.name,
                icon: guild.icon,
                permissions: getUserPermissions(guild),
                botPresent: false  // Default to false, will update asynchronously
            }));
            
            // Fetch bot guilds asynchronously (non-blocking)
            // This prevents timeout on production if bot token is slow
            getBotGuilds().then(botGuilds => {
                const botGuildIds = new Set(botGuilds.map(g => g.id));
                // Update bot presence in session guilds
                for (const guild of accessibleGuilds) {
                    guild.botPresent = botGuildIds.has(guild.id);
                }
                // Store updated guilds back to session
                if (req.session) {
                    req.session.accessibleGuilds = accessibleGuilds;
                }
                console.log(`✓ Bot guilds updated for user ${user.id}`);
            }).catch(err => {
                console.warn(`⚠️  Failed to fetch bot guilds asynchronously for user ${user.id}: ${err.message}`);
                // User can still log in even if we can't fetch bot guild list
            });
            
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
            console.log(`Session ID: ${req.sessionID}`);
            
            return { success: true, accessibleGuilds };
        } catch (error) {
            throw error;
        }
    })();
    
    setPendingExchange(code, exchangePromise);
    
    try {
        await exchangePromise;
        clearTimeout(timeoutId); // Clear timeout on success
        res.redirect('/servers');
    } catch (error) {
        clearTimeout(timeoutId); // Clear timeout on error
        console.error('❌ OAuth2 callback error:', error.response?.data || error.message);
        
        // Send error response instead of hanging
        const errorData = error.response?.data;
        const status = error.response?.status || 500;
        const errorMsg = errorData?.error_description || errorData?.error_name || error.message;
        
        if (status === 429 || errorData?.error_code === 1015) {
            // Rate limited - suggest user wait and retry
            return res.status(429).send(
                `<html><head><title>Rate Limited</title></head><body>
                <h1>Authorization Rate Limited</h1>
                <p>Discord is temporarily rate limiting authorization requests.</p>
                <p>Please wait 1-2 minutes and <a href="/landing">try again</a>.</p>
                <p><small>Error: ${errorMsg}</small></p>
                </body></html>`
            );
        }
        
        res.status(status).send(
            `<html><head><title>Authorization Failed</title></head><body>
            <h1>Authorization Failed</h1>
            <p>Error: ${errorMsg}</p>
            <p><a href="/landing">Try again</a></p>
            </body></html>`
        );
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
