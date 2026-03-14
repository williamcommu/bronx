// Activity Logger — logs guild setting changes for the "Recent Activity" dashboard feature
// Source: DB (Dashboard) or DC (Discord bot)

const { getDb } = require('./db');

/**
 * Log an activity to guild_activity_log
 * @param {string} guildId - Guild ID
 * @param {object} user - User object with id, username/global_name, avatar
 * @param {'DB'|'DC'} source - 'DB' for Dashboard, 'DC' for Discord
 * @param {string} action - Human-readable action description (can include HTML like <b>)
 * @param {object} [options] - Optional old/new values for audit trail
 * @param {string} [options.oldValue] - Previous value
 * @param {string} [options.newValue] - New value
 */
async function logActivity(guildId, user, source, action, options = {}) {
    const db = getDb();
    if (!db) {
        console.warn('[ActivityLogger] Database not available, skipping activity log');
        return;
    }

    try {
        // Ensure IDs are stored as strings to prevent JavaScript number precision loss
        const guildIdStr = guildId ? String(guildId) : null;
        const userId = user?.id ? String(user.id) : null;
        const userName = user?.global_name || user?.username || null;
        const userAvatar = user?.avatar || null;
        const { oldValue = null, newValue = null } = options;

        await db.execute(
            `INSERT INTO guild_activity_log 
             (guild_id, user_id, user_name, user_avatar, source, action, old_value, new_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [guildIdStr, userId, userName, userAvatar, source, action, oldValue, newValue]
        );
    } catch (error) {
        // Log but don't throw — activity logging should never break the main operation
        console.error('[ActivityLogger] Failed to log activity:', error.message);
    }
}

/**
 * Build a formatted action string with bold changes
 * @param {string} actionType - Type of action (e.g., 'prefix', 'module', 'command')
 * @param {string} verb - Action verb ('changed', 'enabled', 'disabled', 'added', 'removed')
 * @param {string} target - Target name (e.g., 'gambling', '#general', 'bb')
 * @param {object} [options] - Additional options
 * @param {string} [options.from] - Previous value (for 'changed' actions)
 * @param {string} [options.to] - New value (for 'changed' actions)
 * @returns {string} Formatted action string
 */
function formatAction(actionType, verb, target, options = {}) {
    const targetCode = `<code>${escapeHtml(target)}</code>`;
    
    switch (verb) {
        case 'changed':
            if (options.from && options.to) {
                return `Changed ${actionType} from <code>${escapeHtml(options.from)}</code> to <code>${escapeHtml(options.to)}</code>`;
            }
            return `Changed ${actionType} to ${targetCode}`;
        case 'enabled':
            return `<b>Enabled</b> ${targetCode} ${actionType}`;
        case 'disabled':
            return `<b>Disabled</b> ${targetCode} ${actionType}`;
        case 'added':
            return `Added ${targetCode} ${actionType}`;
        case 'removed':
            return `Removed ${targetCode} ${actionType}`;
        case 'created':
            return `Created ${targetCode} ${actionType}`;
        case 'ended':
            return `Ended ${targetCode} ${actionType}`;
        case 'deleted':
            return `Deleted ${targetCode} ${actionType}`;
        default:
            return `${verb} ${targetCode}`;
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Get recent activity for a guild
 * @param {string} guildId - Guild ID
 * @param {number} [limit=5] - Number of entries to return
 * @param {number} [hoursBack=24] - How many hours back to query
 * @returns {Promise<Array>} Activity entries
 */
async function getRecentActivity(guildId, limit = 5, hoursBack = 24) {
    const db = getDb();
    if (!db) return [];

    try {
        const [rows] = await db.execute(
            `SELECT 
                user_id, user_name, user_avatar, source, action, 
                old_value, new_value, created_at
             FROM guild_activity_log
             WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
             ORDER BY created_at DESC
             LIMIT ?`,
            [guildId, hoursBack, limit]
        );
        return rows;
    } catch (error) {
        console.error('[ActivityLogger] Failed to get recent activity:', error.message);
        return [];
    }
}

/**
 * Get paginated activity for a guild (for "See More" feature)
 * @param {string} guildId - Guild ID
 * @param {number} [page=1] - Page number (1-indexed)
 * @param {number} [limit=20] - Entries per page
 * @returns {Promise<{activities: Array, total: number, page: number, totalPages: number}>}
 */
async function getPaginatedActivity(guildId, page = 1, limit = 20) {
    const db = getDb();
    if (!db) return { activities: [], total: 0, page: 1, totalPages: 0 };

    try {
        const offset = (page - 1) * limit;

        // Get total count
        const [[{ total }]] = await db.execute(
            `SELECT COUNT(*) as total FROM guild_activity_log WHERE guild_id = ?`,
            [guildId]
        );

        // Get page data
        const [rows] = await db.execute(
            `SELECT 
                user_id, user_name, user_avatar, source, action, 
                old_value, new_value, created_at
             FROM guild_activity_log
             WHERE guild_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [guildId, limit, offset]
        );

        return {
            activities: rows,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    } catch (error) {
        console.error('[ActivityLogger] Failed to get paginated activity:', error.message);
        return { activities: [], total: 0, page: 1, totalPages: 0 };
    }
}

module.exports = {
    logActivity,
    formatAction,
    getRecentActivity,
    getPaginatedActivity,
    escapeHtml
};
