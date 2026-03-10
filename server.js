// Dashboard API Server - Node.js/Express backend for the web dashboard
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;

// Discord OAuth2 Configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const DISCORD_API_BASE = 'https://discord.com/api/v10';

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    console.warn('⚠️  Discord OAuth2 not configured properly.');
    console.warn('📝 Required: Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env file');
    console.warn('🔗 Your OAuth URL: https://discord.com/oauth2/authorize?client_id=828380019406929962&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=guilds+identify');
}

// Middleware
app.set('trust proxy', 1); // Trust first proxy (required for Render)
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// Session middleware for OAuth2
app.use(session({
    secret: process.env.SESSION_SECRET || 'bronx-bot-dashboard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Database configuration - will be loaded in initDatabase()
let dbConfig;

let db;

// Initialize database connection
async function initDatabase() {
    try {
        // Load database config from file or use defaults
        try {
            const configFile = await fs.readFile(path.join(__dirname, '../data/db_config.json'), 'utf8');
            const config = JSON.parse(configFile);
            dbConfig = {
                host: process.env.DB_HOST || config.host || 'localhost',
                port: parseInt(process.env.DB_PORT || config.port || '3306'),
                user: process.env.DB_USER || config.user || 'bronxbot',
                password: process.env.DB_PASSWORD || config.password || 'bronx2026_secure',
                database: process.env.DB_NAME || config.database || 'bronxbot',
                charset: 'utf8mb4'
            };
            console.log('Loaded database config from db_config.json');
        } catch (error) {
            console.log('Could not load db_config.json, using fallback defaults');
            dbConfig = {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '3306'),
                user: process.env.DB_USER || 'bronxbot',
                password: process.env.DB_PASSWORD || 'bronx2026_secure',
                database: process.env.DB_NAME || 'bronxbot',
                charset: 'utf8mb4'
            };
        }
        
        db = mysql.createPool({
            ...dbConfig,
            ssl: { rejectUnauthorized: false },
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 30000
        });
        // Verify connection
        await db.execute('SELECT 1');
        console.log('Connected to MariaDB database (pool)');

        // Keep-alive ping to prevent Aiven from powering off due to inactivity
        setInterval(async () => {
            try {
                await db.execute('SELECT 1');
                console.log('[Keep-alive] Database ping successful');
            } catch (err) {
                console.error('[Keep-alive] Database ping failed:', err.message);
            }
        }, 45000); // Ping every 45 seconds

        // Auto-create dashboard-specific tables if missing
        await db.execute(`CREATE TABLE IF NOT EXISTS command_scope_rules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            guild_id VARCHAR(32) NOT NULL,
            command_name VARCHAR(64) NOT NULL,
            scope_type ENUM('allow','deny') NOT NULL DEFAULT 'allow',
            target_type ENUM('channel','role','user') NOT NULL DEFAULT 'channel',
            target_id VARCHAR(32) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_guild (guild_id)
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_module_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            guild_id VARCHAR(32) NOT NULL,
            module VARCHAR(32) NOT NULL,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            UNIQUE KEY uq_guild_module (guild_id, module)
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_command_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            guild_id VARCHAR(32) NOT NULL,
            command VARCHAR(64) NOT NULL,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            UNIQUE KEY uq_guild_cmd (guild_id, command)
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_balances (
            guild_id VARCHAR(32) PRIMARY KEY,
            treasury BIGINT NOT NULL DEFAULT 0,
            total_donated BIGINT NOT NULL DEFAULT 0,
            total_given BIGINT NOT NULL DEFAULT 0
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS ml_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            \`key\` VARCHAR(64) NOT NULL UNIQUE,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS global_blacklist (
            user_id VARCHAR(32) PRIMARY KEY,
            reason TEXT DEFAULT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS global_whitelist (
            user_id VARCHAR(32) PRIMARY KEY,
            reason TEXT DEFAULT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS daily_deals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            guild_id VARCHAR(32) NOT NULL,
            item_id VARCHAR(64) NOT NULL,
            discount INT NOT NULL DEFAULT 10,
            stock INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS giveaways (
            id INT AUTO_INCREMENT PRIMARY KEY,
            guild_id VARCHAR(32) NOT NULL,
            channel_id VARCHAR(32) NOT NULL,
            prize BIGINT NOT NULL,
            max_winners INT NOT NULL DEFAULT 1,
            ends_at TIMESTAMP NOT NULL,
            ended TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_guild_active (guild_id, ended)
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS giveaway_entries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            giveaway_id INT NOT NULL,
            user_id VARCHAR(32) NOT NULL,
            UNIQUE KEY uq_entry (giveaway_id, user_id)
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS command_stats (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            guild_id VARCHAR(32) NOT NULL DEFAULT 'global',
            command_name VARCHAR(64) NOT NULL,
            used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_guild_used (guild_id, used_at),
            INDEX idx_user (user_id)
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS fish_catches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            guild_id VARCHAR(32) NOT NULL DEFAULT 'global',
            fish_name VARCHAR(64) DEFAULT NULL,
            caught_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_guild_caught (guild_id, caught_at)
        )`);

        // Migrations: add reason column to blacklist/whitelist if missing
        try {
            await db.execute('ALTER TABLE global_blacklist ADD COLUMN reason TEXT DEFAULT NULL');
        } catch (e) { /* column already exists */ }
        try {
            await db.execute('ALTER TABLE global_whitelist ADD COLUMN reason TEXT DEFAULT NULL');
        } catch (e) { /* column already exists */ }
        // Migrations: add guild_id column to command_stats / fish_catches if missing
        try {
            await db.execute("ALTER TABLE command_stats ADD COLUMN guild_id VARCHAR(32) NOT NULL DEFAULT 'global'");
        } catch (e) { /* column already exists */ }
        try {
            await db.execute("ALTER TABLE fish_catches ADD COLUMN guild_id VARCHAR(32) NOT NULL DEFAULT 'global'");
        } catch (e) { /* column already exists */ }

        console.log('Dashboard tables verified/created');
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
}

// Middleware to add guild context
app.use((req, res, next) => {
    const headerGuildId = req.headers['x-guild-id'];
    req.guildId = (headerGuildId && headerGuildId !== 'null' && headerGuildId !== 'undefined') 
        ? headerGuildId 
        : 'global';
    next();
});

// Serve dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// OAuth2 Helper Functions
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
        canManage: (permissions & 0x20) !== 0, // MANAGE_GUILD permission
        canAdmin: (permissions & 0x8) !== 0    // ADMINISTRATOR permission
    };
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

function requireGuildAccess(req, res, next) {
    const guildId = req.params.guildId || req.body.guildId || req.query.guildId;
    
    if (!guildId) {
        return res.status(400).json({ error: 'Guild ID required' });
    }
    
    if (!req.session.user || !req.session.accessibleGuilds) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const hasAccess = req.session.accessibleGuilds.some(guild => guild.id === guildId);
    if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this server' });
    }
    
    req.guildId = guildId;
    next();
}

// OAuth2 Routes
app.get('/login', (req, res) => {
    const scopes = ['identify', 'guilds'];
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${scopes.join('%20')}`;
    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
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
        
        // Redirect to dashboard
        res.redirect('/?login=success');
        
    } catch (error) {
        console.error('OAuth2 callback error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
        }
        res.redirect('/');
    });
});

// Auth API endpoints
app.get('/api/auth/user', (req, res) => {
    console.log(`Auth check - Session ID: ${req.sessionID}, Has user: ${!!req.session.user}`);
    if (!req.session.user) {
        return res.json({ authenticated: false });
    }
    
    res.json({
        authenticated: true,
        user: req.session.user,
        guilds: req.session.accessibleGuilds || []
    });
});

app.get('/api/auth/guilds', requireAuth, (req, res) => {
    res.json(req.session.accessibleGuilds || []);
});

// Serve guide page
app.get('/guide', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide.html'));
});

// Guide API - serves guide content as JSON
app.get('/api/guide', (req, res) => {
    // Guide data embedded inline (mirrors guide_data.h)
    const guideData = {
        sections: [
            {
                name: "getting started",
                emoji: "🚀",
                description: "bot basics — commands, economy, first steps",
                admin_only: false,
                pages: [
                    {
                        title: "welcome to bronx",
                        content: "bronx is a multipurpose discord bot focused on economy, progression systems, and community engagement — it combines idle/active income with skill trees, crafting, pets, and competitive leaderboards to create long-term engagement for your server.\n\nyou can use either **text commands** (`.command`) or **slash commands** (`/command`) — both work identically, so pick whichever feels natural.\n\nthe core loop is simple: earn coins → spend/invest → level up → unlock new systems → earn more efficiently. everything connects: fishing gives crafting materials, crafting boosts passive income, passive income funds gambling, gambling funds skill trees, skill trees boost everything."
                    },
                    {
                        title: "your first steps",
                        content: "1. run `.bal` or `/balance` — this creates your account and shows your starting coins\n2. run `.daily` — free daily coins, builds a streak for bonus rewards\n3. try `.fish` or `.mine` — basic activities that earn coins and materials\n4. check `.help` — browse all available commands by category\n5. run `.profile` — see your stats, level, and progression\n\nas you use commands you gain xp passively — leveling up unlocks new features and shows your dedication on leaderboards."
                    }
                ]
            },
            {
                name: "economy",
                emoji: "💰",
                description: "wallet, bank, transactions, earning",
                admin_only: false,
                pages: [
                    {
                        title: "the dual-balance system",
                        content: "your money exists in two places:\n\n**wallet** — liquid cash, used for purchases and gambling, but vulnerable to robbery if you're not careful\n**bank** — protected savings, earns interest over time, but has a capacity limit that grows as you level up\n\nuse `.dep <amount>` to deposit and `.with <amount>` to withdraw — keep a balance between risk and safety."
                    },
                    {
                        title: "earning methods overview",
                        content: "**active income:**\n- `.work` — guaranteed coins on cooldown\n- `.fish` / `.mine` — rng-based but can yield rare catches worth substantially more\n- `.daily` / `.weekly` — streak-based free claims\n- `.vote` — external voting rewards\n\n**passive income:**\n- bank interest (automatic over time)\n- investments (see passive income guide section)\n- pets generating coins while you're away\n- server events and world bosses\n\n**high-risk income:**\n- gambling games (coinflip, blackjack, slots, etc.)\n- trading rare items with other users"
                    }
                ]
            },
            {
                name: "fishing",
                emoji: "🎣",
                description: "catching fish, rods, bait, rare catches",
                admin_only: false,
                pages: [
                    {
                        title: "fishing basics",
                        content: "`.fish` casts your line and catches something — fish vary from common (low value) to legendary (extremely valuable and rare). your catch depends on your rod quality, bait type, and pure luck.\n\nfish can be:\n- **sold** for coins (`.sell fish <name>` or `.sellall fish`)\n- **used in crafting** recipes\n- **collected** for achievements\n\nrare fish like golden koi, ancient coelacanth, or the mythic leviathan are worth pursuing — they're both prestigious and valuable."
                    },
                    {
                        title: "rods and bait",
                        content: "**rods** — better rods increase catch quality and rare chance:\n- basic rod: starting equipment\n- fiberglass rod: slight quality boost\n- carbon rod: noticeable rare boost\n- titanium rod: high-tier, consistent good catches\n- quantum rod: top tier, designed for legendary hunting\n\n**bait** — consumable items that modify catches:\n- basic bait: no modifier\n- premium bait: +chance for uncommon+\n- exotic bait: +chance for rare+\n- legendary lure: significantly boosted legendary odds\n\nbuy gear from `.shop`, equip with `.equip <item>`."
                    },
                    {
                        title: "fishing strategy",
                        content: "efficient fishing means managing cooldowns and maximizing value:\n\n1. always use the best rod you can afford\n2. save legendary lures for when you can fish actively\n3. bulk sell common fish, keep rares for crafting checks\n4. watch for fishing events — they boost rare spawn rates temporarily\n5. track your catches in `.fishlog` for collection completion\n\nlegendary fish are rare but farmable with patience — don't burn out grinding for them."
                    }
                ]
            },
            {
                name: "mining",
                emoji: "⛏️",
                description: "ores, pickaxes, crafting materials",
                admin_only: false,
                pages: [
                    {
                        title: "mining overview",
                        content: "`.mine` extracts ores and gems from the depths — like fishing, quality varies from common stone to legendary gems. mining yields are used for crafting equipment, selling for coins, or collecting.\n\nore tiers: stone < coal < iron < gold < diamond < ancient < void\n\nmining uses pickaxe durability — better picks last longer and yield better finds. manage your tools or you'll be stuck with basic returns."
                    },
                    {
                        title: "pickaxes and upgrades",
                        content: "**pickaxes** — affect yield quality and durability:\n- wooden pick: breaks fast, low yields\n- stone pick: standard starting pick\n- iron pick: durable, moderate yields\n- diamond pick: long-lasting, good rare chance\n- void pick: top-tier, exceptional everything\n\npickaxes degrade with use — repair them at the shop or craft replacements. running a void pick into the ground is painful.\n\n**tip:** keep a backup pickaxe. being stuck mining with sticks is inefficient."
                    }
                ]
            },
            {
                name: "gambling",
                emoji: "🎰",
                description: "coinflip, blackjack, slots, risk/reward",
                admin_only: false,
                pages: [
                    {
                        title: "gambling games",
                        content: "gambling is high-risk, high-reward — you can double up or lose everything. games include:\n\n**coinflip** — 50/50, double or nothing\n**blackjack** — beat the dealer, 1.5x on blackjack\n**slots** — spin for multipliers, jackpots exist\n**dice** — roll against house, odds vary\n**roulette** — classic casino rules\n**crash** — multiplier rises until crash, cash out in time\n\neach game has slightly different odds and skill elements — blackjack rewards strategy while slots are pure rng."
                    },
                    {
                        title: "gambling responsibly",
                        content: "gambling can wipe your balance fast. smart strategies:\n\n1. **set a loss limit** — stop after losing X coins, no exceptions\n2. **bet small** — 1-5% of your total per bet unless going for yolo plays\n3. **understand odds** — coinflip is 50%, blackjack favors skill, slots favor the house\n4. **walk away on wins** — quit while ahead, don't chase round numbers\n5. **use gambling for fun** — reliable income comes from fishing/mining/passive\n\nthe casino always wins long-term. short-term variance can go either way."
                    }
                ]
            },
            {
                name: "crafting",
                emoji: "🔨",
                description: "recipes, materials, equipment creation",
                admin_only: false,
                pages: [
                    {
                        title: "crafting system",
                        content: "crafting turns raw materials (fish, ores, drops) into equipment, consumables, and valuable items. run `.craft` to see available recipes and `.craft <item>` to craft.\n\nrecipes require specific materials — check what you need with `.recipe <item>`. some recipes are locked behind level requirements or skill tree unlocks.\n\ncrafted gear is often better than shop gear and can be sold to other players for profit."
                    },
                    {
                        title: "crafting tips",
                        content: "efficient crafting:\n\n1. **hoard materials early** — don't sell everything, crafting needs stockpiles\n2. **check recipes before selling** — that rare fish might be worth more crafted\n3. **level up crafting** — higher crafting levels unlock better recipes\n4. **watch for events** — some events add limited-time recipes\n5. **trade for materials** — sometimes buying mats is cheaper than farming\n\ncrafting connects all systems — fishing and mining feed it, and outputs enhance everything else."
                    }
                ]
            },
            {
                name: "pets",
                emoji: "🐾",
                description: "pet collection, bonuses, passive benefits",
                admin_only: false,
                pages: [
                    {
                        title: "pet system",
                        content: "pets provide passive bonuses while you play. each pet has:\n\n**rarity** — common to legendary, affecting bonus strength\n**type** — determines what bonuses it gives (fishing, mining, luck, income, etc.)\n**level** — pets level up with use, increasing their effectiveness\n\nequip a pet with `.pet equip <name>` — you can have one active pet at a time. view your collection with `.pets`."
                    },
                    {
                        title: "getting and raising pets",
                        content: "obtain pets through:\n- egg drops from activities (fishing, mining, events)\n- shop purchases (basic eggs)\n- event rewards (exclusive pets)\n- crafting (some pets are craftable)\n- trading with other users\n\npets gain xp when you use related commands — a fishing pet levels up when you fish. max-level pets provide significant bonuses.\n\n**tip:** match your pet to your main activity. grinding fishing? use a fishing pet."
                    }
                ]
            },
            {
                name: "skill trees",
                emoji: "🌳",
                description: "permanent upgrades, specialization paths",
                admin_only: false,
                pages: [
                    {
                        title: "skill trees overview",
                        content: "skill trees are permanent progression — spend skill points to unlock passive bonuses that persist forever. skill points are earned through leveling and completing milestones.\n\ntrees include:\n- **economy tree** — better income, bank interest, shop discounts\n- **fishing tree** — rare catch chance, better yields\n- **mining tree** — ore quality, durability\n- **luck tree** — gambling odds, rng improvements\n- **combat tree** — event/boss damage and survival\n\neach tree branches — you can't get everything, so specialize based on your playstyle."
                    },
                    {
                        title: "spending skill points",
                        content: "use `.skills` to view trees and `.skill unlock <skill>` to spend points.\n\nstrategy considerations:\n1. **pick a main focus** — spreading thin gives weak bonuses everywhere\n2. **economy tree is safe** — income boosts help everyone\n3. **activity trees boost mains** — if you fish a lot, fish tree is high value\n4. **luck is gambling-only** — skip if you don't gamble\n5. **respec is expensive** — plan before spending, rerolls cost premium currency\n\nlate-game players often have 2 maxed trees and dabble in a third."
                    }
                ]
            },
            {
                name: "challenges",
                emoji: "📋",
                description: "daily/weekly tasks, bonus rewards",
                admin_only: false,
                pages: [
                    {
                        title: "daily challenges",
                        content: "daily challenges are rotating tasks that award bonus coins and xp. check them with `.challenges` and complete them through normal play.\n\nexamples:\n- catch 10 fish\n- win 3 gambling games\n- deposit 1000 coins\n- use .work 5 times\n\nchallenges reset daily at midnight utc — complete them consistently for steady bonus income. some challenges are harder but worth more."
                    },
                    {
                        title: "weekly and special challenges",
                        content: "**weekly challenges** are larger goals that take several days — bigger rewards but require dedication.\n\n**seasonal challenges** appear during events — limited-time cosmetics and exclusive rewards.\n\n**achievement challenges** are one-time completions — rare badges and permanent bonuses.\n\ntrack all active challenges with `.challenges all` — prioritize limited-time ones before they expire."
                    }
                ]
            },
            {
                name: "passive income",
                emoji: "📈",
                description: "investments, interest, idle earnings",
                admin_only: false,
                pages: [
                    {
                        title: "passive systems",
                        content: "passive income generates coins while you're offline or not actively playing:\n\n**bank interest** — deposited coins slowly grow over time\n**investments** — lock coins for returns after a period\n**pets** — some pets generate coins passively\n**businesses** (if enabled) — purchase generators that produce income\n\npassive income is slower than active grinding but adds up over days and weeks — set it and forget it."
                    },
                    {
                        title: "maximizing passive gains",
                        content: "optimize passive income:\n\n1. **max your bank capacity** — more banked = more interest\n2. **always have investments running** — downtime wastes potential\n3. **equip income pets** — even small bonuses compound\n4. **check in daily** — claim interest, restart investments\n5. **skill tree: economy** — passive income nodes boost all idle earnings\n\nlong-term players often earn more passively than actively — setup matters."
                    }
                ]
            },
            {
                name: "world events",
                emoji: "🌍",
                description: "server-wide bosses, cooperative challenges",
                admin_only: false,
                pages: [
                    {
                        title: "world events",
                        content: "world events are server-wide occurrences that affect everyone:\n\n**bosses** — massive enemies that require collective damage to defeat, rewards based on participation\n**modifiers** — temporary global bonuses (2x fish catch, bonus xp, etc.)\n**invasions** — defend against waves for rewards\n\nevents spawn on timers or randomly — check `.events` to see what's active. participation usually requires just using normal commands while the event is live."
                    },
                    {
                        title: "boss strategy",
                        content: "boss fights reward participation:\n\n- use `.attack` or `.boss hit` to deal damage\n- damage scales with level, gear, and combat skill tree\n- top damage dealers get bonus rewards\n- everyone who participates gets base rewards\n\n**tips:**\n1. always hit bosses when they spawn — free rewards\n2. stack combat skill tree for boss damage\n3. coordinate with server members for fast kills\n4. legendary bosses drop exclusive items"
                    }
                ]
            },
            {
                name: "leveling",
                emoji: "📊",
                description: "xp, levels, rank progression",
                admin_only: false,
                pages: [
                    {
                        title: "xp and leveling",
                        content: "everything you do earns xp — commands, activities, completions. xp fills your level bar; leveling up provides:\n\n- skill points (for skill trees)\n- bank capacity increases\n- unlocks for new features/commands\n- leaderboard ranking\n- cosmetic badges/titles\n\ncheck your progress with `.level` or `.profile`. higher levels require more xp but unlock more powerful systems."
                    },
                    {
                        title: "efficient leveling",
                        content: "maximize xp gain:\n\n1. **complete challenges** — bonus xp on top of normal gains\n2. **use all cooldowns** — work, fish, mine on cooldown = steady xp\n3. **participate in events** — event xp is often boosted\n4. **daily/weekly claims** — free xp for showing up\n5. **xp boost items** — some pets/items multiply xp temporarily\n\nleveling slows down at high levels — prestige systems may reset level for permanent bonuses if enabled."
                    }
                ]
            },
            {
                name: "achievements",
                emoji: "🏆",
                description: "collection, milestones, rare accomplishments",
                admin_only: false,
                pages: [
                    {
                        title: "achievement system",
                        content: "achievements are permanent accomplishments displayed on your profile. they range from easy (catch your first fish) to incredibly difficult (catch all legendary fish).\n\ncomplete achievements for:\n- coins/item rewards\n- exclusive titles\n- profile badges\n- bragging rights\n\nview achievements with `.achievements` — progress tracks automatically. some achievements are hidden until discovered."
                    },
                    {
                        title: "hunting achievements",
                        content: "achievement hunting tips:\n\n1. **check the list** — know what exists before you grind\n2. **focus on natural play** — most achievements complete through normal activity\n3. **save rare items** — some achievements require specific collections\n4. **event achievements** — limited-time, prioritize these\n5. **prestige achievements** — extremely rare, long-term goals\n\ncompletion percentage shows on profile — 100% is a flex."
                    }
                ]
            },
            {
                name: "server setup",
                emoji: "⚙️",
                description: "admin configuration, channels, permissions",
                admin_only: false,
                pages: [
                    {
                        title: "setting up bronx",
                        content: "server admins can configure bronx using `.setup`:\n\n**logging** — set channels for economy logs, moderation actions, level-ups\n**prefix** — change the text command prefix (default: `.`)\n**modules** — enable/disable entire categories (gambling, nsfw, etc.)\n**permissions** — restrict commands to specific roles/channels\n\nmost settings have sane defaults — only configure what you want to customize."
                    },
                    {
                        title: "common configurations",
                        content: "typical server setups:\n\n**casual server:** defaults, maybe restrict gambling to one channel\n**economy server:** logging enabled, leaderboards in dedicated channel\n**strict server:** command restrictions, limited gambling, moderation logging\n\nuse `.setup guide` for interactive configuration. most commands work in any channel unless restricted."
                    }
                ]
            },
            {
                name: "anticheat",
                emoji: "🛡️",
                description: "fair play systems, alt detection",
                admin_only: false,
                pages: [
                    {
                        title: "fair play",
                        content: "bronx includes systems to maintain fair economy:\n\n**alt detection** — accounts that look like alts get flagged and limited\n**transfer limits** — suspicious transfers trigger review\n**bot detection** — automated patterns are detected and actioned\n**leaderboard protection** — inflated stats get filtered\n\nmost users never encounter these — they exist to stop exploitation, not normal play."
                    }
                ]
            },
            {
                name: "advanced tips",
                emoji: "💡",
                description: "optimization, efficiency, meta strategies",
                admin_only: false,
                pages: [
                    {
                        title: "efficiency meta",
                        content: "optimize your bronx gameplay:\n\n**cooldown management** — use alarms/reminders for important cooldowns (daily, investments, etc.)\n**batch operations** — sell all at once instead of individually\n**market awareness** — item values change with events and patches\n**specialize first** — one maxed income source beats three mediocre ones\n**compound gains** — reinvest profits into income boosts, not cosmetics"
                    },
                    {
                        title: "long-term strategy",
                        content: "playing for months/years:\n\n1. **passive income is king** — active grinding burns out, passive scales\n2. **complete collections** — rare achievements take time, start tracking early\n3. **skill trees are permanent** — plan them, don't impulse spend\n4. **join events** — limited-time rewards don't come back\n5. **don't gamble savings** — house always wins long-term\n6. **help your server** — strong servers have better events and more trades\n\nconsistency beats intensity. 10 minutes daily beats 5 hours once a week."
                    }
                ]
            },
            // Admin-only sections
            {
                name: "command management",
                emoji: "🔧",
                description: "admin: module toggles, command restrictions",
                admin_only: true,
                pages: [
                    {
                        title: "module control",
                        content: "disable entire command categories for your server:\n\n`.module disable <module>` — turn off a category (gambling, economy, etc.)\n`.module enable <module>` — re-enable a disabled module\n`.module list` — see all modules and their status\n\navailable modules: economy, gambling, fishing, mining, crafting, leveling, social, utility, moderation\n\ndisabled modules hide all their commands from `.help` and block execution."
                    },
                    {
                        title: "per-command control",
                        content: "restrict individual commands:\n\n`.cmd disable <command>` — disable a single command\n`.cmd enable <command>` — re-enable\n`.cmd restrict <command> <role>` — only allow specified roles\n`.cmd channel <command> <#channel>` — restrict to specific channels\n\nuseful for keeping gambling in one channel or restricting admin commands to staff roles.\n\nall restrictions compound — a command can be both role-restricted and channel-restricted."
                    }
                ]
            },
            {
                name: "economy tuning",
                emoji: "📉",
                description: "admin: payouts, multipliers, inflation control",
                admin_only: true,
                pages: [
                    {
                        title: "economy balance",
                        content: "adjust your server's economy:\n\n`.economy multiplier <value>` — global income multiplier (0.5 = half, 2 = double)\n`.economy startbalance <amount>` — coins new users receive\n`.economy bankinterest <percent>` — bank interest rate\n`.economy dailybonus <amount>` — base daily claim reward\n\n**warning:** increasing multipliers causes inflation — more coins but they're worth less. reduce rewards if your economy feels too easy."
                    },
                    {
                        title: "economy reset tools",
                        content: "emergency economy controls:\n\n`.economy wipe <@user>` — reset a user's balance (useful for exploiters)\n`.economy inspect <@user>` — view detailed transaction history\n`.economy rollback <@user> <hours>` — revert recent transactions\n`.economy freeze <@user>` — temporarily block all economy commands\n\nthese are destructive — use carefully. all actions are logged."
                    }
                ]
            },
            {
                name: "moderation config",
                emoji: "🔐",
                description: "admin: logging, automod, punishment settings",
                admin_only: false,  // Keeping this visible since server setup is also public
                pages: [
                    {
                        title: "moderation logging",
                        content: "set up logging for mod actions:\n\n`.setlog moderation #channel` — log kicks, bans, mutes, warns\n`.setlog economy #channel` — log transactions, suspicious transfers\n`.setlog leveling #channel` — log level-ups, achievements\n`.setlog joins #channel` — log member joins/leaves\n\nlogs include timestamps, moderator responsible, and reasons. essential for audit trails."
                    },
                    {
                        title: "automod basics",
                        content: "configure automatic moderation:\n\n`.automod spam <threshold>` — messages before mute (0 = disabled)\n`.automod links <on/off>` — block non-whitelisted links\n`.automod invites <on/off>` — block discord invite links\n`.automod caps <percent>` — max caps percentage before warning\n\nautomod actions are logged. false positives can be whitelisted. pair with manual moderation for best results."
                    }
                ]
            }
        ]
    };

    res.json(guideData);
});

