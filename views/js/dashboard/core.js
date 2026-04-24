// ============================================================
//  dashboard/core.js — BronxBotDashboard core class
// ============================================================

import { formatNumber, formatCurrency, timeAgo } from './utils.js';
import { ApiMixin } from './api.js';
import { UiMixin } from './ui.js';
import { RealtimeMixin } from './realtime.js';

// Feature mixins
import { OverviewMixin } from './features/overview.js';
import { GuildSettingsMixin } from './features/guild-settings.js';
import { CommandsMixin } from './features/commands.js';
import { EconomyMixin } from './features/economy.js';
import { MarketMixin } from './features/market.js';
import { FishingMixin } from './features/fishing.js';
import { GiveawaysMixin } from './features/giveaways.js';
import { ModerationMixin } from './features/moderation.js';
import { ReactionRolesMixin } from './features/reaction-roles.js';
import { AutorolesMixin } from './features/autoroles.js';
import { StatisticsMixin } from './features/statistics.js';
import { UsersMixin } from './features/users.js';
import { MLSettingsMixin } from './features/ml-settings.js';

// Components
import { SearchableSelectManager } from './components/searchable-select.js';

/**
 * Main Dashboard Class
 * Composed of mixins for modularity
 */
class BronxBotDashboard {
    constructor() {
        this.currentGuild = null;
        this.selectedServerId = null;
        this.currentTab = 'overview';
        this.apiEndpoint = '/api';
        this.charts = {};
        this.isAuthenticated = false;
        this.user = null;
        this.userGuilds = [];
        this.socket = null;
        this.lastStatsUpdate = null;
        this.cmdPaletteIndex = -1;
        this.pendingChanges = false;
        this.economyMode = 'global';
        this.isBotOwner = false;
        this.realtimeData = {
            users: 0,
            commands: { total: 0, lastHour: 0 },
            economy: 0,
            fishing: { total: 0, today: 0 }
        };
        
        // Initialize searchable select manager for dropdowns
        this.selectManager = new SearchableSelectManager(this);
        
        this.initialize();
    }

    // ── Initialization ─────────────────────────────────────────
    async initialize() {
        // Guarantee splash is visible for at least 1.2s
        const splashMinTime = new Promise(r => setTimeout(r, 1200));

        try {
            await this.checkAuthentication();
            this.initializeRealtime();
            this.initCommandPalette();
            this.initSidebar();
            this.setupEventListeners();
            this.setupFormEnhancements();
            this.setupKeyboardShortcuts();
            
            // Background ticker for dynamic timestamps
            setInterval(() => this.updateDynamicTimestamps(), 60000);

            if (this.isAuthenticated) {
                await this.loadUserData();
                this.setupCharts();
            } else {
                // If not authenticated, check if visiting a public guild
                const urlParams = new URLSearchParams(window.location.search);
                const guildId = urlParams.get('server');
                if (guildId) {
                    this.selectedServerId = guildId;
                    this.currentGuild = guildId;
                    this.isGuest = true;
                    // Allow them to stay and load server data
                    await this.loadServerData();
                    this.setupCharts();
                } else {
                    window.location.href = '/servers';
                    return;
                }
            }
        } catch (err) {
            console.error('Dashboard initialization failed:', err);
        }

        // Wait for minimum splash display time before dismissing
        await splashMinTime;

        // Dismiss loading splash with a random exit animation
        const splash = document.getElementById('loading-splash');
        if (splash) {
            const exits = [
                'splash-out-fade',
                'splash-out-slide-up',
                'splash-out-slide-down',
                'splash-out-slide-left',
                'splash-out-slide-right',
                'splash-out-zoom-out',
                'splash-out-zoom-in',
                'splash-out-spin',
                'splash-out-flip-x',
                'splash-out-flip-y',
                'splash-out-rotate-scale',
                'splash-out-blur',
                'splash-out-glitch',
                'splash-out-door',
                'splash-out-diagonal',
                'splash-out-spiral',
                'splash-out-curtain',
                'splash-out-swing',
                'splash-out-bounce',
                'splash-out-skew',
                'splash-out-iris',
                'splash-out-split',
                'splash-out-dissolve',
                'splash-out-tilt',
                'splash-out-vortex'
            ];
            const pick = exits[Math.floor(Math.random() * exits.length)];
            splash.classList.add('splash-exit', pick);
            splash.addEventListener('animationend', () => splash.remove(), { once: true });
        }
    }

