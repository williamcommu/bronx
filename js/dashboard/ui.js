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

    filterCommandPalette(query) {
        const results = document.getElementById('cmd-palette-results');
        if (!results) return;
        const items = results.querySelectorAll('.cmd-palette-item');
        const groups = results.querySelectorAll('.cmd-palette-group');
        const lq = query.toLowerCase();

        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(lq) ? '' : 'none';
        });

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