// API Routes

// Overview Statistics
app.get('/api/stats/overview', async (req, res) => {
    try {
        const guildId = req.guildId;

        // If no guild selected, return empty/zero stats
        if (!guildId || guildId === 'global') {
            return res.json({
                memberCount: 0,
                totalEconomyValue: 0,
                commandsToday: 0,
                fishCaughtToday: 0,
                noServerSelected: true
            });
        }

        // --- Per-guild: real member count from Discord API ---
        let memberCount = null;
        if (process.env.DISCORD_TOKEN) {
            try {
                const guildRes = await axios.get(
                    `${DISCORD_API_BASE}/guilds/${guildId}?with_counts=true`,
                    { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } }
                );
                memberCount = guildRes.data.approximate_member_count ?? guildRes.data.member_count ?? null;
            } catch (e) {
                console.warn('Discord guild member count fetch failed:', e.response?.data || e.message);
            }
        }

        // --- Per-guild stats from server-specific tables ---
        let economyValue = [{ total: 0 }];
        let commandsToday = [{ count: 0 }];
        let fishToday = [{ count: 0 }];

        // Economy — sum wallet + bank from server_users (per-guild balances)
        try {
            const [ev] = await db.execute(
                'SELECT COALESCE(SUM(wallet + bank), 0) as total FROM server_users WHERE guild_id = ?',
                [guildId]
            );
            economyValue = ev;
        } catch (e) { console.warn('economy value query failed:', e.message); }

        // Commands today — from server_command_stats (per-guild)
        try {
            const [guildCmds] = await db.execute(
                'SELECT COUNT(*) as count FROM server_command_stats WHERE guild_id = ? AND used_at >= CURDATE()',
                [guildId]
            );
            commandsToday = guildCmds;
        } catch (e) { console.warn('commands today query failed:', e.message); }

        // Fish caught today — from server_fish_catches (per-guild)
        try {
            const [guildFish] = await db.execute(
                'SELECT COUNT(*) as count FROM server_fish_catches WHERE guild_id = ? AND caught_at >= CURDATE()',
                [guildId]
            );
            fishToday = guildFish;
        } catch (e) { console.warn('fish today query failed:', e.message); }

        res.json({
            memberCount,                                    // from Discord API (this server only)
            totalEconomyValue: economyValue[0].total || 0, // from server_users (per-guild)
            commandsToday: commandsToday[0].count,         // from server_command_stats (per-guild)
            fishCaughtToday: fishToday[0].count            // from server_fish_catches (per-guild)
        });
    } catch (error) {
        console.error('Overview stats error:', error);
        res.status(500).json({ error: 'Failed to fetch overview stats' });
    }
});

