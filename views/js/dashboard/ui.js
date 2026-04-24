// ============================================================
//  dashboard/ui.js — UI components (toast, command palette,
//  sidebar, modal, breadcrumbs)
// ============================================================

/**
 * UI Components mixin for BronxBotDashboard
 */
export const UiMixin = {
    cmdPaletteIndex: -1,

    // ── Toast Notification System ──────────────────────────────
    toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = {
            success: 'fa-check',
            error: 'fa-times',
            warning: 'fa-exclamation',
            info: 'fa-info'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></div>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>
            <div class="toast-progress"></div>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    showNotification(message, type = 'info') {
        this.toast(message, type);
    },

    showLiveNotification(message, type = 'info') {
        this.toast(message, type, 3000);
    },

    // ── Command Palette ────────────────────────────────────────
    initCommandPalette() {
        const overlay = document.getElementById('cmd-palette-overlay');
        const input = document.getElementById('cmd-palette-input');
        const openBtn = document.getElementById('open-cmd-palette');

        if (!overlay || !input) return;

        if (openBtn) {
            openBtn.addEventListener('click', () => this.openCommandPalette());
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeCommandPalette();
        });

        input.addEventListener('input', (e) => {
            this.filterCommandPalette(e.target.value);
        });

        input.addEventListener('keydown', (e) => {
            const items = overlay.querySelectorAll('.cmd-palette-item:not([style*="display: none"])');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.cmdPaletteIndex = Math.min(this.cmdPaletteIndex + 1, items.length - 1);
                this.highlightPaletteItem(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.cmdPaletteIndex = Math.max(this.cmdPaletteIndex - 1, 0);
                this.highlightPaletteItem(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.cmdPaletteIndex >= 0 && items[this.cmdPaletteIndex]) {
                    const action = items[this.cmdPaletteIndex].dataset.action;
                    this.executeCommandPaletteAction(action);
                }
            } else if (e.key === 'Escape') {
                this.closeCommandPalette();
            }
        });

        overlay.addEventListener('click', (e) => {
            const item = e.target.closest('.cmd-palette-item');
            if (item) {
                this.executeCommandPaletteAction(item.dataset.action);
            }
        });
    },

    openCommandPalette() {
        const overlay = document.getElementById('cmd-palette-overlay');
        const input = document.getElementById('cmd-palette-input');
        if (!overlay) return;
        overlay.classList.add('active');
        this.cmdPaletteIndex = -1;
        if (input) {
            input.value = '';
            this.filterCommandPalette('');
            setTimeout(() => input.focus(), 50);
        }
    },

    closeCommandPalette() {
        const overlay = document.getElementById('cmd-palette-overlay');
        if (overlay) overlay.classList.remove('active');
        this.cmdPaletteIndex = -1;
    },

    // Common typos and aliases for search terms
    _searchAliases: {
        // Typos
        'reactoin': 'reaction', 'reactionroles': 'reaction roles', 'recation': 'reaction',
        'autrooles': 'autoroles', 'autorol': 'autoroles', 'autorole': 'autoroles',
        'moderaton': 'moderation', 'modertion': 'moderation', 'mdoeration': 'moderation',
        'setings': 'settings', 'settigns': 'settings', 'settins': 'settings',
        'leaderborad': 'leaderboard', 'leaderbaord': 'leaderboard', 'leaderbored': 'leaderboard',
        'statistcs': 'statistics', 'statsitics': 'statistics', 'stats': 'statistics',
        'economny': 'economy', 'econmoy': 'economy', 'econ': 'economy',
        'gmabling': 'gambling', 'gamblign': 'gambling', 'gamble': 'gambling',
        'anayltics': 'analytics', 'analyitcs': 'analytics', 'analtyics': 'analytics',
        'activty': 'activity', 'actviity': 'activity', 'actvity': 'activity',
        'fishign': 'fishing', 'fisihng': 'fishing', 'fsihing': 'fishing',
        'givaway': 'giveaway', 'giveaways': 'giveaway', 'giveawya': 'giveaway',
        'commnads': 'commands', 'commadns': 'commands', 'cmds': 'commands',
        'vocie': 'voice', 'voic': 'voice', 'vc': 'voice',
        'chanell': 'channel', 'chanel': 'channel', 'chnanel': 'channel',
        'usres': 'users', 'uers': 'users', 'usr': 'users',
        'profiel': 'profile', 'proflie': 'profile', 'proifles': 'profiles',
        'heatmpa': 'heatmap', 'hetamap': 'heatmap', 'heatamap': 'heatmap',
        'shpo': 'shop', 'shoop': 'shop', 'sotre': 'store',
        'overveiw': 'overview', 'ovrview': 'overview', 'overivew': 'overview',
        'logz': 'logs', 'log': 'logs', 'losg': 'logs',
        
        // Aliases - alternative names people might search for
        'config': 'settings', 'configuration': 'settings', 'setup': 'settings', 'options': 'settings',
        'roles': 'reaction roles', 'role': 'reaction roles', 'reaction': 'reaction roles',
        'auto': 'autoroles', 'autorole': 'autoroles', 'joinroles': 'autoroles', 'join': 'autoroles',
        'money': 'economy', 'coins': 'economy', 'currency': 'economy', 'balance': 'economy', 'daily': 'economy',
        'bet': 'gambling', 'casino': 'gambling', 'slots': 'gambling', 'winrate': 'gambling',
        'board': 'leaderboard', 'top': 'leaderboard', 'ranking': 'leaderboard', 'ranks': 'leaderboard', 'xp': 'leaderboard',
        'mods': 'moderation', 'ban': 'moderation', 'kick': 'moderation', 'mute': 'moderation', 'spam': 'moderation', 'automod': 'moderation',
        'fish': 'fishing', 'rod': 'fishing', 'bait': 'fishing', 'catch': 'fishing', 'rare': 'fishing',
        'raffle': 'giveaway', 'prize': 'giveaway', 'draw': 'giveaway',
        'store': 'shop', 'buy': 'shop', 'purchase': 'shop', 'items': 'shop', 'marketplace': 'shop',
        'home': 'overview', 'dashboard': 'overview', 'main': 'overview', 'quick': 'overview',
        'graph': 'analytics', 'chart': 'analytics', 'data': 'analytics', 'insights': 'analytics', 'trends': 'statistics',
        'recent': 'activity', 'history': 'activity', 'actions': 'activity', 'joins': 'activity', 'leaves': 'activity',
        'members': 'users', 'people': 'users', 'players': 'users', 'lookup': 'user profiles',
        'cmd': 'commands', 'command': 'commands', 'prefix': 'commands', 'permissions': 'commands',
        'vc': 'voice', 'call': 'voice', 'talking': 'voice', 'time': 'voice',
        'channels': 'channel', 'text': 'channel', 'chat': 'channel', 'messages': 'channel',
        'warns': 'mod logs', 'warn': 'mod logs', 'bans': 'mod logs', 'kicks': 'mod logs',
        'welcome': 'settings', 'greeting': 'settings',
        'hourly': 'heatmap', 'pattern': 'heatmap', 'visualization': 'heatmap',
        'flow': 'economy analytics', 'spending': 'economy analytics', 'earners': 'economy analytics'
    },

    // Normalize text: remove spaces, numbers, special chars
    _normalizeSearch(str) {
        return str.toLowerCase()
            .replace(/[^a-z]/g, '') // Keep only letters
            .trim();
    },

    // Calculate fuzzy match score (0-1, higher is better)
    _fuzzyScore(query, target) {
        const q = this._normalizeSearch(query);
        const t = this._normalizeSearch(target);
        
        if (!q) return 1; // Empty query matches everything
        if (t.includes(q)) return 1; // Exact substring = perfect match
        
        // Check if all characters appear in order (subsequence match)
        let qi = 0;
        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) qi++;
        }
        if (qi === q.length) return 0.8; // All chars found in order
        
        // Levenshtein-based similarity for short queries
        if (q.length <= 6) {
            const dist = this._levenshtein(q, t.substring(0, Math.min(t.length, q.length + 2)));
            const maxLen = Math.max(q.length, t.length);
            const similarity = 1 - (dist / maxLen);
            if (similarity > 0.5) return similarity * 0.7;
        }
        
        return 0;
    },

    // Levenshtein distance (edit distance between two strings)
    _levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        
        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,      // deletion
                    matrix[j - 1][i] + 1,      // insertion
                    matrix[j - 1][i - 1] + cost // substitution
                );
            }
        }
        return matrix[b.length][a.length];
    },

    // Expand query with aliases and typo corrections
    _expandQuery(query) {
        const normalized = this._normalizeSearch(query);
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const expanded = new Set([query.toLowerCase()]);
        
        // Check each word against aliases
        for (const word of words) {
            const alias = this._searchAliases[word] || this._searchAliases[this._normalizeSearch(word)];
            if (alias) expanded.add(alias);
        }
        
        // Check full query against aliases
        const fullAlias = this._searchAliases[normalized];
        if (fullAlias) expanded.add(fullAlias);
        
        return [...expanded];
    },

    filterCommandPalette(query) {
        const results = document.getElementById('cmd-palette-results');
        if (!results) return;
        const items = results.querySelectorAll('.cmd-palette-item');
        const groups = results.querySelectorAll('.cmd-palette-group');

        // Score each item
        const expandedQueries = this._expandQuery(query);
        
        items.forEach(item => {
            const text = item.textContent;
            let bestScore = 0;
            
            // Check against all expanded queries
            for (const q of expandedQueries) {
                const score = this._fuzzyScore(q, text);
                bestScore = Math.max(bestScore, score);
            }
            
            // Bonus for action keyword match
            const action = item.dataset.action || '';
            for (const q of expandedQueries) {
                const actionScore = this._fuzzyScore(q, action.replace('nav:', '').replace(/-/g, ' '));
                bestScore = Math.max(bestScore, actionScore);
            }
            
            // Show if score passes threshold (or no query)
            item.style.display = (bestScore > 0.3 || !query.trim()) ? '' : 'none';
        });

        // Hide empty groups
        groups.forEach(group => {
            const visible = group.querySelectorAll('.cmd-palette-item:not([style*="display: none"])');
            group.style.display = visible.length ? '' : 'none';
        });

        this.cmdPaletteIndex = -1;
    },

    highlightPaletteItem(items) {
        items.forEach((item, i) => {
            item.classList.toggle('active', i === this.cmdPaletteIndex);
        });
        if (items[this.cmdPaletteIndex]) {
            items[this.cmdPaletteIndex].scrollIntoView({ block: 'nearest' });
        }
    },

    executeCommandPaletteAction(action) {
        this.closeCommandPalette();
        if (!action) return;

        const [type, value] = action.split(':');
        if (type === 'nav') {
            this.switchTab(value);
        } else if (type === 'action') {
            switch (value) {
                case 'save': this.saveAllChanges(); break;
                case 'refresh': this.loadTabData(this.currentTab); break;
            }
        }
    },

    // ── Sidebar ────────────────────────────────────────────────
    initSidebar() {
        const collapseBtn = document.getElementById('sidebar-collapse-btn');
        const mobileBtn = document.getElementById('mobile-menu-btn');
        const sidebar = document.getElementById('sidebar');

        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => this.toggleSidebar());
        }

        if (mobileBtn) {
            mobileBtn.addEventListener('click', () => {
                sidebar?.classList.toggle('mobile-open');
                this.toggleBackdrop(sidebar?.classList.contains('mobile-open'));
            });
        }

        if (localStorage.getItem('sidebar-collapsed') === 'true') {
            sidebar?.classList.add('collapsed');
        }
    },

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    },

    toggleBackdrop(show) {
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (show && !backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'sidebar-backdrop active';
            backdrop.addEventListener('click', () => {
                document.getElementById('sidebar')?.classList.remove('mobile-open');
                this.toggleBackdrop(false);
            });
            document.body.appendChild(backdrop);
        } else if (!show && backdrop) {
            backdrop.remove();
        }
    },

    // ── Breadcrumbs ────────────────────────────────────────────
    updateBreadcrumbs(tabName) {
        const el = document.getElementById('breadcrumb-current');
        if (!el) return;
        const names = {
            'overview': 'overview',
            'guild-settings': 'settings',
            'commands': 'commands & modules',
            'economy': 'balance & treasury',
            'shop': 'shop & marketplace',
            'fishing': 'fishing stats',
            'giveaways': 'giveaways',
            'moderation': 'mod tools',
            'reaction-roles': 'reaction roles',
            'statistics': 'command usage',
            'leaderboards': 'leaderboards',
            'mod-logs': 'mod logs',
            'activity': 'member activity'
        };
        el.textContent = names[tabName] || tabName;
    },

    // ── Keyboard Shortcuts ─────────────────────────────────────
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                this.openCommandPalette();
            }
            if (e.key === 'Escape') {
                this.closeCommandPalette();
            }
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                if (this.selectedServerId) this.saveAllChanges();
            }
        });
    },

    // ── Modal System ───────────────────────────────────────────
    showModal(title, content, onConfirm) {
        const overlay = document.getElementById('modal-overlay');
        const titleEl = document.getElementById('modal-title');
        const bodyEl = document.getElementById('modal-body');
        const confirmBtn = document.getElementById('modal-confirm');
        if (!overlay) return;
        if (titleEl) titleEl.textContent = title;
        if (bodyEl) bodyEl.innerHTML = content;
        overlay.classList.add('active');

        if (confirmBtn) {
            if (onConfirm) {
                confirmBtn.style.display = '';
                confirmBtn.onclick = onConfirm;
            } else {
                confirmBtn.style.display = 'none';
                confirmBtn.onclick = null;
            }
        }
    },

    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.remove('active');
        const confirmBtn = document.getElementById('modal-confirm');
        if (confirmBtn) confirmBtn.onclick = null;
    },

    // ── Form Enhancements ──────────────────────────────────────
    setupFormEnhancements() {
        this.setupFormValidation();
        this.setupSearchInputs();
    },

    setupFormValidation() {
        document.querySelectorAll('input, textarea, select').forEach(input => {
            input.addEventListener('blur', () => this.validateField(input));
            input.addEventListener('input', () => {
                if (input.classList.contains('error')) this.validateField(input);
            });
        });
    },

    validateField(input) {
        const value = input.value.trim();
        const type = input.type;
        const required = input.hasAttribute('required');
        input.classList.remove('error', 'success');
        const fb = input.parentNode?.querySelector('.feedback');
        if (fb) fb.remove();

        if (required && !value) {
            input.classList.add('error');
            return false;
        }
        if (value && type === 'number' && isNaN(value)) {
            input.classList.add('error');
            return false;
        }
        return true;
    },

    setupSearchInputs() {
        document.querySelectorAll('.search-input-wrap input').forEach(input => {
            let t;
            input.addEventListener('input', (e) => {
                clearTimeout(t);
                t = setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('dashboardSearch', {
                        detail: { input, query: e.target.value, type: input.dataset.searchType || 'general' }
                    }));
                }, 300);
            });
        });
    },

    // ── Visual Feedback ────────────────────────────────────────
    showDataUpdateIndicator() {
        const elements = document.querySelectorAll('.stat-number, .stat-card-value');
        elements.forEach(el => {
            el.style.transform = 'scale(1.05)';
            setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
        });
    }
};