    // ── Authentication ─────────────────────────────────────────
    async checkAuthentication() {
        try {
            const response = await fetch('/api/auth/user', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    this.isAuthenticated = true;
                    this.user = data.user;
                    this.userGuilds = (data.guilds || []).filter(g => g && g.id && g.id !== 'undefined' && g.id !== 'null');
                    this.isBotOwner = data.isBotOwner || false;
                    return true;
                }
            }
            this.isAuthenticated = false;
            // Also check if we should allow guest mode
            const urlParams = new URLSearchParams(window.location.search);
            const serverId = urlParams.get('server');
            if (serverId) {
                // If authenticated but not in the server, mark as guest
                if (!this.userGuilds.some(g => g.id === serverId)) {
                    this.isGuest = true;
                }
                return true; 
            }
            
            return false;
        } catch (error) {
            console.error('Authentication check failed:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    async loadUserData() {
        this.updateUserInterface();

        const urlParams = new URLSearchParams(window.location.search);
        const serverId = urlParams.get('server');
        if (serverId && serverId !== 'undefined' && serverId !== 'null') {
            this.selectedServerId = serverId;
            const isMember = this.userGuilds.some(g => g.id === serverId);
            if (isMember) {
                this.updateServerIdentity(serverId);
            } else {
                this.isGuest = true;
            }
            await this.loadServerData();
        } else {
            window.location.href = '/servers';
        }
    }

    updateUserInterface() {
        const userInfo = document.getElementById('user-info');
        if (!userInfo) return;

        if (!this.isAuthenticated || !this.user) {
            userInfo.style.display = 'none';
            return;
        }

        userInfo.style.display = 'flex';
        const avatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');

        if (this.user.avatar) {
            avatar.src = `/api/proxy/avatar/${this.user.id}?hash=${this.user.avatar}&size=64`;
        } else {
            avatar.src = `/api/proxy/avatar/${this.user.id}`;
        }
        userName.textContent = this.user.global_name || this.user.username;
    }

    updateServerIdentity(serverId, metadata = null) {
        let guild = this.userGuilds.find(g => g.id === serverId);
        
        // Metadata fallback for guests
        const name = guild?.name || metadata?.guildName || 'Unknown Server';
        const icon = guild?.icon || metadata?.guildIcon;

        const identityWrap = document.getElementById('server-identity');
        const identityIcon = document.getElementById('server-identity-icon');
        const identityName = document.getElementById('server-identity-name');
        if (identityWrap) identityWrap.style.display = 'flex';
        if (identityIcon) {
            if (icon) {
                identityIcon.innerHTML = `<img src="/api/proxy/icon/${serverId}?hash=${icon}&size=64" alt="">`;
            } else {
                identityIcon.innerHTML = `<span>${(name || '?').charAt(0)}</span>`;
            }
        }
        if (identityName) identityName.textContent = name;

        const topbarName = document.getElementById('current-server-name');
        if (topbarName) topbarName.textContent = name;
    }

    // ── Event Listeners ────────────────────────────────────────
    setupEventListeners() {
        // Sidebar nav items
        document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
            item.addEventListener('click', () => {
                if (!this.isAuthenticated) {
                    this.toast('Please login first', 'warning');
                    return;
                }
                this.switchTab(item.getAttribute('data-tab'));
                document.getElementById('sidebar')?.classList.remove('mobile-open');
                this.toggleBackdrop(false);
            });
        });

        // Nav group collapse/expand
        document.querySelectorAll('.nav-group-header').forEach(header => {
            header.addEventListener('click', () => {
                const group = header.closest('.nav-group');
                if (group) group.classList.toggle('collapsed');
            });
        });