// Recent Activity
app.get('/api/stats/recent-activity', async (req, res) => {
    try {
        const guildId = req.guildId;

        // If no guild selected, return empty activity
        if (!guildId || guildId === 'global') {
            return res.json([]);
        }

        let commandActivity = [];
        let fishActivity = [];

        // Try guild-scoped first; fall back to global (all guilds) if empty
        try {
            [commandActivity] = await db.execute(`
                SELECT 'terminal' as icon,
                       CONCAT('Command used: ', command_name) as description,
                       used_at as time
                FROM command_stats
                WHERE guild_id = ? AND used_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                ORDER BY used_at DESC
                LIMIT 3
            `, [guildId]);

            if (commandActivity.length === 0) {
                [commandActivity] = await db.execute(`
                    SELECT 'terminal' as icon,
                           CONCAT('Command used: ', command_name) as description,
                           used_at as time
                    FROM command_stats
                    WHERE used_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                    ORDER BY used_at DESC
                    LIMIT 3
                `);
            }
        } catch (e) { console.warn('command activity query failed:', e.message); }

        try {
            [fishActivity] = await db.execute(`
                SELECT 'fish' as icon,
                       CONCAT('Fish caught: ', COALESCE(fish_name, 'Unknown')) as description,
                       caught_at as time
                FROM fish_catches
                WHERE guild_id = ? AND caught_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                ORDER BY caught_at DESC
                LIMIT 2
            `, [guildId]);

            if (fishActivity.length === 0) {
                [fishActivity] = await db.execute(`
                    SELECT 'fish' as icon,
                           CONCAT('Fish caught: ', COALESCE(fish_name, 'Unknown')) as description,
                           caught_at as time
                    FROM fish_catches
                    WHERE caught_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                    ORDER BY caught_at DESC
                    LIMIT 2
                `);
            }
        } catch (e) { console.warn('fish activity query failed:', e.message); }

        const allActivities = [...commandActivity, ...fishActivity]
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .slice(0, 5);

        const formattedActivities = allActivities.map(activity => ({
            icon: activity.icon,
            description: activity.description,
            time: timeAgo(activity.time)
        }));

        res.json(formattedActivities);
    } catch (error) {
        console.error('Recent activity error:', error);
        res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
});

// Guild Settings
app.get('/api/guild/settings', async (req, res) => {
    try {
        if (req.guildId === 'global') {
            res.json({
                prefix: 'bb ',
                logging_enabled: false,
                logging_channel: null
            });
            return;
        }

        const [settings] = await db.execute(
            'SELECT * FROM guild_settings WHERE guild_id = ?',
            [req.guildId]
        );

        if (settings.length === 0) {
            res.json({
                prefix: 'bb ',
                logging_enabled: false,
                logging_channel: null
            });
        } else {
            res.json(settings[0]);
        }
    } catch (error) {
        console.error('Guild settings error:', error);
        res.status(500).json({ error: 'Failed to fetch guild settings' });
    }
});

app.put('/api/guild/settings', async (req, res) => {
    try {
        const { prefix, logging_enabled, logging_channel } = req.body;

        if (req.guildId === 'global') {
            res.status(400).json({ error: 'Cannot modify global settings' });
            return;
        }

        await db.execute(`
            INSERT INTO guild_settings (guild_id, prefix, logging_enabled, logging_channel)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            prefix = VALUES(prefix),
            logging_enabled = VALUES(logging_enabled),
            logging_channel = VALUES(logging_channel)
        `, [req.guildId, prefix, logging_enabled, logging_channel]);

        res.json({ success: true });
    } catch (error) {
        console.error('Guild settings update error:', error);
        res.status(500).json({ error: 'Failed to update guild settings' });
    }
});

// Blocked Channels (stored as JSON in guild_settings)
app.get('/api/guild/blocked-channels', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT blocked_channels FROM guild_settings WHERE guild_id = ?',
            [req.guildId]
        );
        const channels = rows[0]?.blocked_channels
            ? JSON.parse(rows[0].blocked_channels)
            : [];
        res.json(channels.map(id => ({ channel_id: id })));
    } catch (error) {
        console.error('Blocked channels error:', error);
        res.status(500).json({ error: 'Failed to fetch blocked channels' });
    }
});

