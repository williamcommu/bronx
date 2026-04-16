// OAuth2 authentication routes: login, callback, logout, user/guild info
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { cache } = require('../cache');

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

// Universal Discord API Proxy: If set, routes all traffic through a Cloudflare Worker
const DISCORD_OAUTH_PROXY = process.env.DISCORD_OAUTH_PROXY ? process.env.DISCORD_OAUTH_PROXY.replace(/\/$/, '') : null;
const DISCORD_API_BASE = DISCORD_OAUTH_PROXY || 'https://discord.com/api/v10';

console.log('🛡️ [Env Check] DISCORD_OAUTH_PROXY status:', DISCORD_OAUTH_PROXY ? '✅ SET' : '❌ MISSING');
if (DISCORD_OAUTH_PROXY) console.log('🛡️ [Env Check] Universal Proxy Active:', DISCORD_OAUTH_PROXY);

const TOKEN_EXCHANGE_URL = `${DISCORD_API_BASE}/oauth2/token`;

// ── Exponential Backoff Retry Helper ────────────────────────────────────
// Handles transient errors like Cloudflare rate limits (1015, 429)
// If server demands a long wait (>30s), bails out immediately via circuit breaker
async function retryWithExponentialBackoff(fn, maxRetries = 5, initialDelayMs = 1000) {
    const MAX_WAIT_MS = 60 * 1000; // Cap at 60 seconds max
    const BAIL_THRESHOLD_MS = 30 * 1000; // If server wants >30s, bail out immediately
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            const isRateLimited = status === 429 || error.response?.data?.error_code === 1015;
            const isTemporary = status === 503 || status === 502 || status === 504 || status === 500;
            const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || 
                                   error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH';

            if (!isRateLimited && !isTemporary && !isNetworkError && attempt > 0) {
                throw error;
            }

            if (attempt === maxRetries - 1) break;

            const backoffMs = initialDelayMs * Math.pow(2, attempt);
            const jitter = Math.random() * backoffMs * 0.1;
            
            // Extract wait times from response (Discord, Cloudflare, headers)
            const headers = error.response?.headers || {};
            let data = error.response?.data || {};
            
            if (Array.isArray(data) && data.length > 0) {
                data = data[0];
            }

            // [DEBUG] Log the structure on first attempt
            if (attempt === 0) {
                console.log(`🔍 [DEBUG] 429 Response Info: [Headers: ${Object.keys(headers).join(', ')}] [Body Keys: ${Object.keys(data).join(', ')}]`);
                if (data.retry_after) console.log(`🔍 [DEBUG] Found retry_after in body: ${data.retry_after}`);
            }

            // Fuzzy detection: find any key containing "retry", "wait_", or "reset_after"
            const findWaitValue = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                const keys = Object.keys(obj);
                const waitKey = keys.find(k => {
                    const low = k.toLowerCase();
                    return low.includes('retry') || low.includes('wait_') || low.includes('reset_after');
                });
                return waitKey ? obj[waitKey] : null;
            };

            const suggestedWaitBody = findWaitValue(data);
            const suggestedWaitHeader = findWaitValue(headers);

            let suggestedDelayMs = backoffMs + jitter;
            let reason = 'exponential backoff';

            if (suggestedWaitHeader || suggestedWaitBody) {
                const rawVal = suggestedWaitHeader || suggestedWaitBody;
                const val = parseFloat(rawVal);
                
                if (!isNaN(val) && val > 0) {
                    // Normalize to milliseconds
                    let waitMs = 0;
                    if (val > 1000000) {
                        waitMs = (val * 1000) - Date.now(); // epoch timestamp
                    } else {
                        waitMs = val > 200 ? val : (val * 1000); // ms vs seconds
                    }

                    if (waitMs > 0 && waitMs <= 120000) {
                        suggestedDelayMs = waitMs + 2000; // +2s safety buffer
                        reason = suggestedWaitHeader ? 'header' : 'body';
                        reason = `server ${reason} (${(waitMs / 1000).toFixed(1)}s)`;

                        // Set Global Circuit Breaker in Redis
                        const blockUntil = Date.now() + suggestedDelayMs;
                        try {
                            await cache.set('bronx:oauth:throttled_until', blockUntil, Math.ceil(suggestedDelayMs / 1000));
                            console.log(`🛡️  Circuit Breaker SET: OAuth blocked until ${new Date(blockUntil).toLocaleTimeString()}`);
                        } catch (err) {
                            console.warn('⚠️  Failed to set circuit breaker:', err.message);
                        }

                        // BAIL OUT: If wait > 30s, don't bother retrying — the auth code
                        // will be stale by then anyway. Throw a special error so /callback
                        // can show the user a friendly cooldown page immediately.
                        if (suggestedDelayMs > BAIL_THRESHOLD_MS) {
                            const waitSec = Math.ceil(suggestedDelayMs / 1000);
                            console.log(`🛑  Bail-out: Server wants ${waitSec}s wait (>${BAIL_THRESHOLD_MS/1000}s threshold). Aborting retries.`);
                            const bailError = new Error(`CIRCUIT_BREAKER:${waitSec}`);
                            bailError.isCircuitBreaker = true;
                            bailError.waitSeconds = waitSec;
                            throw bailError;
                        }
                    }
                }
            }

            const waitMs = Math.min(suggestedDelayMs, MAX_WAIT_MS);

            console.log(`⚠️  Attempt ${attempt + 1}/${maxRetries} failed (${status || error.code}). ` +
                        `Waiting ${(waitMs / 1000).toFixed(1)}s (${reason})... ` +
                        `[${data.error_name || data.message || error.message}]`);

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
        const url = `${DISCORD_API_BASE}/users/@me`;
        const user = await retryWithExponentialBackoff(
            () => axios.get(url, {
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
        const url = `${DISCORD_API_BASE}/users/@me/guilds`;
        const guilds = await retryWithExponentialBackoff(
            () => axios.get(url, {
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
    const CACHE_KEY = 'bronxbot:bot:guilds:list';
    
    // Attempt to get from cache first
    try {
        const cached = await cache.get(CACHE_KEY);
        if (cached) {
            console.log('📦 Bot guilds fetched from global cache');
            return cached;
        }
    } catch (err) {
        console.warn('⚠️  Cache read failed for bot guilds:', err.message);
    }

    try {
        if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'your_actual_bot_token_here') {
            console.warn('⚠️  Bot token not configured. Users will have access to 0 servers.');
            return [];
        }
        
        console.log('🌐 Fetching bot guilds from Discord API...');
        const url = `${DISCORD_API_BASE}/users/@me/guilds`;
        const botGuilds = await retryWithExponentialBackoff(
            () => axios.get(url, {
                headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
                timeout: 10000  // 10 second timeout per request
            })
        );
        
        const guildsData = botGuilds.data;
        
        // Cache the result for 10 minutes
        try {
            await cache.set(CACHE_KEY, guildsData, 600);
            console.log('✅ Bot guilds list cached (TTL: 600s)');
        } catch (err) {
            console.warn('⚠️  Failed to cache bot guilds list:', err.message);
        }
        
        return guildsData;
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

    // [NEW] Global Circuit Breaker Check
    try {
        const throttledUntil = await cache.get('bronx:oauth:throttled_until');
        if (throttledUntil) {
            const waitSeconds = Math.ceil((parseInt(throttledUntil) - Date.now()) / 1000);
            if (waitSeconds > 0) {
                console.log(`🛡️  Circuit Breaker Tripped: Rejecting OAuth attempt for all users (Discord cooldown active for ${waitSeconds}s)`);
                return res.status(429).send(`
                    <!DOCTYPE html>
                    <html><head><title>Authorization Cooldown</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { background: #0d0d0d; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                               display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px; }
                        .container { max-width: 480px; }
                        .icon { font-size: 4rem; margin-bottom: 1rem; }
                        h1 { color: #ff6b6b; font-size: 1.8rem; margin-bottom: 0.5rem; }
                        .subtitle { color: #aaa; font-size: 1.1rem; margin-bottom: 1.5rem; line-height: 1.5; }
                        .countdown { font-size: 3rem; font-weight: bold; color: #5865F2; margin: 1rem 0;
                                     font-variant-numeric: tabular-nums; }
                        .countdown span { color: #888; font-size: 1rem; font-weight: normal; }
                        .retry-btn { display: inline-block; margin-top: 1.5rem; padding: 14px 32px; background: #5865F2;
                                     color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem;
                                     font-weight: 600; text-decoration: none; transition: all 0.2s; }
                        .retry-btn:hover { background: #4752c4; transform: translateY(-1px); }
                        .retry-btn:disabled { background: #333; cursor: not-allowed; transform: none; }
                        .hint { margin-top: 1rem; color: #666; font-size: 0.85rem; }
                    </style>
                    </head><body>
                    <div class="container">
                        <div class="icon">🛡️</div>
                        <h1>Authorization Cooldown</h1>
                        <p class="subtitle">Discord is rate-limiting login requests from our server.<br>
                        The system is cooling down to protect service quality.</p>
                        <div class="countdown" id="timer">${waitSeconds}<span>s</span></div>
                        <button class="retry-btn" id="retryBtn" disabled onclick="window.location.href='/landing'">Please Wait...</button>
                        <p class="hint">This is temporary. The countdown will enable the retry button automatically.</p>
                    </div>
                    <script>
                        let remaining = ${waitSeconds};
                        const timer = document.getElementById('timer');
                        const btn = document.getElementById('retryBtn');
                        const interval = setInterval(() => {
                            remaining--;
                            timer.innerHTML = remaining + '<span>s</span>';
                            if (remaining <= 0) {
                                clearInterval(interval);
                                timer.innerHTML = '0<span>s</span>';
                                btn.disabled = false;
                                btn.textContent = 'Retry Login';
                                btn.style.background = '#5865F2';
                            }
                        }, 1000);
                    </script>
                    </body></html>
                `);
            }
        }
    } catch (err) {
        console.warn('⚠️  Circuit Breaker Check Failed:', err.message);
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
    
    // Set a 90-second timeout for the entire OAuth flow to prevent infinite loading
    const timeoutId = setTimeout(() => {
        if (!res.headersSent) {
            res.status(504).send(
                `<html><head><title>Authorization Timeout</title></head><body>
                <h1>Authorization Timeout</h1>
                <p>The Discord authorization took too long to complete.</p>
                <p>This usually happens when Discord is rate-limiting the login request.</p>
                <p>The system is still retrying in the background. Please wait a moment and <a href="/landing">refresh</a>.</p>
                </body></html>`
            );
        }
    }, 90000); // 90 seconds max
    
    // Create a promise for this exchange and store it
    const exchangePromise = (async () => {
        try {
            // Exchange code for access token with retry logic
            const redirectUri = getRedirectUri(req);
            console.log(`🔑 Token exchange via: ${DISCORD_OAUTH_PROXY ? 'PROXY' : 'DIRECT'} → ${TOKEN_EXCHANGE_URL}`);
            const tokenResponse = await retryWithExponentialBackoff(
                () => axios.post(TOKEN_EXCHANGE_URL, 
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
                5, // Increased retries from 3 back to 5 for better resilience
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
            if (!userGuilds || userGuilds.length === 0) {
                console.warn('⚠️  No guilds returned for user:', user.username);
            }
            
            // Get bot's guilds (using cache)
            const botGuilds = await getBotGuilds();
            const botGuildIds = new Set(botGuilds.map(g => g.id));
            
            // Include guilds where user has management permissions
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
            console.log(`Session ID: ${req.sessionID}`);
            
            return { success: true, accessibleGuilds };
        } catch (error) {
            throw error;
        }
    })();
    
    setPendingExchange(code, exchangePromise);
    
    try {
        await exchangePromise;
        clearTimeout(timeoutId);
        if (!res.headersSent) res.redirect('/servers');
    } catch (error) {
        clearTimeout(timeoutId);
        
        // Guard: if the 90s timeout already sent a response, log and bail
        if (res.headersSent) {
            console.warn('⚠️  Response already sent (timeout fired). Swallowing error:', error.message);
            return;
        }
        
        // Circuit Breaker bail-out: show cooldown page immediately
        if (error.isCircuitBreaker) {
            const waitSec = error.waitSeconds || 60;
            console.log(`🛡️  Serving cooldown page to user (${waitSec}s wait)`);
            return res.status(429).send(`
                <!DOCTYPE html>
                <html><head><title>Authorization Cooldown</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { background: #0d0d0d; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                           display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px; }
                    .container { max-width: 480px; }
                    .icon { font-size: 4rem; margin-bottom: 1rem; }
                    h1 { color: #ff6b6b; font-size: 1.8rem; margin-bottom: 0.5rem; }
                    .subtitle { color: #aaa; font-size: 1.1rem; margin-bottom: 1.5rem; line-height: 1.5; }
                    .countdown { font-size: 3rem; font-weight: bold; color: #5865F2; margin: 1rem 0;
                                 font-variant-numeric: tabular-nums; }
                    .countdown span { color: #888; font-size: 1rem; font-weight: normal; }
                    .retry-btn { display: inline-block; margin-top: 1.5rem; padding: 14px 32px; background: #5865F2;
                                 color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem;
                                 font-weight: 600; text-decoration: none; transition: all 0.2s; }
                    .retry-btn:hover { background: #4752c4; transform: translateY(-1px); }
                    .retry-btn:disabled { background: #333; cursor: not-allowed; transform: none; }
                    .hint { margin-top: 1rem; color: #666; font-size: 0.85rem; }
                </style>
                </head><body>
                <div class="container">
                    <div class="icon">🛡️</div>
                    <h1>Authorization Cooldown</h1>
                    <p class="subtitle">Discord is rate-limiting login requests from our server.<br>
                    The system is cooling down to protect service quality.</p>
                    <div class="countdown" id="timer">${waitSec}<span>s</span></div>
                    <button class="retry-btn" id="retryBtn" disabled onclick="window.location.href='/landing'">Please Wait...</button>
                    <p class="hint">This is temporary. The countdown will enable the retry button automatically.</p>
                </div>
                <script>
                    let remaining = ${waitSec};
                    const timer = document.getElementById('timer');
                    const btn = document.getElementById('retryBtn');
                    const interval = setInterval(() => {
                        remaining--;
                        timer.innerHTML = remaining + '<span>s</span>';
                        if (remaining <= 0) {
                            clearInterval(interval);
                            timer.innerHTML = '0<span>s</span>';
                            btn.disabled = false;
                            btn.textContent = 'Retry Login';
                            btn.style.background = '#5865F2';
                        }
                    }, 1000);
                </script>
                </body></html>
            `);
        }

        console.error('❌ OAuth2 callback error:', error.response?.data || error.message);
        
        const errorData = error.response?.data;
        const status = error.response?.status || 500;
        const errorMsg = errorData?.error_description || errorData?.error_name || error.message;
        
        if (status === 429 || errorData?.error_code === 1015) {
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
