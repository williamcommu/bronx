// Database connection pool, initialization, and query helpers
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

let db = null;
let dbHealthy = true;
let dbFailCount = 0;
const MAX_FAIL_COUNT = 5;

function getDb() {
    return db;
}

function isDbHealthy() {
    return dbHealthy;
}

function setDbHealthy(val) {
    dbHealthy = val;
    if (val) dbFailCount = 0;
}

// Execute database query with retry and exponential backoff
async function dbQuery(query, params = [], retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await db.execute(query, params);
            dbHealthy = true;
            dbFailCount = 0;
            return result;
        } catch (error) {
            dbFailCount++;
            
            // Check if it's a connection error
            const isConnectionError = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR'].some(
                code => error.code === code || error.message?.includes(code)
            );
            
            if (isConnectionError && attempt < retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                console.error(`[DB] Query failed (attempt ${attempt}/${retries}), retrying in ${delay}ms:`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            if (dbFailCount >= MAX_FAIL_COUNT) {
                dbHealthy = false;
                console.error('[DB] Database marked as unhealthy after multiple failures');
            }
            
            throw error;
        }
    }
}

// Initialize database connection
async function initDatabase() {
    let dbConfig;
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
        
        // Only use SSL for remote hosts (not localhost)
        const isRemote = dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1';
        
        db = mysql.createPool({
            ...dbConfig,
            ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 30000
        });

        // Verify connection
        await db.execute('SELECT 1');
        console.log(`Connected to MariaDB database (pool) at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

        // Keep-alive ping to prevent Aiven from powering off due to inactivity
        setInterval(async () => {
            try {
                await db.execute('SELECT 1');
                console.log('[Keep-alive] Database ping successful');
            } catch (err) {
                console.error('[Keep-alive] Database ping failed:', err.message);
            }
        }, 45000);

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

        // ─── GUILD STATS TABLES (for dashboard statistics) ─────────────────
        // Track member joins/leaves
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_member_events (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            guild_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            event_type VARCHAR(16) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_guild_type (guild_id, event_type),
            INDEX idx_guild_date (guild_id, created_at)
        ) ENGINE=InnoDB`);
        // Track message events (message, edit, delete)
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_message_events (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            guild_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            channel_id BIGINT UNSIGNED NOT NULL,
            event_type VARCHAR(16) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_guild_type (guild_id, event_type),
            INDEX idx_guild_date (guild_id, created_at),
            INDEX idx_guild_user (guild_id, user_id)
        ) ENGINE=InnoDB`);

        // Migration: convert ENUM event_type columns to VARCHAR(16) for compatibility with bot
        try { await db.execute('ALTER TABLE guild_member_events MODIFY COLUMN event_type VARCHAR(16) NOT NULL'); } catch (e) { /* already VARCHAR or table doesn\'t exist */ }
        try { await db.execute('ALTER TABLE guild_message_events MODIFY COLUMN event_type VARCHAR(16) NOT NULL'); } catch (e) { /* already VARCHAR or table doesn\'t exist */ }
        // Track command usage per day per channel
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_command_usage (
            guild_id BIGINT UNSIGNED NOT NULL,
            command_name VARCHAR(64) NOT NULL,
            channel_id BIGINT UNSIGNED NOT NULL,
            usage_date DATE NOT NULL,
            use_count INT NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, command_name, channel_id, usage_date),
            INDEX idx_guild_date (guild_id, usage_date)
        ) ENGINE=InnoDB`);
        // Daily aggregated stats for faster dashboard queries
        // Column names use *_count suffix to match migration 011 and the rollup job
        await db.execute(`CREATE TABLE IF NOT EXISTS guild_daily_stats (
            guild_id BIGINT UNSIGNED NOT NULL,
            channel_id VARCHAR(32) NOT NULL DEFAULT '__guild__',
            stat_date DATE NOT NULL,
            messages_count INT NOT NULL DEFAULT 0,
            edits_count INT NOT NULL DEFAULT 0,
            deletes_count INT NOT NULL DEFAULT 0,
            joins_count INT NOT NULL DEFAULT 0,
            leaves_count INT NOT NULL DEFAULT 0,
            commands_count INT NOT NULL DEFAULT 0,
            active_users INT NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, channel_id, stat_date),
            INDEX idx_guild_date (guild_id, stat_date)
        ) ENGINE=InnoDB`);

        // Migration: rename old bare-name columns to *_count if needed, and add missing columns
        const dailyStatsMigrations = [
            // Add missing columns (safe even if they already exist)
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS edits_count INT NOT NULL DEFAULT 0",
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS deletes_count INT NOT NULL DEFAULT 0",
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS joins_count INT NOT NULL DEFAULT 0",
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS leaves_count INT NOT NULL DEFAULT 0",
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS commands_count INT NOT NULL DEFAULT 0",
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS active_users INT NOT NULL DEFAULT 0",
            "ALTER TABLE guild_daily_stats ADD COLUMN IF NOT EXISTS messages_count INT NOT NULL DEFAULT 0",
        ];
        for (const sql of dailyStatsMigrations) {
            try { await db.execute(sql); } catch (e) { /* column already exists or unsupported syntax */ }
        }
        // If old bare-name columns exist, copy data and drop them
        try {
            const [cols] = await db.execute("SHOW COLUMNS FROM guild_daily_stats LIKE 'messages'");
            if (cols.length > 0) {
                console.log('[migration] Migrating guild_daily_stats: renaming bare columns to *_count...');
                await db.execute('UPDATE guild_daily_stats SET messages_count = messages WHERE messages_count = 0 AND messages > 0');
                await db.execute('UPDATE guild_daily_stats SET edits_count = edits WHERE edits_count = 0 AND edits > 0').catch(() => {});
                await db.execute('UPDATE guild_daily_stats SET deletes_count = deletes WHERE deletes_count = 0 AND deletes > 0').catch(() => {});
                await db.execute('UPDATE guild_daily_stats SET joins_count = joins WHERE joins_count = 0 AND joins > 0').catch(() => {});
                await db.execute('UPDATE guild_daily_stats SET leaves_count = leaves WHERE leaves_count = 0 AND leaves > 0').catch(() => {});
                // Drop old columns after migration
                for (const col of ['messages', 'edits', 'deletes', 'joins', 'leaves']) {
                    try { await db.execute(`ALTER TABLE guild_daily_stats DROP COLUMN ${col}`); } catch (e) { /* already gone */ }
                }
                console.log('[migration] guild_daily_stats columns migrated to *_count naming');
            }
        } catch (e) { /* table might not exist yet, that's fine */ }

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

module.exports = { getDb, dbQuery, initDatabase, isDbHealthy, setDbHealthy };