app.post('/api/guild/blocked-channels', async (req, res) => {
    try {
        const { channel_id } = req.body;
        const [rows] = await db.execute(
            'SELECT blocked_channels FROM guild_settings WHERE guild_id = ?',
            [req.guildId]
        );
        let channels = rows[0]?.blocked_channels ? JSON.parse(rows[0].blocked_channels) : [];
        if (!channels.includes(channel_id)) channels.push(channel_id);
        await db.execute(
            `INSERT INTO guild_settings (guild_id, blocked_channels) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE blocked_channels = VALUES(blocked_channels)`,
            [req.guildId, JSON.stringify(channels)]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Add blocked channel error:', error);
        res.status(500).json({ error: 'Failed to add blocked channel' });
    }
});

app.delete('/api/guild/blocked-channels/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const [rows] = await db.execute(
            'SELECT blocked_channels FROM guild_settings WHERE guild_id = ?',
            [req.guildId]
        );
        let channels = rows[0]?.blocked_channels ? JSON.parse(rows[0].blocked_channels) : [];
        channels = channels.filter(id => id !== channelId);
        await db.execute(
            `INSERT INTO guild_settings (guild_id, blocked_channels) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE blocked_channels = VALUES(blocked_channels)`,
            [req.guildId, JSON.stringify(channels)]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Remove blocked channel error:', error);
        res.status(500).json({ error: 'Failed to remove blocked channel' });
    }
});