        // Save all changes
        const saveBtn = document.getElementById('save-all');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveAllChanges());
        }

        // Logout
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                window.location.href = '/logout';
            });
        }

        // Modal management
        const modalClose = document.getElementById('modal-close');
        const modalCancel = document.getElementById('modal-cancel');
        if (modalClose) modalClose.addEventListener('click', () => this.closeModal());
        if (modalCancel) modalCancel.addEventListener('click', () => this.closeModal());

        // Feature-specific listeners
        this.setupGuildSettingsListeners();
        this.setupCommandsListeners();
        this.setupEconomyListeners();
        this.setupShopListeners();
        this.setupFishingListeners();
        this.setupGiveawayListeners();
        this.setupModerationListeners();
        this.setupReactionRoleListeners();
        this.setupAutorolesListeners();
        this.setupStatisticsListeners();
        this.setupLeaderboardListeners();
        this.setupModLogListeners();
        this.setupFishingAnalyticsListeners();
        this.setupEconomyAnalyticsListeners();
        this.setupVoiceAnalyticsListeners();
        this.setupTopUsersListeners();
        this.setupHeatmapListeners();
        this.setupUserProfilesListeners();
        this.setupChannelAnalyticsListeners();
    }

    // ── Tab Management ─────────────────────────────────────────
    switchTab(tabName) {
        if (!this.selectedServerId && tabName !== 'overview') {
            this.toast('Please select a server first', 'warning');
            return;
        }

        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
        if (navItem) {
            navItem.classList.add('active');
            const group = navItem.closest('.nav-group');
            if (group) group.classList.remove('collapsed');
        }

        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const tab = document.getElementById(tabName);
        if (tab) tab.classList.add('active');

        this.updateBreadcrumbs(tabName);
        this.currentTab = tabName;
        this.loadTabData(tabName);
    }

    async loadTabData(tabName) {
        if (!this.currentGuild) return;
        switch (tabName) {
            case 'overview': await this.loadOverviewData(); break;
            case 'guild-settings': await this.loadGuildSettingsData(); break;
            case 'commands': await this.loadCommandsData(); break;
            case 'economy': await this.loadEconomyData(); break;
            case 'shop': await this.loadMarketData(); break;
            case 'fishing': await this.loadFishingAnalytics(); break;
            case 'giveaways': await this.loadGiveawaysData(); break;
            case 'moderation': await this.loadModerationData(); break;
            case 'reaction-roles': await this.loadReactionRolesData(); break;
            case 'autoroles': await this.loadAutorolesData(); break;
            case 'statistics': await this.loadStatisticsData(); break;
            case 'leaderboards': await this.loadLeaderboardData(); break;
            case 'mod-logs': await this.loadModLogsData(); break;
            case 'activity': await this.loadActivityData(); break;
            case 'economy-analytics': await this.loadEconomyAnalytics(); break;
            case 'gambling-analytics': await this.loadGamblingAnalytics(); break;
            case 'voice-analytics': await this.loadVoiceAnalytics(); break;
            case 'top-users': await this.loadTopUsersData(); break;
            case 'heatmap': await this.loadHeatmapData(); break;
            case 'user-profiles': break; // loaded on-demand via button
            case 'channel-analytics': await this.loadChannelAnalytics(); break;
            case 'role-classes': await this.loadRoleClassesData(); break;
        }
    }

    // ── Save All Changes ───────────────────────────────────────
    async saveAllChanges() {
        const saveBtn = document.getElementById('save-all');
        if (!saveBtn) return;
        const originalHTML = saveBtn.innerHTML;
        saveBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;"></div> Saving…';
        saveBtn.disabled = true;

        try {
            await this.apiCall('/settings/save-all', {
                method: 'POST',
                body: JSON.stringify({ tab: this.currentTab, guild: this.currentGuild })
            });
            this.toast('All changes saved!', 'success');
            this.pendingChanges = false;
        } catch (err) {
            this.toast('Error saving changes', 'error');
        } finally {
            saveBtn.innerHTML = originalHTML;
            saveBtn.disabled = false;
        }
    }

    // ── Load Server Data ───────────────────────────────────────
    async loadServerData() {
        if (!this.selectedServerId) return;

        const url = new URL(window.location);
        url.searchParams.set('server', this.selectedServerId);
        window.history.replaceState({}, '', url);

        this.currentGuild = this.selectedServerId;
        
        // Clear cached Discord data when switching guilds
        this.selectManager?.clearCache();

        const saveBtn = document.getElementById('save-all');
        if (saveBtn) saveBtn.style.display = this.isGuest ? 'none' : 'inline-flex';

        document.querySelectorAll('.tab-section').forEach(s => s.style.display = '');

        // Fetch settings early to get guild metadata (name/icon) for the UI identity
        try {
            const settings = await this.apiCall('/guild/settings');
            if (settings) {
                this.updateServerIdentity(this.selectedServerId, settings);
            }
        } catch (e) {
            console.warn('Failed to fetch guild metadata:', e);
        }

        this.switchTab(this.currentTab || 'overview');

        try {
            const modeRes = await this.apiCall('/economy/mode');
            this.economyMode = modeRes?.economy_mode || 'global';
        } catch (e) {
            this.economyMode = 'global';
        }
        this.applyEconomyModeGating();

        this.joinServerRoom(this.selectedServerId);

        if (this.isGuest) {
            this.applyGuestConstraints();
        }
    }

    applyGuestConstraints() {
        // Whitelist of allowed tabs for guest users
        const allowedTabs = [
            'overview',
            'statistics',
            'leaderboards',
            'activity',
            'top-users',
            'heatmap',
            'fishing',
            'voice-analytics',
            'channel-analytics'
        ];

        // Hide forbidden sidebar links
        document.querySelectorAll('.sidebar-nav li[data-tab]').forEach(li => {
            const tab = li.getAttribute('data-tab');
            if (!allowedTabs.includes(tab)) {
                li.style.display = 'none';
            }
        });

        // Hide specific sub-tabs or sections that might be redundant or sensitive
        const forbiddenSubTabs = ['user-profiles', 'economy-analytics', 'gambling-analytics'];
        forbiddenSubTabs.forEach(tab => {
            const el = document.querySelector(`.sidebar-nav li[data-tab="${tab}"]`);
            if (el) el.style.display = 'none';
        });

        // Hide empty categories
        document.querySelectorAll('.nav-group').forEach(group => {
            const items = group.querySelectorAll('.nav-item');
            const visibleItems = Array.from(items).filter(item => item.style.display !== 'none');
            if (visibleItems.length === 0) {
                group.style.display = 'none';
            }
        });

        // If currently on a forbidden tab, switch to overview
        if (!allowedTabs.includes(this.currentTab)) {
            this.switchTab('overview');
        }

        // Show guest notice
        const notice = document.createElement('div');
        notice.id = 'guest-notice';
        notice.style.cssText = `
            background: var(--accent-dim);
            color: var(--accent);
            padding: 0.5rem 1rem;
            text-align: center;
            font-size: 0.8rem;
            border-bottom: 1px solid var(--accent);
            animation: fadeIn 0.5s ease;
        `;
        notice.innerHTML = '<i class="fas fa-eye"></i> You are viewing this server in <strong>Public Mode</strong>. Login to manage your own servers.';
        document.querySelector('.top-bar')?.after(notice);
        
        // Hide save changes buttons
        const saveAll = document.getElementById('save-all');
        if (saveAll) saveAll.style.visibility = 'hidden';
    }

    // ── Utility Methods (instance) ─────────────────────────────
    formatCurrency(amount) {
        return formatCurrency(amount);
    }

    formatNumber(num) {
        return formatNumber(num);
    }

    timeAgo(date) {
        return timeAgo(date);
    }

    updateDynamicTimestamps() {
        const elements = document.querySelectorAll('[data-timestamp]');
        elements.forEach(el => {
            const ts = el.getAttribute('data-timestamp');
            if (ts) {
                el.textContent = timeAgo(ts);
            }
        });
    }

    // ── Misc Stubs ─────────────────────────────────────────────
    loadGlobalSettings() { /* No guild selected */ }
    loadGuildSettings() { this.loadGuildSettingsData(); }
}

// Apply all mixins to the prototype
Object.assign(BronxBotDashboard.prototype, ApiMixin);
Object.assign(BronxBotDashboard.prototype, UiMixin);
Object.assign(BronxBotDashboard.prototype, RealtimeMixin);
Object.assign(BronxBotDashboard.prototype, OverviewMixin);
Object.assign(BronxBotDashboard.prototype, GuildSettingsMixin);
Object.assign(BronxBotDashboard.prototype, CommandsMixin);
Object.assign(BronxBotDashboard.prototype, EconomyMixin);
Object.assign(BronxBotDashboard.prototype, MarketMixin);
Object.assign(BronxBotDashboard.prototype, FishingMixin);
Object.assign(BronxBotDashboard.prototype, GiveawaysMixin);
Object.assign(BronxBotDashboard.prototype, ModerationMixin);
Object.assign(BronxBotDashboard.prototype, ReactionRolesMixin);
Object.assign(BronxBotDashboard.prototype, AutorolesMixin);
Object.assign(BronxBotDashboard.prototype, StatisticsMixin);
Object.assign(BronxBotDashboard.prototype, UsersMixin);
Object.assign(BronxBotDashboard.prototype, MLSettingsMixin);

export { BronxBotDashboard };