// Custom Prefixes
app.get('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT prefix FROM guild_prefixes WHERE guild_id = ?',
            [req.guildId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Custom prefixes error:', error);
        res.status(500).json({ error: 'Failed to fetch custom prefixes' });
    }
});

app.post('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const { prefix } = req.body;
        if (!prefix) return res.status(400).json({ error: 'Prefix required' });
        await db.execute(
            'INSERT IGNORE INTO guild_prefixes (guild_id, prefix) VALUES (?, ?)',
            [req.guildId, prefix]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Add prefix error:', error);
        res.status(500).json({ error: 'Failed to add prefix' });
    }
});

app.delete('/api/guild/custom-prefixes', async (req, res) => {
    try {
        const { prefix } = req.body;
        await db.execute(
            'DELETE FROM guild_prefixes WHERE guild_id = ? AND prefix = ?',
            [req.guildId, prefix]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Remove prefix error:', error);
        res.status(500).json({ error: 'Failed to remove prefix' });
    }
});

// Modules
app.get('/api/modules', async (req, res) => {
    try {
        const modules = ['economy', 'fishing', 'gambling', 'moderation', 'fun', 'utility'];
        const moduleStates = {};

        for (const module of modules) {
            const [result] = await db.execute(`
                SELECT enabled FROM guild_module_settings 
                WHERE guild_id = ? AND module = ?
            `, [req.guildId, module]);

            moduleStates[module] = result.length > 0 ? result[0].enabled : true;
        }

        res.json(moduleStates);
    } catch (error) {
        console.error('Modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

app.post('/api/modules/toggle', async (req, res) => {
    try {
        const { module, enabled } = req.body;

        await db.execute(`
            INSERT INTO guild_module_settings (guild_id, module, enabled)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)
        `, [req.guildId, module, enabled]);

        res.json({ success: true });
    } catch (error) {
        console.error('Module toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle module' });
    }
});

// Commands
app.get('/api/commands', async (req, res) => {
    try {
        // Get all commands from command_stats to see what commands exist
        const [commands] = await db.execute(`
            SELECT DISTINCT command_name as name, COUNT(*) as usage_count
            FROM command_stats 
            WHERE used_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY command_name 
            ORDER BY usage_count DESC
        `);

        // Get their enabled state
        const commandStates = [];
        for (const command of commands) {
            const [result] = await db.execute(`
                SELECT enabled FROM guild_command_settings 
                WHERE guild_id = ? AND command = ?
            `, [req.guildId, command.name]);

            commandStates.push({
                name: command.name,
                enabled: result.length > 0 ? result[0].enabled : true,
                usage: command.usage_count
            });
        }

        res.json(commandStates);
    } catch (error) {
        console.error('Commands error:', error);
        res.status(500).json({ error: 'Failed to fetch commands' });
    }
});

// Scope Rules
app.get('/api/scope-rules', async (req, res) => {
    try {
        const guildId = req.guildId || req.query.guild_id;
        if (!guildId || guildId === 'global' || guildId === 'null') {
            return res.json([]);
        }
        const [rows] = await db.execute(
            'SELECT * FROM command_scope_rules WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Scope rules error:', error);
        res.status(500).json({ error: 'Failed to fetch scope rules' });
    }
});

app.post('/api/scope-rules', async (req, res) => {
    try {
        const guildId = req.guildId || req.body.guild_id;
        const { command_name, scope_type, target_type, target_id } = req.body;
        if (!command_name) return res.status(400).json({ error: 'command_name is required' });
        await db.execute(
            'INSERT INTO command_scope_rules (guild_id, command_name, scope_type, target_type, target_id) VALUES (?, ?, ?, ?, ?)',
            [guildId, command_name, scope_type || 'allow', target_type || 'channel', target_id || null]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Scope rule create error:', error);
        res.status(500).json({ error: 'Failed to create scope rule' });
    }
});

app.put('/api/scope-rules/:id', async (req, res) => {
    try {
        const guildId = req.guildId;
        const { command_name, scope_type, target_type, target_id } = req.body;
        if (!command_name) return res.status(400).json({ error: 'command_name is required' });
        await db.execute(
            'UPDATE command_scope_rules SET command_name = ?, scope_type = ?, target_type = ?, target_id = ? WHERE id = ? AND guild_id = ?',
            [command_name, scope_type || 'allow', target_type || 'channel', target_id || null, req.params.id, guildId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Scope rule update error:', error);
        res.status(500).json({ error: 'Failed to update scope rule' });
    }
});

app.delete('/api/scope-rules/:id', async (req, res) => {
    try {
        await db.execute('DELETE FROM command_scope_rules WHERE id = ? AND guild_id = ?', [req.params.id, req.guildId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Scope rule delete error:', error);
        res.status(500).json({ error: 'Failed to delete scope rule' });
    }
});

// Economy
app.get('/api/economy/guild-balance', async (req, res) => {
    try {
        const guildId = req.guildId;
        
        // Require guild selection
        if (!guildId || guildId === 'global') {
            return res.json({
                balance: 0,
                total_donated: 0,
                total_given: 0,
                noServerSelected: true
            });
        }

        const [balance] = await db.execute(
            'SELECT * FROM guild_balances WHERE guild_id = ?',
            [guildId]
        );

        if (balance.length === 0) {
            res.json({
                balance: 0,
                total_donated: 0,
                total_given: 0
            });
        } else {
            res.json(balance[0]);
        }
    } catch (error) {
        console.error('Guild balance error:', error);
        res.status(500).json({ error: 'Failed to fetch guild balance' });
    }
});

app.post('/api/economy/guild-balance/adjust', async (req, res) => {
    try {
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

// Economy Interest Settings
app.get('/api/economy/interest-settings', async (req, res) => {
    try {
        const guildId = req.guildId || req.query.guild_id;
        if (!guildId) {
            return res.json({ interest_rate: 0.02, interest_interval_hours: 24, max_bank_interest: 1000000 });
        }
        const [rows] = await db.execute(
            "SELECT setting_key, setting_value FROM guild_economy_settings WHERE guild_id = ? AND setting_key IN ('interest_rate','interest_interval_hours','max_bank_interest')",
            [guildId]
        ).catch(() => [[]]);

        const settings = { interest_rate: 0.02, interest_interval_hours: 24, max_bank_interest: 1000000 };
        rows.forEach(r => {
            settings[r.setting_key] = parseFloat(r.setting_value);
        });

        res.json(settings);
    } catch (error) {
        console.error('Interest settings error:', error);
        res.json({ interest_rate: 0.02, interest_interval_hours: 24, max_bank_interest: 1000000 });
    }
});

app.post('/api/economy/interest-settings', async (req, res) => {
    try {
        const guildId = req.guildId || req.body.guild_id;
        const { key, value } = req.body;
        await db.execute(
            'INSERT INTO guild_economy_settings (guild_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            [guildId, key, value]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Interest settings update error:', error);
        res.status(500).json({ error: 'Failed to update interest setting' });
    }
});

// Shop Items
app.get('/api/shop/items', async (req, res) => {
    try {
        const [items] = await db.execute(`
            SELECT item_id, name, category, price, level, max_quantity, description
            FROM shop_items 
            ORDER BY category, level, name
        `);

        res.json(items);
    } catch (error) {
        console.error('Shop items error:', error);
        res.status(500).json({ error: 'Failed to fetch shop items' });
    }
});

app.post('/api/shop/items', async (req, res) => {
    try {
        const { item_id, name, description, category, price, level, max_quantity } = req.body;

        await db.execute(`
            INSERT INTO shop_items (item_id, name, description, category, price, level, max_quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [item_id, name, description, category, price, level, max_quantity]);

        res.json({ success: true });
    } catch (error) {
        console.error('Shop items creation error:', error);
        res.status(500).json({ error: 'Failed to create shop item' });
    }
});

// Daily Deals
app.get('/api/shop/daily-deals', async (req, res) => {
    try {
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

// Bazaar Stats
app.get('/api/bazaar/stats', async (req, res) => {
    try {
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

// Users Search
app.get('/api/users/search', async (req, res) => {
    try {
        const { q } = req.query;
        const guildId = req.guildId;
        
        // Require guild selection
        if (!guildId || guildId === 'global') {
            return res.json({ error: 'Please select a server first', noServerSelected: true });
        }
        
        // Search by user ID or look for users with activity in this guild
        let query = '';
        let params = [];

        if (/^\d+$/.test(q)) {
            // Numeric search - search by user ID in server_users
            query = `
                SELECT su.guild_id, su.user_id, su.wallet, su.bank, su.bank_limit,
                       su.total_gambled, su.total_won, su.total_lost, su.commands_used,
                       su.created_at, su.last_active
                FROM server_users su
                WHERE su.user_id = ? AND su.guild_id = ?
            `;
            params = [q, guildId];
        } else {
            // Text search - find users in this guild by economy values
            query = `
                SELECT su.guild_id, su.user_id, su.wallet, su.bank, su.bank_limit,
                       su.total_gambled, su.total_won, su.total_lost, su.commands_used,
                       su.created_at, su.last_active
                FROM server_users su
                WHERE su.guild_id = ?
                AND (su.user_id LIKE ? OR (su.wallet + su.bank) > 10000)
                ORDER BY (su.wallet + su.bank) DESC 
                LIMIT 20
            `;
            params = [guildId, `%${q}%`];
        }

        const [users] = await db.execute(query, params);
        
        // Add some computed fields
        const enrichedUsers = users.map(user => ({
            ...user,
            networth: user.wallet + user.bank,
            bank_space: user.bank_limit - user.bank
        }));

        res.json(enrichedUsers);
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// Giveaways
app.get('/api/giveaways/active', async (req, res) => {
    try {
        const guildId = req.guildId;
        
        // Require guild selection
        if (!guildId || guildId === 'global') {
            return res.json([]);
        }

        const [giveaways] = await db.execute(`
            SELECT g.*, 
                   (SELECT COUNT(*) FROM giveaway_entries WHERE giveaway_id = g.id) as entry_count
            FROM giveaways g
            WHERE g.guild_id = ? AND g.active = true AND g.ends_at > NOW()
            ORDER BY g.ends_at ASC
        `, [guildId]);

        res.json(giveaways);
    } catch (error) {
        console.error('Active giveaways error:', error);
        res.status(500).json({ error: 'Failed to fetch active giveaways' });
    }
});

app.post('/api/giveaways', async (req, res) => {
    try {
        const { prize_amount, max_winners, duration_hours, channel_id } = req.body;
        const ends_at = new Date(Date.now() + duration_hours * 60 * 60 * 1000);

        const [result] = await db.execute(`
            INSERT INTO giveaways (guild_id, channel_id, prize_amount, max_winners, ends_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [req.guildId, channel_id, prize_amount, max_winners, ends_at, 0]);

        res.json({ success: true, giveaway_id: result.insertId });
    } catch (error) {
        console.error('Giveaway creation error:', error);
        res.status(500).json({ error: 'Failed to create giveaway' });
    }
});

// ML Settings
app.get('/api/ml/settings', async (req, res) => {
    try {
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

app.post('/api/ml/settings', async (req, res) => {
    try {
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

// Blacklist/Whitelist
app.get('/api/moderation/blacklist', async (req, res) => {
    try {
        const [blacklist] = await db.execute('SELECT * FROM global_blacklist ORDER BY added_at DESC');
        res.json(blacklist);
    } catch (error) {
        console.error('Blacklist error:', error);
        res.status(500).json({ error: 'Failed to fetch blacklist' });
    }
});

app.post('/api/moderation/blacklist', async (req, res) => {
    try {
        const { user_id, reason } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id is required' });
        await db.execute('INSERT INTO global_blacklist (user_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)', [user_id, reason || null]);
        res.json({ success: true });
    } catch (error) {
        console.error('Blacklist add error:', error);
        res.status(500).json({ error: 'Failed to add to blacklist' });
    }
});

app.get('/api/moderation/whitelist', async (req, res) => {
    try {
        const [whitelist] = await db.execute('SELECT * FROM global_whitelist ORDER BY added_at DESC');
        res.json(whitelist);
    } catch (error) {
        console.error('Whitelist error:', error);
        res.status(500).json({ error: 'Failed to fetch whitelist' });
    }
});

app.post('/api/moderation/whitelist', async (req, res) => {
    try {
        const { user_id, reason } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id is required' });
        await db.execute('INSERT INTO global_whitelist (user_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)', [user_id, reason || null]);
        res.json({ success: true });
    } catch (error) {
        console.error('Whitelist add error:', error);
        res.status(500).json({ error: 'Failed to add to whitelist' });
    }
});

app.delete('/api/moderation/blacklist/:user_id', async (req, res) => {
    try {
        await db.execute('DELETE FROM global_blacklist WHERE user_id = ?', [req.params.user_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Blacklist delete error:', error);
        res.status(500).json({ error: 'Failed to remove from blacklist' });
    }
});

app.delete('/api/moderation/whitelist/:user_id', async (req, res) => {
    try {
        await db.execute('DELETE FROM global_whitelist WHERE user_id = ?', [req.params.user_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Whitelist delete error:', error);
        res.status(500).json({ error: 'Failed to remove from whitelist' });
    }
});

// Reaction Roles
app.get('/api/reaction-roles', async (req, res) => {
    try {
        const [roles] = await db.execute('SELECT * FROM reaction_roles ORDER BY created_at DESC');
        res.json(roles);
    } catch (error) {
        console.error('Reaction roles error:', error);
        res.status(500).json({ error: 'Failed to fetch reaction roles' });
    }
});

app.post('/api/reaction-roles', async (req, res) => {
    try {
        const { message_id, channel_id, emoji_raw, role_id } = req.body;

        await db.execute(`
            INSERT INTO reaction_roles (message_id, channel_id, emoji_raw, role_id)
            VALUES (?, ?, ?, ?)
        `, [message_id, channel_id, emoji_raw, role_id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Reaction role creation error:', error);
        res.status(500).json({ error: 'Failed to create reaction role' });
    }
});

// Fishing Statistics
app.get('/api/fishing/stats', async (req, res) => {
    try {
        const guildId = req.guildId;
        
        // If no guild selected, return empty stats
        if (!guildId || guildId === 'global') {
            return res.json({
                total_caught: 0,
                most_valuable: 0,
                legendary_count: 0,
                active_autofishers: 0,
                noServerSelected: true
            });
        }

        const [totalFish] = await db.execute(
            'SELECT COUNT(*) as count FROM server_fish_catches WHERE guild_id = ?',
            [guildId]
        );
        const [valuableFish] = await db.execute(
            'SELECT MAX(value) as max_value FROM server_fish_catches WHERE guild_id = ?',
            [guildId]
        );
        const [legendaryFish] = await db.execute(
            'SELECT COUNT(*) as count FROM server_fish_catches WHERE guild_id = ? AND rarity = "legendary"',
            [guildId]
        );
        const [activeAutofishers] = await db.execute(
            'SELECT COUNT(*) as count FROM server_autofishers WHERE guild_id = ? AND active = true',
            [guildId]
        );

        res.json({
            total_caught: totalFish[0].count,
            most_valuable: valuableFish[0].max_value || 0,
            legendary_count: legendaryFish[0].count,
            active_autofishers: activeAutofishers[0].count
        });
    } catch (error) {
        console.error('Fishing stats error:', error);
        res.status(500).json({ error: 'Failed to fetch fishing stats' });
    }
});

// Fishing Gear (rods & bait from shop_items)
app.get('/api/fishing/gear', async (req, res) => {
    try {
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

app.post('/api/fishing/gear', async (req, res) => {
    try {
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

app.put('/api/fishing/gear/:item_id', async (req, res) => {
    try {
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

app.delete('/api/fishing/gear/:item_id', async (req, res) => {
    try {
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

// Suggestions
app.get('/api/suggestions', async (req, res) => {
    try {
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

// Utility function
function timeAgo(date) {
    const now = new Date();
    const diffInMs = now - new Date(date);
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    
    if (diffInMinutes < 1) return 'just now';
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} days ago`;
}

// Real-time monitoring and Socket.io setup
let connectedClients = 0;
let lastActivity = new Date();
let dbStats = {
    connectionStatus: 'disconnected',
    lastQuery: null,
    queriesPerMinute: 0,
    averageResponseTime: 0
};

// Track API calls for real-time stats
let apiCallStats = {
    totalCalls: 0,
    callsPerMinute: 0,
    recentCalls: []
};

io.on('connection', (socket) => {
    connectedClients++;
    console.log(`🌐 Client connected. Total clients: ${connectedClients}`);
    
    // Send current stats to new client
    socket.emit('initial-stats', {
        dbStats,
        apiCallStats,
        serverStats: {
            uptime: process.uptime(),
            connectedClients,
            lastActivity
        }
    });
    
    // Handle client requesting specific server data
    socket.on('join-server', (serverId) => {
        socket.join(`server-${serverId}`);
        console.log(`Client joined server room: ${serverId}`);
        // Immediately push per-guild stats to the newly joined client
        getGuildRealtimeStats(serverId).then(guildStats => {
            if (guildStats) socket.emit('server-stats-update', guildStats);
        });
    });
    
    socket.on('leave-server', (serverId) => {
        socket.leave(`server-${serverId}`);
    });
    
    socket.on('disconnect', () => {
        connectedClients--;
        console.log(`🔌 Client disconnected. Total clients: ${connectedClients}`);
    });
});

// Database monitoring functions
async function pingDatabase() {
    const startTime = Date.now();
    try {
        await db.execute('SELECT 1 as ping');
        const responseTime = Date.now() - startTime;
        
        dbStats.connectionStatus = 'connected';
        dbStats.lastQuery = new Date();
        dbStats.averageResponseTime = Math.round((dbStats.averageResponseTime + responseTime) / 2);
        
        // Emit to all connected clients
        io.emit('db-ping', {
            status: 'connected',
            responseTime,
            timestamp: new Date()
        });
        
        return true;
    } catch (error) {
        dbStats.connectionStatus = 'error';
        console.error('Database ping failed:', error);
        
        io.emit('db-ping', {
            status: 'error',
            error: error.message,
            timestamp: new Date()
        });
        
        return false;
    }
}

async function getRealtimeStats() {
    try {
        // Get current database stats
        const [userCount] = await db.execute('SELECT COUNT(*) as count FROM users');
        const [commandStats] = await db.execute(`
            SELECT COUNT(*) as total_commands, 
                   COUNT(CASE WHEN used_at >= NOW() - INTERVAL 1 HOUR THEN 1 END) as last_hour
            FROM command_stats
        `);
        const [economyStats] = await db.execute('SELECT SUM(wallet + bank) as total_economy FROM users');
        const [fishStats] = await db.execute(`
            SELECT COUNT(*) as total_fish,
                   COUNT(CASE WHEN caught_at >= NOW() - INTERVAL 1 DAY THEN 1 END) as today_fish
            FROM fish_catches
        `);
        
        const stats = {
            users: userCount[0]?.count || 0,
            commands: {
                total: commandStats[0]?.total_commands || 0,
                lastHour: commandStats[0]?.last_hour || 0
            },
            economy: economyStats[0]?.total_economy || 0,
            fishing: {
                total: fishStats[0]?.total_fish || 0,
                today: fishStats[0]?.today_fish || 0
            },
            timestamp: new Date()
        };
        
        return stats;
    } catch (error) {
        console.error('Failed to get realtime stats:', error);
        return null;
    }
}

// Per-guild realtime stats — scoped to a specific server
// memberCount is omitted here to avoid Discord API rate limits on the 5s socket loop;
// it's fetched on the HTTP /api/stats/overview request instead.
async function getGuildRealtimeStats(guildId) {
    try {
        // Economy — sum wallet + bank from server_users (per-guild balances)
        const [[economyValue]] = await db.execute(
            'SELECT COALESCE(SUM(wallet + bank), 0) as total FROM server_users WHERE guild_id = ?',
            [guildId]
        );

        // Commands today — from server_command_stats (per-guild)
        let commandsToday = { count: 0 };
        const [[guildCmds]] = await db.execute(
            'SELECT COUNT(*) as count FROM server_command_stats WHERE guild_id = ? AND used_at >= CURDATE()',
            [guildId]
        );
        commandsToday = guildCmds;

        // Fish caught today — from server_fish_catches (per-guild)
        let fishToday = { count: 0 };
        const [[guildFish]] = await db.execute(
            'SELECT COUNT(*) as count FROM server_fish_catches WHERE guild_id = ? AND caught_at >= CURDATE()',
            [guildId]
        );
        fishToday = guildFish;

        return {
            guildId,
            totalEconomyValue: economyValue.total || 0,
            commandsToday: commandsToday.count,
            fishCaughtToday: fishToday.count,
            timestamp: new Date()
        };
    } catch (error) {
        console.error(`Failed to get guild realtime stats for ${guildId}:`, error);
        return null;
    }
}

function initializeRealTimeMonitoring() {
    console.log('🚀 Initializing real-time monitoring...');
    
    // Database ping every 30 seconds
    setInterval(async () => {
        await pingDatabase();
    }, 30000);
    
    // Real-time stats every 5 seconds
    setInterval(async () => {
        const stats = await getRealtimeStats();
        if (stats) {
            io.emit('stats-update', stats);
        }

        // Also push per-guild stats to each active server room
        const rooms = io.sockets.adapter.rooms;
        for (const [room] of rooms) {
            if (!room.startsWith('server-')) continue;
            const guildId = room.replace('server-', '');
            const guildStats = await getGuildRealtimeStats(guildId);
            if (guildStats) {
                io.to(room).emit('server-stats-update', guildStats);
            }
        }
    }, 5000);
    
    // API call rate calculation every minute
    setInterval(() => {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        // Filter recent calls to last minute
        apiCallStats.recentCalls = apiCallStats.recentCalls.filter(time => time > oneMinuteAgo);
        apiCallStats.callsPerMinute = apiCallStats.recentCalls.length;
        
        io.emit('api-stats-update', {
            callsPerMinute: apiCallStats.callsPerMinute,
            totalCalls: apiCallStats.totalCalls
        });
    }, 60000);
    
    // Initial ping
    pingDatabase();
}

// Middleware to track API calls
app.use('/api', (req, res, next) => {
    apiCallStats.totalCalls++;
    apiCallStats.recentCalls.push(Date.now());
    lastActivity = new Date();
    next();
});

// Real-time API endpoints
app.get('/api/realtime/status', (req, res) => {
    res.json({
        server: {
            uptime: process.uptime(),
            connectedClients,
            lastActivity
        },
        database: dbStats,
        apiStats: apiCallStats
    });
});

// Bot logging endpoint — called by the bot to record command uses and fish catches with guild_id
// Authenticate with the BOT_API_KEY env variable (set this in Render env vars)
app.post('/api/bot/log', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.BOT_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

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

// Endpoint to trigger manual database operations for testing
app.post('/api/realtime/trigger-update', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const stats = await getRealtimeStats();
    if (stats) {
        io.emit('manual-update', stats);
        res.json({ success: true, stats });
    } else {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Server performance monitoring
app.get('/api/realtime/performance', (req, res) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    res.json({
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024), // MB
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        },
        cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
        },
        uptime: process.uptime(),
        connectedClients
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// Shop Items - Update
app.put('/api/shop/items/:item_id', async (req, res) => {
    try {
        const { item_id } = req.params;
        const { name, description, category, price, level, max_quantity } = req.body;
        
        await db.execute(`
            UPDATE shop_items 
            SET name = ?, description = ?, category = ?, price = ?, level = ?, max_quantity = ?
            WHERE item_id = ?
        `, [name, description || null, category, price, level || 1, max_quantity || 1, item_id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Shop item update error:', error);
        res.status(500).json({ error: 'Failed to update shop item' });
    }
});

// Shop Items - Delete
app.delete('/api/shop/items/:item_id', async (req, res) => {
    try {
        const { item_id } = req.params;
        await db.execute('DELETE FROM shop_items WHERE item_id = ?', [item_id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Shop item delete error:', error);
        res.status(500).json({ error: 'Failed to delete shop item' });
    }
});

// Daily Deals - Create
app.post('/api/shop/daily-deals', async (req, res) => {
    try {
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

// Daily Deals - Update
app.put('/api/shop/daily-deals/:id', async (req, res) => {
    try {
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

// Daily Deals - Delete
app.delete('/api/shop/daily-deals/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.execute('DELETE FROM daily_deals WHERE id = ? OR item_id = ?', [id, id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Daily deal delete error:', error);
        res.status(500).json({ error: 'Failed to delete daily deal' });
    }
});

// Reaction Roles - Update
app.put('/api/reaction-roles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { message_id, channel_id, emoji_raw, role_id } = req.body;
        
        await db.execute(`
            UPDATE reaction_roles 
            SET message_id = ?, channel_id = ?, emoji_raw = ?, role_id = ?
            WHERE id = ? OR message_id = ?
        `, [message_id, channel_id, emoji_raw, role_id, id, id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Reaction role update error:', error);
        res.status(500).json({ error: 'Failed to update reaction role' });
    }
});

// Reaction Roles - Delete
app.delete('/api/reaction-roles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.execute('DELETE FROM reaction_roles WHERE id = ? OR message_id = ?', [id, id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Reaction role delete error:', error);
        res.status(500).json({ error: 'Failed to delete reaction role' });
    }
});

// Giveaways - Update
app.put('/api/giveaways/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { prize, max_winners, ends_at, channel_id } = req.body;
        
        await db.execute(`
            UPDATE giveaways 
            SET prize = ?, max_winners = ?, ends_at = ?, channel_id = ?
            WHERE id = ?
        `, [prize, max_winners || 1, ends_at, channel_id, id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Giveaway update error:', error);
        res.status(500).json({ error: 'Failed to update giveaway' });
    }
});

// Giveaways - Delete/Cancel
app.delete('/api/giveaways/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.execute('DELETE FROM giveaways WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Giveaway delete error:', error);
        res.status(500).json({ error: 'Failed to delete giveaway' });
    }
});

// Giveaways - End Early
app.post('/api/giveaways/:id/end', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Update giveaway to end now
        await db.execute(`
            UPDATE giveaways SET ends_at = NOW(), status = 'ended' WHERE id = ?
        `, [id]);
        
        res.json({ success: true, message: 'Giveaway ended' });
    } catch (error) {
        console.error('Giveaway end error:', error);
        res.status(500).json({ error: 'Failed to end giveaway' });
    }
});

// Giveaways - History
app.get('/api/giveaways/history', async (req, res) => {
    try {
        const [history] = await db.execute(`
            SELECT * FROM giveaways 
            WHERE ends_at < NOW() OR status = 'ended'
            ORDER BY ends_at DESC 
            LIMIT 50
        `);
        res.json(history);
    } catch (error) {
        console.error('Giveaway history error:', error);
        res.json([]);
    }
});

// ML Settings - Delete
app.delete('/api/ml/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        await db.execute('DELETE FROM ml_settings WHERE `key` = ?', [key]);
        res.json({ success: true });
    } catch (error) {
        console.error('ML setting delete error:', error);
        res.status(500).json({ error: 'Failed to delete ML setting' });
    }
});

// Scope Rules - Delete Exclusive by Command
app.delete('/api/scope-rules/exclusive/:command', async (req, res) => {
    try {
        const { command } = req.params;
        await db.execute('DELETE FROM scope_rules WHERE command_name = ? AND scope_type = ?', [command, 'exclusive']);
        res.json({ success: true });
    } catch (error) {
        console.error('Exclusive scope rule delete error:', error);
        res.status(500).json({ error: 'Failed to delete exclusive rule' });
    }
});

// Moderation Cooldowns - Get
app.get('/api/moderation/cooldowns', async (req, res) => {
    try {
        const [cooldowns] = await db.execute('SELECT * FROM command_cooldowns ORDER BY command ASC');
        res.json(cooldowns);
    } catch (error) {
        console.error('Cooldowns fetch error:', error);
        res.json([]);
    }
});

// Moderation Cooldowns - Set/Update
app.post('/api/moderation/cooldowns', async (req, res) => {
    try {
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

// Settings - Save All (bulk save)
app.post('/api/settings/save-all', async (req, res) => {
    try {
        const guildId = req.headers['x-guild-id'];
        const { settings } = req.body;
        
        // This is a placeholder - actual implementation depends on what settings are being saved
        // For now, just acknowledge the request
        res.json({ success: true, message: 'Settings saved' });
    } catch (error) {
        console.error('Settings save error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    await initDatabase();
    
    // Initialize real-time monitoring
    initializeRealTimeMonitoring();
    
    server.listen(PORT, () => {
        console.log(`Dashboard server running on port ${PORT}`);
        console.log(`Access dashboard at: http://localhost:${PORT}`);
        console.log(`WebSocket server ready for real-time updates`);
    });
}

startServer().catch(console.error);

module.exports = app;