// Dashboard JavaScript - Main functionality
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
        this.realtimeData = {
            users: 0,
            commands: { total: 0, lastHour: 0 },
            economy: 0,
            fishing: { total: 0, today: 0 }
        };
        this.initialize();
    }

    async initialize() {
        await this.checkAuthentication();
        this.initializeRealtime();
        this.setupEventListeners();
        this.setupFormEnhancements();
        
        if (this.isAuthenticated) {
            await this.loadUserData();
            this.setupCharts();
        } else {
            this.showLoginPrompt();
        }
    }

    initializeRealtime() {
        // Initialize Socket.io connection
        this.socket = io();
        this.setupSocketListeners();
        this.updateConnectionStatus('connecting');
    }

    setupSocketListeners() {
        // Connection events
        this.socket.on('connect', () => {
            console.log('🌐 Connected to real-time server');
            this.updateConnectionStatus('connected');
            this.showLiveNotification('Connected to real-time updates', 'success');
        });

        this.socket.on('disconnect', () => {
            console.log('🔌 Disconnected from real-time server');
            this.updateConnectionStatus('disconnected');
            this.showLiveNotification('Lost connection to real-time updates', 'error');
        });

        // Database ping events
        this.socket.on('db-ping', (data) => {
            this.updateDatabaseStatus(data);
        });

        // Stats update events (global bot-health only — do NOT use for per-guild UI)
        this.socket.on('stats-update', (stats) => {
            this.lastStatsUpdate = new Date();
            this.realtimeData = stats;
            // Do NOT call updateRealtimeStats with global data here;
            // per-guild updates come via 'server-stats-update' below.
            if (this.charts.overview) {
                this.updateChartsWithRealtime(stats);
            }
            this.showDataUpdateIndicator();
        });

        // Per-guild realtime stats — scoped to the selected server
        this.socket.on('server-stats-update', (stats) => {
            if (
                this.currentTab === 'overview' &&
                stats.guildId === this.currentGuild
            ) {
                this.updateOverviewStats(stats);
            }
        });

        // Initial stats when connecting
        this.socket.on('initial-stats', (data) => {
            console.log('📊 Received initial stats', data);
            if (data.serverStats) {
                document.getElementById('live-users-count').textContent = data.serverStats.connectedClients;
            }
        });

        // API stats updates
        this.socket.on('api-stats-update', (data) => {
            this.updateApiStats(data);
        });

        // Manual updates (for testing)
        this.socket.on('manual-update', (stats) => {
            this.showLiveNotification('Manual update received', 'success');
            this.updateRealtimeStats(stats);
        });
    }

    updateConnectionStatus(status) {
        const socketStatus = document.getElementById('socket-status');
        if (socketStatus) {
            socketStatus.className = `status-indicator ${status}`;
            socketStatus.title = `Real-time Connection: ${status}`;
        }
    }

    updateDatabaseStatus(data) {
        const dbStatus = document.getElementById('db-status');
        if (dbStatus) {
            if (data.status === 'connected') {
                dbStatus.className = 'status-indicator connected';
                dbStatus.title = `Database: Connected (${data.responseTime}ms)`;
            } else {
                dbStatus.className = 'status-indicator disconnected';
                dbStatus.title = `Database: Error - ${data.error}`;
            }
        }
    }

    updateRealtimeStats(stats) {
        if (!stats) return;

        // Socket stats are GLOBAL (no guild filter) — do NOT use them to update
        // per-server stat cards. Instead, re-fetch per-guild data from the REST API
        // so that overview numbers always reflect the selected server only.
        if (this.currentTab === 'overview' && this.selectedServerId) {
            this.loadOverviewData();
        }

        // Update any charts with new data
        if (this.charts.overview) {
            this.updateChartsWithRealtime(stats);
        }

        // Show subtle update indicator
        this.showDataUpdateIndicator();
    }

    updateApiStats(data) {
        // Could display API call rate somewhere in the UI
        console.log('API Stats:', data);
    }

    showLiveNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `live-update-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    showDataUpdateIndicator() {
        // Add a subtle pulse animation or indicator
        const elements = document.querySelectorAll('.stat-number');
        elements.forEach(el => {
            el.style.transform = 'scale(1.05)';
            setTimeout(() => {
                el.style.transform = 'scale(1)';
            }, 200);
        });
    }

    updateChartsWithRealtime(stats) {
        // Update charts with new real-time data
        // This would depend on what charts are currently displayed
        if (this.charts.activity && stats.commands) {
            // Example: Add new data point to activity chart
            const chart = this.charts.activity;
            const now = new Date();
            
            // Add new data point
            chart.data.labels.push(now.toLocaleTimeString());
            chart.data.datasets[0].data.push(stats.commands.lastHour);
            
            // Remove old data points (keep last 20)
            if (chart.data.labels.length > 20) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }
            
            chart.update('none'); // Update without animation for smooth real-time
        }
    }

    // Join server room for targeted updates
    joinServerRoom(serverId) {
        if (this.socket && serverId) {
            this.socket.emit('join-server', serverId);
        }
    }

    leaveServerRoom(serverId) {
        if (this.socket && serverId) {
            this.socket.emit('leave-server', serverId);
        }
    }

    setupFormEnhancements() {
        // Add form validation and interactive features
        this.setupFloatingLabels();
        this.setupFormValidation();
        this.setupFileUploads();
        this.setupSearchInputs();
        this.setupToggleSwitches();
        this.setupButtonLoadingStates();
    }

    setupFloatingLabels() {
        document.querySelectorAll('.floating-label input, .floating-label textarea').forEach(input => {
            // Set initial state
            this.updateFloatingLabel(input);
            
            input.addEventListener('input', () => this.updateFloatingLabel(input));
            input.addEventListener('focus', () => this.updateFloatingLabel(input));
            input.addEventListener('blur', () => this.updateFloatingLabel(input));
        });
    }

    updateFloatingLabel(input) {
        const label = input.nextElementSibling;
        if (label && label.tagName === 'LABEL') {
            if (input.value || input === document.activeElement) {
                label.style.transform = 'translateY(0.25rem)';
                label.style.fontSize = '0.75rem';
                label.style.color = input === document.activeElement ? 'var(--primary-color)' : 'var(--text-muted)';
            } else {
                label.style.transform = 'translateY(1rem)';
                label.style.fontSize = '0.875rem';
                label.style.color = 'var(--text-muted)';
            }
        }
    }

    setupFormValidation() {
        document.querySelectorAll('form').forEach(form => {
            form.addEventListener('submit', (e) => {
                if (!this.validateForm(form)) {
                    e.preventDefault();
                }
            });
        });

        // Real-time validation
        document.querySelectorAll('input, textarea, select').forEach(input => {
            input.addEventListener('blur', () => this.validateField(input));
            input.addEventListener('input', () => {
                if (input.classList.contains('error')) {
                    this.validateField(input);
                }
            });
        });
    }

    validateForm(form) {
        let isValid = true;
        form.querySelectorAll('input, textarea, select').forEach(input => {
            if (!this.validateField(input)) {
                isValid = false;
            }
        });
        return isValid;
    }

    validateField(input) {
        const value = input.value.trim();
        const type = input.type;
        const required = input.hasAttribute('required');
        
        this.clearFieldValidation(input);
        
        // Required validation
        if (required && !value) {
            this.setFieldError(input, 'This field is required');
            return false;
        }
        
        // Type-specific validation
        if (value) {
            switch (type) {
                case 'email':
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                        this.setFieldError(input, 'Please enter a valid email address');
                        return false;
                    }
                    break;
                case 'url':
                    if (!/^https?:\/\/.+/.test(value)) {
                        this.setFieldError(input, 'Please enter a valid URL');
                        return false;
                    }
                    break;
                case 'number':
                    if (isNaN(value)) {
                        this.setFieldError(input, 'Please enter a valid number');
                        return false;
                    }
                    break;
            }
            
            // Custom validation based on input name or class
            if (input.name === 'prefix' && value.length > 10) {
                this.setFieldError(input, 'Prefix must be 10 characters or less');
                return false;
            }
            
            if (input.classList.contains('user-id') && !/^\d{17,19}$/.test(value)) {
                this.setFieldError(input, 'Please enter a valid Discord User ID (17-19 digits)');
                return false;
            }
            
            if (input.classList.contains('channel-id') && !/^\d{17,19}$/.test(value)) {
                this.setFieldError(input, 'Please enter a valid Discord Channel ID (17-19 digits)');
                return false;
            }
        }
        
        this.setFieldSuccess(input);
        return true;
    }

    clearFieldValidation(input) {
        input.classList.remove('error', 'success');
        const feedback = input.parentNode.querySelector('.feedback');
        if (feedback) {
            feedback.remove();
        }
    }

    setFieldError(input, message) {
        input.classList.add('error');
        input.classList.remove('success');
        
        const feedback = document.createElement('div');
        feedback.className = 'feedback error';
        feedback.innerHTML = `<span>⚠</span> ${message}`;
        
        input.parentNode.appendChild(feedback);
    }

    setFieldSuccess(input) {
        input.classList.add('success');
        input.classList.remove('error');
        
        const feedback = document.createElement('div');
        feedback.className = 'feedback success';
        feedback.innerHTML = `<span>✓</span> Looks good!`;
        
        input.parentNode.appendChild(feedback);
    }

    setupFileUploads() {
        document.querySelectorAll('.file-upload input[type="file"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const label = e.target.parentNode.querySelector('.file-upload-label');
                const fileName = e.target.files[0]?.name || 'Choose file...';
                
                if (e.target.files[0]) {
                    label.innerHTML = `📁 ${fileName}`;
                    label.style.color = 'var(--success-color)';
                    label.style.borderColor = 'var(--success-color)';
                } else {
                    label.innerHTML = '📎 Choose file...';
                    label.style.color = 'var(--text-muted)';
                    label.style.borderColor = 'var(--border-color)';
                }
            });
        });
    }

    setupSearchInputs() {
        document.querySelectorAll('.search-input input').forEach(input => {
            let searchTimeout;
            
            input.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.handleSearch(input, e.target.value);
                }, 300);
            });
        });
    }

    handleSearch(input, query) {
        // Emit custom search event that other parts of the app can listen to
        const event = new CustomEvent('dashboardSearch', {
            detail: {
                input: input,
                query: query,
                type: input.getAttribute('data-search-type') || 'general'
            }
        });
        document.dispatchEvent(event);
    }

    setupToggleSwitches() {
        document.querySelectorAll('.toggle-switch input').forEach(input => {
            input.addEventListener('change', (e) => {
                const customEvent = new CustomEvent('toggleChange', {
                    detail: {
                        input: e.target,
                        checked: e.target.checked,
                        name: e.target.name
                    }
                });
                document.dispatchEvent(customEvent);
            });
        });
    }

    setupButtonLoadingStates() {
        document.querySelectorAll('.btn').forEach(button => {
            button.addEventListener('click', (e) => {
                if (button.hasAttribute('data-loading')) {
                    this.setButtonLoading(button, true);
                    
                    // Auto-clear loading state after 5 seconds to prevent stuck buttons
                    setTimeout(() => {
                        this.setButtonLoading(button, false);
                    }, 5000);
                }
            });
        });
    }

    setButtonLoading(button, loading) {
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }

    setupEventListeners() {
        // Sidebar navigation
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!this.isAuthenticated) {
                    this.showNotification('Please login first', 'warning');
                    return;
                }
                this.switchTab(e.currentTarget.getAttribute('data-tab'));
            });
        });

        // Category collapse/expand
        document.querySelectorAll('.category-header').forEach(header => {
            header.addEventListener('click', () => {
                const collapseId = header.getAttribute('data-collapse');
                const items = document.getElementById(`${collapseId}-items`);
                if (items) {
                    header.classList.toggle('collapsed');
                    items.classList.toggle('collapsed');
                }
            });
        });

        // Server selector — custom dropdown
        document.addEventListener('click', (e) => {
            const trigger = document.getElementById('server-dropdown-trigger');
            const list = document.getElementById('server-dropdown-list');
            const dropdown = document.getElementById('server-dropdown-custom');
            if (!trigger || !list) return;

            if (trigger.contains(e.target)) {
                const open = dropdown.classList.toggle('open');
                list.style.display = open ? 'block' : 'none';
            } else if (!list.contains(e.target)) {
                dropdown.classList.remove('open');
                list.style.display = 'none';
            }
        });

        document.addEventListener('click', (e) => {
            const item = e.target.closest('[data-server-id]');
            if (!item) return;
            const serverId = item.getAttribute('data-server-id');
            if (!serverId) return;
            this.selectedServerId = serverId;
            this.setSelectedServer(serverId);
            document.getElementById('server-dropdown-custom').classList.remove('open');
            document.getElementById('server-dropdown-list').style.display = 'none';
            this.loadServerData();
        });

        // Save all changes
        const saveBtn = document.getElementById('save-all');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveAllChanges();
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                window.location.href = '/logout';
            });
        }

        // Modal management
        document.getElementById('modal-close').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('modal-cancel').addEventListener('click', () => {
            this.closeModal();
        });

        // Guild Settings
        this.setupGuildSettingsListeners();

        // Commands & Modules
        this.setupCommandsListeners();

        // Economy Management
        this.setupEconomyListeners();

        // Shop & Marketplace
        this.setupShopListeners();

        // Fishing System
        this.setupFishingListeners();

        // Giveaways
        this.setupGiveawayListeners();

        // Moderation
        this.setupModerationListeners();

        // Reaction Roles
        this.setupReactionRoleListeners();

        // Statistics
        this.setupStatisticsListeners();

        // ML Settings
        this.setupMLSettingsListeners();

        // User Management
        this.setupUserManagementListeners();
    }

    setupGuildSettingsListeners() {
        // Add blocked channel
        document.getElementById('add-blocked-channel').addEventListener('click', () => {
            this.addBlockedChannel();
        });

        // Add custom prefix
        document.getElementById('add-prefix').addEventListener('click', () => {
            this.addCustomPrefix();
        });
    }

    setupCommandsListeners() {
        // Command search
        document.getElementById('command-search').addEventListener('input', (e) => {
            this.filterCommands(e.target.value);
        });

        // Add scope rule
        document.getElementById('add-scope-rule').addEventListener('click', () => {
            this.addScopeRule();
        });

        // Module toggles
        document.querySelectorAll('[data-module]').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                this.toggleModule(e.target.getAttribute('data-module'), e.target.checked);
            });
        });
    }

    setupEconomyListeners() {
        // User search
        document.getElementById('search-user').addEventListener('click', () => {
            this.searchUser();
        });

        // Adjust guild balance
        document.getElementById('adjust-guild-balance').addEventListener('click', () => {
            this.adjustGuildBalance();
        });
    }

    setupShopListeners() {
        // Add shop item
        document.getElementById('add-shop-item').addEventListener('click', () => {
            this.showAddShopItemModal();
        });

        // Add daily deal
        document.getElementById('add-daily-deal').addEventListener('click', () => {
            this.addDailyDeal();
        });
    }

    setupFishingListeners() {
        // View fishing logs
        document.getElementById('view-fishing-logs').addEventListener('click', () => {
            this.viewFishingLogs();
        });

        // Download fishing data
        document.getElementById('download-fishing-data').addEventListener('click', () => {
            this.downloadFishingData();
        });
    }

    setupGiveawayListeners() {
        // Create giveaway
        document.getElementById('create-giveaway').addEventListener('click', () => {
            this.createGiveaway();
        });

        // Load giveaway history
        document.getElementById('load-giveaway-history').addEventListener('click', () => {
            this.loadGiveawayHistory();
        });
    }

    setupModerationListeners() {
        // Add autopurge
        document.getElementById('add-autopurge').addEventListener('click', () => {
            this.addAutopurge();
        });

        // Blacklist/Whitelist management
        document.getElementById('add-blacklist').addEventListener('click', () => {
            this.addToBlacklist();
        });

        document.getElementById('add-whitelist').addEventListener('click', () => {
            this.addToWhitelist();
        });
    }

    setupReactionRoleListeners() {
        // Add reaction role
        document.getElementById('add-reaction-role').addEventListener('click', () => {
            this.addReactionRole();
        });
    }

    setupStatisticsListeners() {
        // Leaderboard tabs
        document.querySelectorAll('[data-leaderboard]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchLeaderboard(e.target.getAttribute('data-leaderboard'));
            });
        });
    }

    setupMLSettingsListeners() {
        // Add ML setting
        document.getElementById('add-ml-setting').addEventListener('click', () => {
            this.addMLSetting();
        });
    }

    setupUserManagementListeners() {
        // Search users
        document.getElementById('search-users').addEventListener('click', () => {
            this.searchUsers();
        });

        // Grant badge
        document.getElementById('grant-badge').addEventListener('click', () => {
            this.grantBadge();
        });

        // Revoke badge
        document.getElementById('revoke-badge').addEventListener('click', () => {
            this.revokeBadge();
        });
    }

    // Tab Management
    switchTab(tabName) {
        // Check if server is selected for non-overview tabs
        if (!this.selectedServerId && tabName !== 'overview') {
            this.showNotification('Please select a server first', 'warning');
            // Still allow switching but data won't load
        }
        
        // Update sidebar
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');

        // Update page title
        const titles = {
            'overview': 'Dashboard Overview',
            'guild-settings': 'Guild Settings',
            'commands': 'Commands & Modules',
            'economy': 'Economy Management',
            'shop': 'Shop & Marketplace',
            'fishing': 'Fishing System',
            'giveaways': 'Giveaways',
            'moderation': 'Moderation',
            'reaction-roles': 'Reaction Roles',
            'statistics': 'Statistics',
            'ml-settings': 'ML Settings',
            'users': 'User Management'
        };
        
        document.getElementById('page-title').textContent = titles[tabName] || tabName;
        this.currentTab = tabName;

        // Load tab-specific data
        this.loadTabData(tabName);
    }

    // Authentication Methods
    async checkAuthentication() {
        try {
            const response = await fetch('/api/auth/user', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    this.isAuthenticated = true;
                    this.user = data.user;
                    this.userGuilds = data.guilds || [];
                    return true;
                }
            }
            
            this.isAuthenticated = false;
            return false;
        } catch (error) {
            console.error('Authentication check failed:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    async loadUserData() {
        this.updateUserInterface();
        this.populateServerSelector();
        
        // Check for server ID in URL
        const urlParams = new URLSearchParams(window.location.search);
        const serverId = urlParams.get('server');
        
        if (serverId && this.userGuilds.some(g => g.id === serverId)) {
            this.selectedServerId = serverId;
            this.setSelectedServer(serverId);
            await this.loadServerData();
        }
    }

    updateUserInterface() {
        // Hide login prompt, show user info
        document.getElementById('login-prompt').style.display = 'none';
        document.getElementById('user-info').style.display = 'block';
        document.getElementById('server-selection').style.display = 'block';
        
        // Update user info
        const avatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');
        
        if (this.user.avatar) {
            avatar.src = `https://cdn.discordapp.com/avatars/${this.user.id}/${this.user.avatar}.png?size=64`;
        } else {
            avatar.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
        }
        
        userName.textContent = this.user.global_name || this.user.username;
    }

    populateServerSelector() {
        const list = document.getElementById('server-dropdown-list');
        if (!list) return;
        list.innerHTML = '';

        if (this.userGuilds.length === 0) {
            list.innerHTML = '<div class="server-dropdown-empty">No servers found</div>';
            return;
        }

        this.userGuilds.forEach(guild => {
            const iconUrl = guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
                : null;

            const item = document.createElement('div');
            item.className = 'server-dropdown-item';
            item.setAttribute('data-server-id', guild.id);
            item.innerHTML = `
                <div class="server-option-icon">
                    ${iconUrl
                        ? `<img src="${iconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                           <span class="server-initial" style="display:none">${guild.name.charAt(0)}</span>`
                        : `<span class="server-initial">${guild.name.charAt(0)}</span>`
                    }
                </div>
                <span class="server-option-name">${guild.name}</span>
            `;
            list.appendChild(item);
        });
    }

    setSelectedServer(serverId) {
        const guild = this.userGuilds.find(g => g.id === serverId);
        if (!guild) return;

        const iconEl = document.getElementById('selected-server-icon');
        const nameEl = document.getElementById('selected-server-name');
        const iconUrl = guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
            : null;

        if (iconEl) {
            iconEl.innerHTML = iconUrl
                ? `<img src="${iconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                   <span class="server-initial" style="display:none">${guild.name.charAt(0)}</span>`
                : `<span class="server-initial">${guild.name.charAt(0)}</span>`;
        }
        if (nameEl) nameEl.textContent = guild.name;

        // Mark active item
        document.querySelectorAll('.server-dropdown-item').forEach(el => {
            el.classList.toggle('active', el.getAttribute('data-server-id') === serverId);
        });
    }

    showLoginPrompt() {
        document.getElementById('login-prompt').style.display = 'block';
        document.getElementById('user-info').style.display = 'none';
        document.getElementById('server-selection').style.display = 'none';
        
        // Hide main content sections that require authentication
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.style.display = 'none';
        });
        
        // Show a welcome message
        this.showWelcomeMessage();
    }

    showWelcomeMessage() {
        const overviewTab = document.getElementById('overview-tab');
        if (overviewTab) {
            overviewTab.innerHTML = `
                <div class="welcome-container">
                    <div class="welcome-header">
                        <i class="fas fa-robot welcome-icon"></i>
                        <h1>Welcome to Bronx Bot Dashboard</h1>
                        <p>Please login with Discord to access your server settings</p>
                        <a href="/login" class="btn btn-primary">
                            <i class="fab fa-discord"></i> Login with Discord
                        </a>
                    </div>
                </div>
            `;
            overviewTab.style.display = 'block';
        }
    }

    async loadOverviewData() {
        // Load overview statistics
        const stats = await this.apiCall('/stats/overview');
        
        const prompt = document.getElementById('server-select-prompt');
        const content = document.getElementById('overview-content');
        
        if (stats && stats.noServerSelected) {
            // Show server selection prompt, hide content
            if (prompt) prompt.style.display = 'flex';
            if (content) content.style.display = 'none';
            return;
        }
        
        // Hide prompt, show content
        if (prompt) prompt.style.display = 'none';
        if (content) content.style.display = 'block';
        
        if (stats) {
            this.updateOverviewStats(stats);
        }

        // Load recent activity
        const activity = await this.apiCall('/stats/recent-activity');
        if (activity) {
            this.updateRecentActivity(activity);
        }
    }

    async loadGuildData() {
        if (this.currentGuild === 'global') {
            // Load global settings
            await this.loadGlobalSettings();
        } else {
            // Load guild-specific settings
            await this.loadGuildSettings(this.currentGuild);
        }
    }

    async loadTabData(tabName) {
        switch (tabName) {
            case 'overview':
                await this.loadOverviewData();
                break;
            case 'guild-settings':
                await this.loadGuildSettingsData();
                break;
            case 'commands':
                await this.loadCommandsData();
                break;
            case 'economy':
                await this.loadEconomyData();
                break;
            case 'shop':
                await this.loadShopData();
                break;
            case 'fishing':
                await this.loadFishingData();
                break;
            case 'giveaways':
                await this.loadGiveawaysData();
                break;
            case 'moderation':
                await this.loadModerationData();
                break;
            case 'reaction-roles':
                await this.loadReactionRolesData();
                break;
            case 'statistics':
                await this.loadStatisticsData();
                break;
            case 'ml-settings':
                await this.loadMLSettingsData();
                break;
            case 'users':
                await this.loadUsersData();
                break;
        }
    }

    // API Communication
    async apiCall(endpoint, options = {}) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            if (this.currentGuild) {
                headers['X-Guild-ID'] = this.currentGuild;
            }
            const response = await fetch(`${this.apiEndpoint}${endpoint}`, {
                credentials: 'include',
                headers,
                ...options
            });

            if (!response.ok) {
                // Only throw for user-initiated actions (POST, PUT, DELETE), not GET requests
                const isUserAction = options.method && options.method !== 'GET';
                if (isUserAction) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                // For GET requests, just log and return null silently
                console.warn(`API ${endpoint}: ${response.status}`);
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('API call failed:', error);
            // Only show notification for user-initiated actions
            const isUserAction = options.method && options.method !== 'GET';
            if (isUserAction) {
                this.showNotification(`API Error: ${error.message}`, 'error');
            }
            return null;
        }
    }

    // Guild Settings Functions
    async loadGuildSettingsData() {
        const settings = await this.apiCall('/guild/settings');
        if (settings) {
            document.getElementById('guild-prefix').value = settings.prefix || 'bb ';
            document.getElementById('logging-enabled').checked = settings.logging_enabled || false;
            // Update other guild settings fields
        }

        const blockedChannels = await this.apiCall('/guild/blocked-channels');
        if (blockedChannels) {
            this.updateBlockedChannelsList(blockedChannels);
        }

        const customPrefixes = await this.apiCall('/guild/custom-prefixes');
        if (customPrefixes) {
            this.updateCustomPrefixesList(customPrefixes);
        }
    }

    addBlockedChannel() {
        this.showModal('Add Blocked Channel', `
            <div class="form-group">
                <label>Channel ID</label>
                <input type="text" id="modal-channel-id" placeholder="Enter channel ID...">
            </div>
        `, () => {
            const channelId = document.getElementById('modal-channel-id').value;
            if (channelId) {
                this.apiCall('/guild/blocked-channels', {
                    method: 'POST',
                    body: JSON.stringify({ channel_id: channelId })
                }).then(() => {
                    this.loadGuildSettingsData();
                    this.closeModal();
                });
            }
        });
    }

    addCustomPrefix() {
        const prefix = document.getElementById('new-prefix').value.trim();
        if (prefix) {
            this.apiCall('/guild/custom-prefixes', {
                method: 'POST',
                body: JSON.stringify({ prefix })
            }).then(() => {
                document.getElementById('new-prefix').value = '';
                this.loadGuildSettingsData();
            });
        }
    }

    // Commands Functions
    async loadCommandsData() {
        const modules = await this.apiCall('/modules');
        if (modules) {
            this.updateModuleToggles(modules);
        }

        const commands = await this.apiCall('/commands');
        if (commands) {
            this.updateCommandsList(commands);
        }

        const scopeRules = await this.apiCall('/scope-rules');
        if (scopeRules) {
            this.updateScopeRulesList(scopeRules);
        }
    }

    filterCommands(searchTerm) {
        const commandItems = document.querySelectorAll('.command-toggle-item');
        commandItems.forEach(item => {
            const commandName = item.dataset.command;
            if (commandName.toLowerCase().includes(searchTerm.toLowerCase())) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    toggleModule(moduleName, enabled) {
        this.apiCall('/modules/toggle', {
            method: 'POST',
            body: JSON.stringify({ 
                module: moduleName, 
                enabled 
            })
        });
    }

    // Economy Functions
    async loadEconomyData() {
        const guildBalance = await this.apiCall('/economy/guild-balance');
        if (guildBalance) {
            this.updateGuildBalance(guildBalance);
        }

        const interestSettings = await this.apiCall('/economy/interest-settings');
        if (interestSettings) {
            this.updateInterestSettings(interestSettings);
        }
    }

    searchUser() {
        const searchTerm = document.getElementById('user-search').value.trim();
        if (searchTerm) {
            this.apiCall(`/users/search?q=${encodeURIComponent(searchTerm)}`)
                .then(users => {
                    this.displayUserEconomyResults(users);
                });
        }
    }

    adjustGuildBalance() {
        this.showModal('Adjust Guild Balance', `
            <div class="form-group">
                <label>Adjustment Amount (positive or negative)</label>
                <input type="number" id="modal-balance-adjustment" step="1">
            </div>
            <div class="form-group">
                <label>Reason</label>
                <textarea id="modal-adjustment-reason" rows="3" placeholder="Enter reason for adjustment..."></textarea>
            </div>
        `, () => {
            const adjustment = parseInt(document.getElementById('modal-balance-adjustment').value);
            const reason = document.getElementById('modal-adjustment-reason').value;
            
            if (adjustment !== 0) {
                this.apiCall('/economy/guild-balance/adjust', {
                    method: 'POST',
                    body: JSON.stringify({ adjustment, reason })
                }).then(() => {
                    this.loadEconomyData();
                    this.closeModal();
                });
            }
        });
    }

    // Shop Functions
    async loadShopData() {
        const shopItems = await this.apiCall('/shop/items');
        if (shopItems) {
            this.updateShopItemsTable(shopItems);
            this.populateDealItemDropdown(shopItems);
        }

        const dailyDeals = await this.apiCall('/shop/daily-deals');
        if (dailyDeals) {
            this.updateDailyDealsList(dailyDeals);
        }

        const bazaarStats = await this.apiCall('/bazaar/stats');
        if (bazaarStats) {
            this.updateBazaarStats(bazaarStats);
        }
    }

    populateDealItemDropdown(items) {
        const select = document.getElementById('deal-item-select');
        if (!select || !items) return;
        
        // Keep the placeholder option and add all shop items
        select.innerHTML = '<option value="">Select item...</option>' + 
            items.map(item => `<option value="${item.item_id}">${item.name} ($${Number(item.price).toLocaleString()})</option>`).join('');
    }

    showAddShopItemModal() {
        this.showModal('Add Shop Item', `
            <div class="form-group">
                <label>Item ID</label>
                <input type="text" id="modal-item-id" placeholder="unique_item_id">
            </div>
            <div class="form-group">
                <label>Item Name</label>
                <input type="text" id="modal-item-name" placeholder="Display Name">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="modal-item-description" rows="2" placeholder="Item description..."></textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category</label>
                    <select id="modal-item-category">
                        <option value="potion">Potion</option>
                        <option value="upgrade">Upgrade</option>
                        <option value="rod">Fishing Rod</option>
                        <option value="bait">Bait</option>
                        <option value="collectible">Collectible</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Price</label>
                    <input type="number" id="modal-item-price" min="1">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" id="modal-item-level" min="1" value="1">
                </div>
                <div class="form-group">
                    <label>Max Quantity (optional)</label>
                    <input type="number" id="modal-item-max-qty">
                </div>
            </div>
        `, () => {
            this.submitShopItem();
        });
    }

    submitShopItem() {
        const itemData = {
            item_id: document.getElementById('modal-item-id').value,
            name: document.getElementById('modal-item-name').value,
            description: document.getElementById('modal-item-description').value,
            category: document.getElementById('modal-item-category').value,
            price: parseInt(document.getElementById('modal-item-price').value),
            level: parseInt(document.getElementById('modal-item-level').value),
            max_quantity: document.getElementById('modal-item-max-qty').value || null
        };

        this.apiCall('/shop/items', {
            method: 'POST',
            body: JSON.stringify(itemData)
        }).then(() => {
            this.loadShopData();
            this.closeModal();
        });
    }

    // Charts Setup
    setupCharts() {
        // Activity Chart
        const activityCtx = document.getElementById('activity-chart')?.getContext('2d');
        if (activityCtx) {
            this.charts.activity = new Chart(activityCtx, {
                type: 'line',
                data: {
                    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
                    datasets: [{
                        label: 'Commands per Hour',
                        data: [12, 8, 15, 25, 22, 18],
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#f8fafc'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#475569' }
                        },
                        y: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#475569' }
                        }
                    }
                }
            });
        }

        // Command Usage Chart
        const commandCtx = document.getElementById('command-usage-chart')?.getContext('2d');
        if (commandCtx) {
            this.charts.commands = new Chart(commandCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Economy', 'Fishing', 'Gambling', 'Moderation', 'Fun'],
                    datasets: [{
                        data: [35, 25, 20, 10, 10],
                        backgroundColor: [
                            '#667eea',
                            '#764ba2',
                            '#10b981',
                            '#f59e0b',
                            '#ef4444'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#f8fafc'
                            }
                        }
                    }
                }
            });
        }

        // Price Changes Chart
        const priceCtx = document.getElementById('price-changes-chart')?.getContext('2d');
        if (priceCtx) {
            this.charts.priceChanges = new Chart(priceCtx, {
                type: 'bar',
                data: {
                    labels: ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'],
                    datasets: [{
                        label: 'Price Adjustments',
                        data: [150, -75, 200, -100, 300],
                        backgroundColor: function(context) {
                            return context.parsed.y >= 0 ? '#10b981' : '#ef4444';
                        }
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#f8fafc'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#475569' }
                        },
                        y: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#475569' }
                        }
                    }
                }
            });
        }
    }

    // Utility Functions
    showModal(title, content, onConfirm) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        document.getElementById('modal-overlay').style.display = 'block';
        
        if (onConfirm) {
            document.getElementById('modal-confirm').onclick = onConfirm;
        }
    }

    closeModal() {
        document.getElementById('modal-overlay').style.display = 'none';
        document.getElementById('modal-confirm').onclick = null;
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: var(--text-muted); cursor: pointer;">×</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    updateOverviewStats(stats) {
        // Update stat cards with real data — scoped to overview content section
        const section = document.getElementById('overview-content');
        if (!section) return;
        const statNumbers = section.querySelectorAll('.stat-number');
        const econVal = parseFloat(stats.totalEconomyValue) || 0;
        // Card 0: member count from Discord API (this server) — only update if explicitly provided
        if (statNumbers[0] && stats.memberCount !== undefined) {
            statNumbers[0].textContent = stats.memberCount != null
                ? Number(stats.memberCount).toLocaleString()
                : '—';
        }
        if (statNumbers[1]) statNumbers[1].textContent = '$' + formatNumber(econVal);
        if (statNumbers[2]) statNumbers[2].textContent = (stats.commandsToday ?? 0).toLocaleString();
        if (statNumbers[3]) statNumbers[3].textContent = (stats.fishCaughtToday ?? 0).toLocaleString();
    }

    updateRecentActivity(activities) {
        const activityList = document.querySelector('#overview-content .activity-list');
        if (!activityList) return;
        
        if (!activities || activities.length === 0) {
            activityList.innerHTML = `
                <div class="activity-item activity-empty">
                    <i class="fas fa-info-circle"></i>
                    <span>No recent activity in this server</span>
                </div>
            `;
            return;
        }
        
        activityList.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <i class="fas fa-${activity.icon}"></i>
                <span>${activity.description}</span>
                <span class="activity-time">${activity.time}</span>
            </div>
        `).join('');
    }

    // Save all changes
    async saveAllChanges() {
        const saveBtn = document.getElementById('save-all');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<div class="spinner"></div> Saving...';
        saveBtn.disabled = true;

        try {
            // Collect all form data and save
            await this.apiCall('/settings/save-all', {
                method: 'POST',
                body: JSON.stringify({
                    tab: this.currentTab,
                    guild: this.currentGuild,
                    // Add form data collection here
                })
            });

            this.showNotification('All changes saved successfully!', 'success');
        } catch (error) {
            this.showNotification('Error saving changes', 'error');
        } finally {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }

    // Load data for the selected server
    async loadServerData() {
        if (!this.selectedServerId) return;

        // Update URL with selected server
        const url = new URL(window.location);
        url.searchParams.set('server', this.selectedServerId);
        window.history.replaceState({}, '', url);

        // Show current server in header
        const guild = this.userGuilds.find(g => g.id === this.selectedServerId);
        const currentServerEl = document.getElementById('current-server');
        const currentServerName = document.getElementById('current-server-name');
        const saveBtn = document.getElementById('save-all');
        if (guild && currentServerEl && currentServerName) {
            currentServerName.textContent = guild.name;
            currentServerEl.style.display = 'flex';
        }
        if (saveBtn) saveBtn.style.display = 'inline-flex';

        // Set guild context for API calls
        this.currentGuild = this.selectedServerId;

        // Join socket room for this server
        this.joinServerRoom(this.selectedServerId);

        // Load data for the current tab
        await this.loadTabData(this.currentTab);
    }

    updateModuleToggles(modules) {
        if (!modules || !Array.isArray(modules)) return;
        modules.forEach(mod => {
            const toggle = document.querySelector(`[data-module="${mod.module}"]`);
            if (toggle) toggle.checked = mod.enabled;
        });
    }

    updateGuildBalance(data) {
        if (!data) return;
        const balanceAmounts = document.querySelectorAll('#economy .balance-amount');
        if (balanceAmounts[0]) balanceAmounts[0].textContent = '$' + Number(data.treasury || data.balance || 0).toLocaleString();
        if (balanceAmounts[1]) balanceAmounts[1].textContent = '$' + Number(data.total_donated || 0).toLocaleString();
        if (balanceAmounts[2]) balanceAmounts[2].textContent = '$' + Number(data.total_given || 0).toLocaleString();
    }

    updateBlockedChannelsList(channels) {
        const list = document.getElementById('blocked-channels-list');
        if (!list) return;
        list.innerHTML = (channels || []).map(ch => `
            <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;">
                <span>#${ch.channel_id}</span>
                <div style="display:flex;gap:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="dashboard.editBlockedChannel('${ch.channel_id}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="dashboard.apiCall('/guild/blocked-channels/${ch.channel_id}', { method: 'DELETE' }).then(() => dashboard.loadGuildSettingsData())" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editBlockedChannel(oldChannelId) {
        this.showModal('Edit Blocked Channel', `
            <div class="form-group">
                <label>Channel ID</label>
                <input type="text" id="modal-channel-id" value="${oldChannelId}" placeholder="Enter channel ID...">
            </div>
        `, async () => {
            const newChannelId = document.getElementById('modal-channel-id')?.value.trim();
            if (!newChannelId) { alert('Channel ID is required.'); return; }
            // Delete old and add new if changed
            if (newChannelId !== oldChannelId) {
                await this.apiCall(`/guild/blocked-channels/${oldChannelId}`, { method: 'DELETE' });
                await this.apiCall('/guild/blocked-channels', {
                    method: 'POST',
                    body: JSON.stringify({ channel_id: newChannelId })
                });
            }
            this.closeModal();
            this.loadGuildSettingsData();
        });
    }

    updateCustomPrefixesList(prefixes) {
        const list = document.getElementById('custom-prefixes');
        if (!list) return;
        list.innerHTML = (prefixes || []).map(p => `
            <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;">
                <code>${p.prefix}</code>
                <div style="display:flex;gap:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="dashboard.editCustomPrefix('${p.prefix.replace(/'/g, "\\'")}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="dashboard.apiCall('/guild/custom-prefixes', { method: 'DELETE', body: JSON.stringify({ prefix: '${p.prefix.replace(/'/g, "\\'") }' }) }).then(() => dashboard.loadGuildSettingsData())" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editCustomPrefix(oldPrefix) {
        this.showModal('Edit Custom Prefix', `
            <div class="form-group">
                <label>Prefix</label>
                <input type="text" id="modal-prefix" value="${oldPrefix}" placeholder="Enter prefix...">
            </div>
        `, async () => {
            const newPrefix = document.getElementById('modal-prefix')?.value.trim();
            if (!newPrefix) { alert('Prefix is required.'); return; }
            if (newPrefix !== oldPrefix) {
                await this.apiCall('/guild/custom-prefixes', {
                    method: 'DELETE',
                    body: JSON.stringify({ prefix: oldPrefix })
                });
                await this.apiCall('/guild/custom-prefixes', {
                    method: 'POST',
                    body: JSON.stringify({ prefix: newPrefix })
                });
            }
            this.closeModal();
            this.loadGuildSettingsData();
        });
    }

    updateCommandsList(commands) {
        const list = document.getElementById('command-toggles');
        if (!list || !commands) return;
        list.innerHTML = commands.map(cmd => {
            const name = cmd.name || cmd.command;
            const hasExclusive = cmd.exclusive_channel || cmd.exclusive_role;
            return `
            <div class="command-toggle-item" data-command="${name}">
                <div class="command-info" style="display:flex;align-items:center;gap:0.5rem;flex:1;">
                    <span class="command-name">${name}</span>
                    ${cmd.usage !== undefined ? `<span style="color:var(--text-secondary);font-size:0.75rem;">(${cmd.usage} uses)</span>` : ''}
                    ${hasExclusive ? `<span class="badge badge-exclusive" style="font-size:0.65rem;padding:0.1rem 0.4rem;background:var(--accent);color:#fff;" title="Exclusive to ${cmd.exclusive_channel ? 'channel ' + cmd.exclusive_channel : 'role ' + cmd.exclusive_role}">-e</span>` : ''}
                </div>
                <div class="command-actions" style="display:flex;align-items:center;gap:0.5rem;">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); dashboard.showExclusiveModal('${name}', 'command')" title="Make Exclusive (-e flag)" style="padding:0.2rem 0.4rem;font-size:0.7rem;">
                        <i class="fas fa-lock"></i>
                    </button>
                    <label class="toggle-switch">
                        <input type="checkbox" ${cmd.enabled !== false ? 'checked' : ''}
                            onchange="dashboard.toggleModule('${name}', this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>`;
        }).join('');
    }

    updateScopeRulesList(rules) {
        const list = document.getElementById('scope-rules-list');
        if (!list || !rules) return;
        if (!rules.length) {
            list.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">No scope rules configured.</p>';
            return;
        }
        list.innerHTML = rules.map(r => {
            const scopeClass = r.scope_type === 'exclusive' ? 'badge-exclusive' : (r.scope_type === 'allow' ? 'badge-allow' : 'badge-deny');
            const scopeStyle = r.scope_type === 'exclusive' ? 'background:var(--accent);color:#fff;' : '';
            return `
            <div class="scope-rule-card" onclick="dashboard.editScopeRule(${r.id})" data-rule-id="${r.id}">
                <div class="scope-rule-info">
                    <span class="scope-rule-command">${r.command_name}</span>
                    <span class="badge ${scopeClass}" style="${scopeStyle}">${r.scope_type.toUpperCase()}${r.scope_type === 'exclusive' ? ' (-e)' : ''}</span>
                    <span class="scope-rule-target">${r.target_type}: ${r.target_id}</span>
                </div>
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); dashboard.deleteScopeRule(${r.id})" title="Delete rule">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`;
        }).join('');
    }

    updateInterestSettings(data) {
        if (!data) return;
        const rate = document.getElementById('default-interest-rate');
        const maxLevel = document.getElementById('max-interest-level');
        if (rate && data.interest_rate !== undefined) rate.value = data.interest_rate;
        if (maxLevel && data.max_interest_level !== undefined) maxLevel.value = data.max_interest_level;
    }

    displayUserEconomyResults(users) {
        const list = document.getElementById('user-economy-result');
        if (!list || !users) return;
        list.innerHTML = users.map(u => `
            <div class="user-result-item">
                <span class="user-id">${u.user_id}</span>
                <span class="wallet">Wallet: $${Number(u.wallet).toLocaleString()}</span>
                <span class="bank">Bank: $${Number(u.bank).toLocaleString()}</span>
            </div>
        `).join('');
    }

    updateShopItemsTable(items) {
        const table = document.getElementById('shop-items-tbody');
        if (!table || !items) return;
        table.innerHTML = items.map(item => `
            <tr data-item-id="${item.item_id}" onclick="dashboard.editShopItem('${item.item_id}')" style="cursor:pointer;">
                <td>${item.item_id}</td>
                <td class="shop-item-name">${item.name}</td>
                <td class="shop-item-category">${item.category}</td>
                <td class="shop-item-price">$${Number(item.price).toLocaleString()}</td>
                <td class="shop-item-level">${item.level || 1}</td>
                <td class="shop-item-desc" style="display:none;">${item.description || ''}</td>
                <td class="shop-item-maxqty" style="display:none;">${item.max_quantity || 1}</td>
                <td style="text-align:right;">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dashboard.editShopItem('${item.item_id}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.deleteShopItem('${item.item_id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    editShopItem(itemId) {
        const row = document.querySelector(`tr[data-item-id="${itemId}"]`);
        if (!row) return;
        const name = row.querySelector('.shop-item-name')?.textContent || '';
        const category = row.querySelector('.shop-item-category')?.textContent || 'other';
        const priceText = row.querySelector('.shop-item-price')?.textContent || '0';
        const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
        const level = row.querySelector('.shop-item-level')?.textContent || '1';
        const description = row.querySelector('.shop-item-desc')?.textContent || '';
        const maxQty = row.querySelector('.shop-item-maxqty')?.textContent || '1';

        this.showModal(`Edit Shop Item: ${itemId}`, `
            <div class="form-group">
                <label>Item ID <span style="color:var(--text-muted);font-size:0.75rem;">(read-only)</span></label>
                <input type="text" value="${itemId}" disabled style="opacity:0.6;">
            </div>
            <div class="form-group">
                <label>Item Name</label>
                <input type="text" id="modal-item-name" value="${name}">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="modal-item-description" rows="2">${description}</textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category</label>
                    <select id="modal-item-category">
                        <option value="potion" ${category === 'potion' ? 'selected' : ''}>Potion</option>
                        <option value="upgrade" ${category === 'upgrade' ? 'selected' : ''}>Upgrade</option>
                        <option value="rod" ${category === 'rod' ? 'selected' : ''}>Fishing Rod</option>
                        <option value="bait" ${category === 'bait' ? 'selected' : ''}>Bait</option>
                        <option value="collectible" ${category === 'collectible' ? 'selected' : ''}>Collectible</option>
                        <option value="other" ${category === 'other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Price</label>
                    <input type="number" id="modal-item-price" min="1" value="${price}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" id="modal-item-level" min="1" value="${level}">
                </div>
                <div class="form-group">
                    <label>Max Quantity</label>
                    <input type="number" id="modal-item-maxqty" min="1" value="${maxQty}">
                </div>
            </div>
        `, async () => {
            const newName = document.getElementById('modal-item-name')?.value.trim();
            const newDescription = document.getElementById('modal-item-description')?.value.trim();
            const newCategory = document.getElementById('modal-item-category')?.value;
            const newPrice = parseInt(document.getElementById('modal-item-price')?.value);
            const newLevel = parseInt(document.getElementById('modal-item-level')?.value) || 1;
            const newMaxQty = parseInt(document.getElementById('modal-item-maxqty')?.value) || 1;
            if (!newName || !newPrice) { alert('Name and Price are required.'); return; }
            await this.apiCall(`/shop/items/${encodeURIComponent(itemId)}`, {
                method: 'PUT',
                body: JSON.stringify({ name: newName, description: newDescription, category: newCategory, price: newPrice, level: newLevel, max_quantity: newMaxQty })
            });
            this.closeModal();
            this.loadShopData();
        });
    }

    async deleteShopItem(itemId) {
        if (!confirm(`Delete shop item "${itemId}"?`)) return;
        await this.apiCall(`/shop/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        this.loadShopData();
    }

    updateDailyDealsList(deals) {
        const list = document.querySelector('.daily-deals-list');
        if (!list || !deals) return;
        if (!deals.length) {
            list.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;">No daily deals configured</div>';
            return;
        }
        list.innerHTML = deals.map(d => `
            <div class="deal-card" data-deal-id="${d.id || d.item_id}" onclick="dashboard.editDailyDeal('${d.id || d.item_id}', '${d.item_id}', ${d.discount}, ${d.stock || 'null'})" style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;cursor:pointer;">
                <div class="deal-info">
                    <span class="deal-item-id">${d.item_id}</span>
                    <span class="deal-discount" style="margin-left:0.5rem;color:var(--accent);font-weight:600;">${d.discount}% off</span>
                    ${d.stock ? `<span class="deal-stock" style="margin-left:0.5rem;color:var(--text-secondary);font-size:0.8rem;">Stock: ${d.stock}</span>` : '<span class="deal-stock" style="display:none;"></span>'}
                </div>
                <div style="display:flex;gap:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dashboard.editDailyDeal('${d.id || d.item_id}', '${d.item_id}', ${d.discount}, ${d.stock || 'null'})" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.deleteDailyDeal('${d.id || d.item_id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editDailyDeal(id, itemId, discount, stock) {
        this.showModal('Edit Daily Deal', `
            <div class="form-group">
                <label>Item ID</label>
                <input type="text" id="modal-deal-item" value="${itemId}" placeholder="Item ID...">
            </div>
            <div class="form-group">
                <label>Discount (%)</label>
                <input type="number" id="modal-deal-discount" min="1" max="99" value="${discount}">
            </div>
            <div class="form-group">
                <label>Stock (optional)</label>
                <input type="number" id="modal-deal-stock" min="1" value="${stock || ''}" placeholder="Leave empty for unlimited">
            </div>
        `, async () => {
            const newItemId = document.getElementById('modal-deal-item')?.value.trim();
            const newDiscount = parseInt(document.getElementById('modal-deal-discount')?.value);
            const stockVal = document.getElementById('modal-deal-stock')?.value;
            const newStock = stockVal ? parseInt(stockVal) : null;
            if (!newItemId || !newDiscount) { alert('Item ID and Discount are required.'); return; }
            await this.apiCall(`/shop/daily-deals/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify({ item_id: newItemId, discount: newDiscount, stock: newStock })
            });
            this.closeModal();
            this.loadShopData();
        });
    }

    async deleteDailyDeal(id) {
        if (!confirm('Delete this daily deal?')) return;
        await this.apiCall(`/shop/daily-deals/${encodeURIComponent(id)}`, { method: 'DELETE' });
        this.loadShopData();
    }

    updateBazaarStats(stats) {
        const el = document.querySelector('.bazaar-stats');
        if (!el || !stats) return;
        el.innerHTML = `<span>Stock: ${stats.stock || 0}</span><span>Visitors: ${stats.visitors || 0}</span>`;
    }

    loadGlobalSettings() {
        // No guild selected — nothing to load
    }

    loadGuildSettings() {
        this.loadGuildSettingsData();
    }

    async loadStatisticsData() {
        const stats = await this.apiCall('/stats/overview');
        if (stats) this.updateOverviewStats(stats);
    }

    async loadMLSettingsData() {
        const settings = await this.apiCall('/ml/settings');
        const el = document.getElementById('ml-settings-list');
        if (!el) return;
        if (!settings || (Array.isArray(settings) && !settings.length)) {
            el.innerHTML = '<div style="color:var(--text-secondary);">No ML settings configured</div>';
            return;
        }
        const entries = Array.isArray(settings) ? settings : Object.entries(settings).map(([k, v]) => ({ key: k, value: v }));
        el.innerHTML = entries.map(s => `
            <div class="ml-setting-card" data-ml-key="${s.key}" onclick="dashboard.editMLSetting('${s.key}', '${String(s.value).replace(/'/g, "\\'")}')" style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;cursor:pointer;">
                <div class="ml-setting-info">
                    <code class="ml-key" style="color:var(--accent);">${s.key}</code>
                    <span class="ml-value" style="margin-left:0.5rem;">${s.value}</span>
                </div>
                <div style="display:flex;gap:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dashboard.editMLSetting('${s.key}', '${String(s.value).replace(/'/g, "\\'")}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.apiCall('/ml/settings/${encodeURIComponent(s.key)}', { method: 'DELETE' }).then(() => dashboard.loadMLSettingsData())" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editMLSetting(key, value) {
        this.showModal('Edit ML Setting', `
            <div class="form-group">
                <label>Setting Key</label>
                <input type="text" id="modal-ml-key" value="${key}" placeholder="e.g. learning_rate">
            </div>
            <div class="form-group">
                <label>Value</label>
                <input type="text" id="modal-ml-value" value="${value}" placeholder="e.g. 0.01">
            </div>
        `, async () => {
            const newKey = document.getElementById('modal-ml-key')?.value.trim();
            const newValue = document.getElementById('modal-ml-value')?.value.trim();
            if (!newKey || !newValue) { alert('Both fields are required.'); return; }
            // If key changed, delete old and create new
            if (newKey !== key) {
                await this.apiCall(`/ml/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
            }
            await this.apiCall('/ml/settings', {
                method: 'POST',
                body: JSON.stringify({ key: newKey, value: newValue })
            });
            this.closeModal();
            this.loadMLSettingsData();
        });
    }

    async loadUsersData() {
        // Triggered by user searching, not on tab load
    }

    async loadFishingData() {
        const stats = await this.apiCall('/fishing/stats');
        if (stats) {
            const cards = document.querySelectorAll('#fishing .stat-number');
            if (cards[0]) cards[0].textContent = formatNumber(stats.total_caught || 0);
            if (cards[1]) cards[1].textContent = '$' + formatNumber(stats.most_valuable || 0);
            if (cards[2]) cards[2].textContent = formatNumber(stats.legendary_count || 0);
            if (cards[3]) cards[3].textContent = formatNumber(stats.active_autofishers || 0);
        }

        const gear = await this.apiCall('/fishing/gear');
        if (gear) {
            this.renderGearList('rods-list', gear.rods || [], 'rod');
            this.renderGearList('bait-list', gear.bait || [], 'bait');
        }
    }

    renderGearList(listId, items, type) {
        const list = document.getElementById(listId);
        if (!list) return;

        // Inject "Add" button next to the h4 if not already there
        const category = list.closest('.gear-category');
        if (category && !category.querySelector('.add-gear-btn')) {
            const addBtn = document.createElement('button');
            addBtn.className = 'btn btn-sm btn-primary add-gear-btn';
            addBtn.style.cssText = 'font-size:0.7rem;padding:0.2rem 0.5rem;margin-left:0.5rem;';
            addBtn.textContent = `+ Add ${type === 'rod' ? 'Rod' : 'Bait'}`;
            addBtn.addEventListener('click', () => this.showAddGearModal(type));
            const h4 = category.querySelector('h4');
            if (h4) h4.style.display = 'inline', h4.after(addBtn);
        }

        if (items.length === 0) {
            list.innerHTML = `<div style="padding:0.5rem 0;color:var(--text-secondary);font-size:0.8rem;">No ${type === 'rod' ? 'rods' : 'bait'} configured</div>`;
            return;
        }

        list.innerHTML = items.map(item => `
            <div class="gear-card" onclick="dashboard.editGearItem('${item.item_id}', '${type}')" data-item-id="${item.item_id}">
                <div class="gear-card-info">
                    <strong class="gear-name">${item.name}</strong>
                    <span class="badge" style="font-size:0.65rem;padding:0.1rem 0.4rem;">Lv.<span class="gear-level">${item.level}</span></span>
                    ${item.description ? `<span class="gear-desc" style="color:var(--text-secondary);font-size:0.75rem;">${item.description}</span>` : '<span class="gear-desc" style="display:none;"></span>'}
                    <span class="gear-price" style="color:var(--accent);font-weight:600;font-size:0.85rem;">$${formatNumber(item.price)}</span>
                    <span class="gear-max-qty" style="display:none;">${item.max_quantity || 1}</span>
                </div>
                <div style="display:flex;align-items:center;gap:0.6rem;">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); dashboard.editGearItem('${item.item_id}', '${type}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); dashboard.deleteGearItem('${item.item_id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editGearItem(itemId, type) {
        const card = document.querySelector(`.gear-card[data-item-id="${itemId}"]`);
        if (!card) return;
        const name = card.querySelector('.gear-name')?.textContent || '';
        const level = card.querySelector('.gear-level')?.textContent || '1';
        const desc = card.querySelector('.gear-desc')?.textContent || '';
        const priceText = card.querySelector('.gear-price')?.textContent || '0';
        const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
        const maxQty = card.querySelector('.gear-max-qty')?.textContent || '1';
        const label = type === 'rod' ? 'Rod' : 'Bait';

        this.showModal(`Edit ${label}: ${name}`, `
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="modal-gear-name" value="${name}">
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" id="modal-gear-desc" value="${desc}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Price</label>
                    <input type="number" id="modal-gear-price" min="1" value="${price}">
                </div>
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" id="modal-gear-level" min="1" max="10" value="${level}">
                </div>
            </div>
            <div class="form-group">
                <label>Max Quantity</label>
                <input type="number" id="modal-gear-maxqty" min="1" value="${maxQty}">
            </div>
        `, async () => {
            const newName = document.getElementById('modal-gear-name')?.value.trim();
            const newDesc = document.getElementById('modal-gear-desc')?.value.trim();
            const newPrice = parseInt(document.getElementById('modal-gear-price')?.value);
            const newLevel = parseInt(document.getElementById('modal-gear-level')?.value) || 1;
            const newMaxQty = parseInt(document.getElementById('modal-gear-maxqty')?.value) || 1;
            if (!newName || !newPrice) { alert('Name and Price are required.'); return; }
            const result = await this.apiCall(`/fishing/gear/${encodeURIComponent(itemId)}`, {
                method: 'PUT',
                body: JSON.stringify({ name: newName, description: newDesc, price: newPrice, level: newLevel, max_quantity: newMaxQty })
            });
            if (result) {
                this.closeModal();
                this.loadFishingData();
            }
        });
    }

    showAddGearModal(type) {
        const label = type === 'rod' ? 'Rod' : 'Bait';
        this.showModal(`Add ${label}`, `
            <div class="form-group">
                <label>Item ID <span style="color:var(--text-secondary);font-size:0.75rem;">(unique, no spaces)</span></label>
                <input type="text" id="modal-gear-id" placeholder="${type}_custom">
            </div>
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="modal-gear-name" placeholder="Display Name">
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" id="modal-gear-desc" placeholder="Short description (optional)">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Price</label>
                    <input type="number" id="modal-gear-price" min="1" value="500">
                </div>
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" id="modal-gear-level" min="1" max="10" value="1">
                </div>
            </div>
        `, async () => {
            const item_id = document.getElementById('modal-gear-id')?.value.trim();
            const name = document.getElementById('modal-gear-name')?.value.trim();
            const description = document.getElementById('modal-gear-desc')?.value.trim();
            const price = parseInt(document.getElementById('modal-gear-price')?.value);
            const level = parseInt(document.getElementById('modal-gear-level')?.value) || 1;
            if (!item_id || !name || !price) {
                alert('Item ID, Name, and Price are required.');
                return;
            }
            const result = await this.apiCall('/fishing/gear', {
                method: 'POST',
                body: JSON.stringify({ item_id, name, description, category: type, price, level, max_quantity: 1 })
            });
            if (result) {
                this.closeModal();
                this.loadFishingData();
            }
        });
    }

    async deleteGearItem(itemId) {
        if (!confirm(`Delete "${itemId}" from fishing gear?`)) return;
        await this.apiCall(`/fishing/gear/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        this.loadFishingData();
    }

    async loadGiveawaysData() {
        const data = await this.apiCall('/giveaways/active');
        const list = document.getElementById('active-giveaways');
        if (!list) return;
        if (!data || !data.length) { list.innerHTML = '<div style="color:var(--text-secondary);">No active giveaways</div>'; return; }
        list.innerHTML = data.map(g => `
            <div class="giveaway-card" data-giveaway-id="${g.id}" onclick="dashboard.editGiveaway(${g.id}, ${g.prize}, ${g.winner_count || 1}, '${g.ends_at}', '${g.channel_id || ''}')" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;cursor:pointer;border-radius:0.5rem;background:var(--bg-tertiary);margin-bottom:0.5rem;">
                <div class="giveaway-info">
                    <strong class="giveaway-prize">$${Number(g.prize).toLocaleString()}</strong>
                    <span class="giveaway-winners" style="margin-left:0.5rem;color:var(--text-secondary);">${g.winner_count || 1} winner(s)</span>
                    <span class="giveaway-channel" style="margin-left:0.5rem;color:var(--text-muted);font-size:0.75rem;">${g.channel_id ? 'Channel: ' + g.channel_id : ''}</span>
                    <span class="giveaway-ends" style="margin-left:0.5rem;color:var(--text-secondary);font-size:0.8rem;">Ends: ${new Date(g.ends_at).toLocaleString()}</span>
                </div>
                <div style="display:flex;align-items:center;gap:0.75rem;">
                    <span class="badge">${g.participants || 0} entries</span>
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dashboard.editGiveaway(${g.id}, ${g.prize}, ${g.winner_count || 1}, '${g.ends_at}', '${g.channel_id || ''}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="event.stopPropagation(); dashboard.endGiveaway(${g.id})" title="End Early">
                        <i class="fas fa-stop"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.cancelGiveaway(${g.id})" title="Cancel">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editGiveaway(id, prize, winnerCount, endsAt, channelId) {
        const endDate = new Date(endsAt);
        const endDateStr = endDate.toISOString().slice(0, 16); // Format for datetime-local input
        
        this.showModal('Edit Giveaway', `
            <div class="form-group">
                <label>Prize Amount</label>
                <input type="number" id="modal-giveaway-prize" min="1" value="${prize}">
            </div>
            <div class="form-group">
                <label>Number of Winners</label>
                <input type="number" id="modal-giveaway-winners" min="1" value="${winnerCount}">
            </div>
            <div class="form-group">
                <label>End Date & Time</label>
                <input type="datetime-local" id="modal-giveaway-ends" value="${endDateStr}">
            </div>
            <div class="form-group">
                <label>Channel ID</label>
                <input type="text" id="modal-giveaway-channel" value="${channelId}" placeholder="Channel ID...">
            </div>
        `, async () => {
            const newPrize = parseInt(document.getElementById('modal-giveaway-prize')?.value);
            const newWinners = parseInt(document.getElementById('modal-giveaway-winners')?.value) || 1;
            const newEndsAt = document.getElementById('modal-giveaway-ends')?.value;
            const newChannelId = document.getElementById('modal-giveaway-channel')?.value.trim();
            if (!newPrize || !newEndsAt) { alert('Prize and end date are required.'); return; }
            await this.apiCall(`/giveaways/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ prize: newPrize, max_winners: newWinners, ends_at: new Date(newEndsAt).toISOString(), channel_id: newChannelId })
            });
            this.closeModal();
            this.loadGiveawaysData();
        });
    }

    async endGiveaway(id) {
        if (!confirm('End this giveaway early and pick winners now?')) return;
        await this.apiCall(`/giveaways/${id}/end`, { method: 'POST' });
        this.showNotification('Giveaway ended!', 'success');
        this.loadGiveawaysData();
    }

    async cancelGiveaway(id) {
        if (!confirm('Cancel this giveaway? This cannot be undone.')) return;
        await this.apiCall(`/giveaways/${id}`, { method: 'DELETE' });
        this.showNotification('Giveaway cancelled.', 'info');
        this.loadGiveawaysData();
    }

    async loadModerationData() {
        const [blacklist, whitelist] = await Promise.all([
            this.apiCall('/moderation/blacklist'),
            this.apiCall('/moderation/whitelist')
        ]);

        const blEl = document.getElementById('blacklist');
        if (blEl && blacklist) {
            blEl.innerHTML = (blacklist.length ? blacklist : []).map(u => `
                <div class="blacklist-card" onclick="dashboard.editBlacklistEntry('${u.user_id}', 'blacklist')">
                    <div class="blacklist-info">
                        <span class="blacklist-user">${u.user_id}</span>
                        <span class="blacklist-reason">${u.reason ? u.reason : '<em style="color:var(--text-muted);">No reason</em>'}</span>
                        ${u.added_at ? `<span class="blacklist-date">${new Date(u.added_at).toLocaleDateString()}</span>` : ''}
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.apiCall('/moderation/blacklist/${u.user_id}', { method: 'DELETE' }).then(() => dashboard.loadModerationData())" title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `).join('') || '<div style="color:var(--text-secondary);font-size:0.85rem;">No blacklisted users</div>';
        }

        const wlEl = document.getElementById('whitelist');
        if (wlEl && whitelist) {
            wlEl.innerHTML = (whitelist.length ? whitelist : []).map(u => `
                <div class="blacklist-card" onclick="dashboard.editBlacklistEntry('${u.user_id}', 'whitelist')">
                    <div class="blacklist-info">
                        <span class="blacklist-user">${u.user_id}</span>
                        <span class="blacklist-reason">${u.reason ? u.reason : '<em style="color:var(--text-muted);">No reason</em>'}</span>
                        ${u.added_at ? `<span class="blacklist-date">${new Date(u.added_at).toLocaleDateString()}</span>` : ''}
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.apiCall('/moderation/whitelist/${u.user_id}', { method: 'DELETE' }).then(() => dashboard.loadModerationData())" title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `).join('') || '<div style="color:var(--text-secondary);font-size:0.85rem;">No whitelisted users</div>';
        }

        const cooldowns = await this.apiCall('/moderation/cooldowns');
        const cdBody = document.getElementById('cooldown-settings-tbody');
        if (cdBody && cooldowns) {
            cdBody.innerHTML = (cooldowns || []).map(c => `
                <tr>
                    <td>${c.command}</td>
                    <td>${c.cooldown_seconds}s</td>
                    <td><button class="btn btn-sm btn-secondary" onclick="dashboard.editCooldown('${c.command}')">Edit</button></td>
                </tr>
            `).join('');
        }
    }

    editCooldown(command) {
        this.showModal('Edit Cooldown', `
            <div class="form-group">
                <label>Command: <strong>${command}</strong></label>
            </div>
            <div class="form-group">
                <label>Cooldown (seconds)</label>
                <input type="number" id="modal-cooldown-value" min="0" value="5">
            </div>
        `, async () => {
            const seconds = parseInt(document.getElementById('modal-cooldown-value')?.value);
            await this.apiCall('/moderation/cooldowns', {
                method: 'POST',
                body: JSON.stringify({ command, cooldown_seconds: seconds })
            });
            this.closeModal();
            this.loadModerationData();
        });
    }

    async loadReactionRolesData() {
        const roles = await this.apiCall('/reaction-roles');
        const list = document.getElementById('reaction-roles-list');
        if (!list) return;
        if (!roles || !roles.length) { list.innerHTML = '<div style="color:var(--text-secondary);">No reaction roles configured</div>'; return; }
        list.innerHTML = roles.map(r => `
            <div class="reaction-role-card" data-rr-id="${r.id || r.message_id}" onclick="dashboard.editReactionRole('${r.id || r.message_id}', '${r.message_id}', '${r.channel_id || ''}', '${r.emoji_raw}', '${r.role_id}')">
                <div class="reaction-role-info">
                    <span class="rr-emoji">${r.emoji_raw}</span>
                    <span class="rr-message" style="margin-left:0.5rem;">Message: ${r.message_id}</span>
                    <span class="rr-channel" style="margin-left:0.5rem;color:var(--text-muted);font-size:0.8rem;">${r.channel_id ? 'Channel: ' + r.channel_id : ''}</span>
                    <span class="rr-role" style="margin-left:0.5rem;color:var(--text-secondary);">→ Role: ${r.role_id}</span>
                </div>
                <div style="display:flex;gap:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dashboard.editReactionRole('${r.id || r.message_id}', '${r.message_id}', '${r.channel_id || ''}', '${r.emoji_raw}', '${r.role_id}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); dashboard.apiCall('/reaction-roles/${r.id || r.message_id}', { method: 'DELETE' }).then(() => dashboard.loadReactionRolesData())" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    editReactionRole(id, messageId, channelId, emoji, roleId) {
        this.showModal('Edit Reaction Role', `
            <div class="form-group">
                <label>Message ID</label>
                <input type="text" id="modal-rr-message" value="${messageId}" placeholder="Message ID...">
            </div>
            <div class="form-group">
                <label>Channel ID</label>
                <input type="text" id="modal-rr-channel" value="${channelId}" placeholder="Channel ID...">
            </div>
            <div class="form-group">
                <label>Emoji</label>
                <input type="text" id="modal-rr-emoji" value="${emoji}" placeholder="Emoji (e.g. 🎉 or custom emoji ID)">
            </div>
            <div class="form-group">
                <label>Role ID</label>
                <input type="text" id="modal-rr-role" value="${roleId}" placeholder="Role ID...">
            </div>
        `, async () => {
            const newMessageId = document.getElementById('modal-rr-message')?.value.trim();
            const newChannelId = document.getElementById('modal-rr-channel')?.value.trim();
            const newEmoji = document.getElementById('modal-rr-emoji')?.value.trim();
            const newRoleId = document.getElementById('modal-rr-role')?.value.trim();
            if (!newMessageId || !newChannelId || !newEmoji || !newRoleId) {
                alert('All fields are required.');
                return;
            }
            await this.apiCall(`/reaction-roles/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ message_id: newMessageId, channel_id: newChannelId, emoji_raw: newEmoji, role_id: newRoleId })
            });
            this.closeModal();
            this.loadReactionRolesData();
        });
    }

    // ── Scope Rules ──
    addScopeRule() {
        this.showModal('Add Scope Rule', `
            <div class="form-group">
                <label>Command Name</label>
                <input type="text" id="modal-scope-command" placeholder="e.g. balance">
            </div>
            <div class="form-group">
                <label>Rule Type</label>
                <select id="modal-scope-type">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                    <option value="exclusive">Exclusive (-e flag)</option>
                </select>
                <p style="color:var(--text-muted);font-size:0.75rem;margin-top:0.25rem;">Exclusive: Command ONLY works in the specified channel/role</p>
            </div>
            <div class="form-group">
                <label>Target Type</label>
                <select id="modal-target-type">
                    <option value="channel">Channel</option>
                    <option value="role">Role</option>
                    <option value="user">User</option>
                </select>
            </div>
            <div class="form-group">
                <label>Target ID</label>
                <input type="text" id="modal-target-id" placeholder="Discord ID...">
            </div>
        `, async () => {
            const command_name = document.getElementById('modal-scope-command')?.value.trim();
            const scope_type = document.getElementById('modal-scope-type')?.value;
            const target_type = document.getElementById('modal-target-type')?.value;
            const target_id = document.getElementById('modal-target-id')?.value.trim();
            if (!command_name || !target_id) { alert('Command name and target ID are required.'); return; }
            await this.apiCall('/scope-rules', {
                method: 'POST',
                body: JSON.stringify({ command_name, scope_type, target_type, target_id })
            });
            this.closeModal();
            this.loadCommandsData();
        });
    }

    showExclusiveModal(commandName, type = 'command') {
        this.showModal(`Make ${commandName} Exclusive`, `
            <p style="color:var(--text-secondary);margin-bottom:1rem;">Make <strong>${commandName}</strong> only work in a specific channel or for a specific role (like the -e flag in bot commands).</p>
            <div class="form-group">
                <label>Restrict To</label>
                <select id="modal-exclusive-type">
                    <option value="channel">Channel Only</option>
                    <option value="role">Role Only</option>
                </select>
            </div>
            <div class="form-group">
                <label>Channel/Role ID</label>
                <input type="text" id="modal-exclusive-id" placeholder="Discord ID...">
            </div>
            <div class="form-group" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-color);">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                    <input type="checkbox" id="modal-exclusive-remove" style="width:auto;">
                    <span>Remove existing exclusive restriction</span>
                </label>
            </div>
        `, async () => {
            const removeExclusive = document.getElementById('modal-exclusive-remove')?.checked;
            const target_type = document.getElementById('modal-exclusive-type')?.value;
            const target_id = document.getElementById('modal-exclusive-id')?.value.trim();
            
            if (removeExclusive) {
                // Remove all exclusive rules for this command
                await this.apiCall(`/scope-rules/exclusive/${encodeURIComponent(commandName)}`, { method: 'DELETE' });
                this.showNotification(`Removed exclusive restriction from ${commandName}`, 'success');
            } else {
                if (!target_id) { alert('Please enter a channel or role ID.'); return; }
                await this.apiCall('/scope-rules', {
                    method: 'POST',
                    body: JSON.stringify({ command_name: commandName, scope_type: 'exclusive', target_type, target_id })
                });
                this.showNotification(`${commandName} is now exclusive to ${target_type} ${target_id}`, 'success');
            }
            this.closeModal();
            this.loadCommandsData();
        });
    }

    editScopeRule(ruleId) {
        const list = document.getElementById('scope-rules-list');
        const card = list?.querySelector(`[data-rule-id="${ruleId}"]`);
        if (!card) return;
        const command_name = card.querySelector('.scope-rule-command')?.textContent || '';
        const badgeEl = card.querySelector('.badge');
        let scope_type = badgeEl?.textContent.trim().toLowerCase() || 'allow';
        // Handle "EXCLUSIVE (-e)" badge text
        if (scope_type.includes('exclusive')) scope_type = 'exclusive';
        const targetText = card.querySelector('.scope-rule-target')?.textContent || '';
        const [target_type, target_id] = targetText.includes(':') ? targetText.split(':').map(s => s.trim()) : ['channel', ''];

        this.showModal('Edit Scope Rule', `
            <div class="form-group">
                <label>Command Name</label>
                <input type="text" id="modal-scope-command" value="${command_name}">
            </div>
            <div class="form-group">
                <label>Rule Type</label>
                <select id="modal-scope-type">
                    <option value="allow" ${scope_type === 'allow' ? 'selected' : ''}>Allow</option>
                    <option value="deny" ${scope_type === 'deny' ? 'selected' : ''}>Deny</option>
                    <option value="exclusive" ${scope_type === 'exclusive' ? 'selected' : ''}>Exclusive (-e flag)</option>
                </select>
                <p style="color:var(--text-muted);font-size:0.75rem;margin-top:0.25rem;">Exclusive: Command ONLY works in the specified channel/role</p>
            </div>
            <div class="form-group">
                <label>Target Type</label>
                <select id="modal-target-type">
                    <option value="channel" ${target_type === 'channel' ? 'selected' : ''}>Channel</option>
                    <option value="role" ${target_type === 'role' ? 'selected' : ''}>Role</option>
                    <option value="user" ${target_type === 'user' ? 'selected' : ''}>User</option>
                </select>
            </div>
            <div class="form-group">
                <label>Target ID</label>
                <input type="text" id="modal-target-id" value="${target_id}">
            </div>
        `, async () => {
            const newCommand = document.getElementById('modal-scope-command')?.value.trim();
            const newScopeType = document.getElementById('modal-scope-type')?.value;
            const newTargetType = document.getElementById('modal-target-type')?.value;
            const newTargetId = document.getElementById('modal-target-id')?.value.trim();
            if (!newCommand || !newTargetId) { alert('Command name and target ID are required.'); return; }
            await this.apiCall(`/scope-rules/${ruleId}`, {
                method: 'PUT',
                body: JSON.stringify({ command_name: newCommand, scope_type: newScopeType, target_type: newTargetType, target_id: newTargetId })
            });
            this.closeModal();
            this.loadCommandsData();
        });
    }

    async deleteScopeRule(ruleId) {
        if (!confirm('Delete this scope rule?')) return;
        await this.apiCall(`/scope-rules/${ruleId}`, { method: 'DELETE' });
        this.loadCommandsData();
    }

    // ── Daily Deals ──
    addDailyDeal() {
        const item_id = document.getElementById('deal-item-select')?.value;
        const discount = parseInt(document.getElementById('deal-discount')?.value);
        const stock = document.getElementById('deal-stock')?.value ? parseInt(document.getElementById('deal-stock').value) : null;
        if (!item_id || !discount) { this.showNotification('Select an item and discount %', 'warning'); return; }
        this.apiCall('/shop/daily-deals', {
            method: 'POST',
            body: JSON.stringify({ item_id, discount, stock })
        }).then(() => this.loadShopData());
    }

    // ── Fishing Logs ──
    viewFishingLogs() {
        this.apiCall('/fishing/logs').then(data => {
            if (!data) return;
            this.showModal('Fishing Profit Analysis', `
                <pre style="max-height:400px;overflow:auto;font-size:0.8rem;background:var(--bg-secondary);padding:1rem;border-radius:0.5rem;">${JSON.stringify(data, null, 2)}</pre>
            `);
        });
    }

    downloadFishingData() {
        window.open(`${this.apiEndpoint}/fishing/export?guild=${this.currentGuild || ''}`, '_blank');
    }

    // ── Giveaways ──
    createGiveaway() {
        const prize = parseInt(document.getElementById('giveaway-prize')?.value);
        const winners = parseInt(document.getElementById('giveaway-winners')?.value) || 1;
        const duration = parseInt(document.getElementById('giveaway-duration')?.value) || 24;
        const channel = document.getElementById('giveaway-channel')?.value;
        if (!prize || !channel) { this.showNotification('Prize amount and channel are required', 'warning'); return; }
        this.apiCall('/giveaways', {
            method: 'POST',
            body: JSON.stringify({ prize, max_winners: winners, duration_hours: duration, channel_id: channel })
        }).then(res => {
            if (res) { this.showNotification('Giveaway created!', 'success'); this.loadGiveawaysData(); }
        });
    }

    loadGiveawayHistory() {
        this.apiCall('/giveaways/history').then(data => {
            const list = document.getElementById('giveaway-history-list');
            if (!list || !data) return;
            if (!data.length) { list.innerHTML = '<div style="color:var(--text-secondary);">No history yet</div>'; return; }
            list.innerHTML = data.map(g => `
                <div class="list-item">
                    <span>Prize: $${Number(g.prize).toLocaleString()} &middot; Winners: ${g.winner_count || 0}</span>
                    <span style="color:var(--text-secondary);font-size:0.8rem;">${timeAgo(g.ended_at)}</span>
                </div>
            `).join('');
        });
    }

    // ── Moderation ──
    addAutopurge() {
        this.showModal('Add Autopurge Schedule', `
            <div class="form-group">
                <label>Channel ID</label>
                <input type="text" id="modal-autopurge-channel" placeholder="Channel ID...">
            </div>
            <div class="form-group">
                <label>Interval (minutes)</label>
                <input type="number" id="modal-autopurge-interval" min="1" value="60">
            </div>
            <div class="form-group">
                <label>Max Message Age (minutes)</label>
                <input type="number" id="modal-autopurge-age" min="1" value="1440">
            </div>
        `, async () => {
            const channel_id = document.getElementById('modal-autopurge-channel')?.value.trim();
            const interval = parseInt(document.getElementById('modal-autopurge-interval')?.value);
            const max_age = parseInt(document.getElementById('modal-autopurge-age')?.value);
            if (!channel_id) { alert('Channel ID required'); return; }
            await this.apiCall('/moderation/autopurge', {
                method: 'POST',
                body: JSON.stringify({ channel_id, interval_minutes: interval, max_age_minutes: max_age })
            });
            this.closeModal();
            this.loadModerationData();
        });
    }

    addToBlacklist() {
        const userId = document.getElementById('blacklist-user-id')?.value.trim();
        if (!userId) { this.showNotification('Enter a User ID', 'warning'); return; }
        const reason = document.getElementById('blacklist-reason')?.value.trim() || null;
        this.apiCall('/moderation/blacklist', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, reason })
        }).then(res => {
            if (res) {
                document.getElementById('blacklist-user-id').value = '';
                const reasonEl = document.getElementById('blacklist-reason');
                if (reasonEl) reasonEl.value = '';
                this.loadModerationData();
            }
        });
    }

    addToWhitelist() {
        const userId = document.getElementById('whitelist-user-id')?.value.trim();
        if (!userId) { this.showNotification('Enter a User ID', 'warning'); return; }
        const reason = document.getElementById('whitelist-reason')?.value.trim() || null;
        this.apiCall('/moderation/whitelist', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, reason })
        }).then(res => {
            if (res) {
                document.getElementById('whitelist-user-id').value = '';
                const reasonEl = document.getElementById('whitelist-reason');
                if (reasonEl) reasonEl.value = '';
                this.loadModerationData();
            }
        });
    }

    editBlacklistEntry(userId, listType) {
        const card = document.querySelector(`#${listType} .blacklist-card[onclick*="'${userId}'"]`);
        const currentReason = card?.querySelector('.blacklist-reason')?.textContent || '';
        const displayReason = currentReason === 'No reason' ? '' : currentReason;

        this.showModal(`Edit ${listType === 'blacklist' ? 'Blacklist' : 'Whitelist'} Entry`, `
            <div class="form-group">
                <label>User ID</label>
                <input type="text" value="${userId}" disabled style="opacity:0.6;">
            </div>
            <div class="form-group">
                <label>Reason</label>
                <textarea id="modal-bl-reason" rows="3" placeholder="Reason for ${listType === 'blacklist' ? 'blacklisting' : 'whitelisting'}..." style="width:100%;resize:vertical;">${displayReason}</textarea>
            </div>
        `, async () => {
            const reason = document.getElementById('modal-bl-reason')?.value.trim() || null;
            await this.apiCall(`/moderation/${listType}`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId, reason })
            });
            this.closeModal();
            this.loadModerationData();
        });
    }

    // ── Reaction Roles ──
    addReactionRole() {
        const message_id = document.getElementById('rr-message-id')?.value.trim();
        const channel_id = document.getElementById('rr-channel-id')?.value.trim();
        const emoji = document.getElementById('rr-emoji')?.value.trim();
        const role_id = document.getElementById('rr-role-id')?.value.trim();
        if (!message_id || !channel_id || !emoji || !role_id) {
            this.showNotification('All fields are required', 'warning'); return;
        }
        this.apiCall('/reaction-roles', {
            method: 'POST',
            body: JSON.stringify({ message_id, channel_id, emoji_raw: emoji, role_id })
        }).then(res => {
            if (res) {
                this.showNotification('Reaction role added!', 'success');
                ['rr-message-id', 'rr-channel-id', 'rr-emoji', 'rr-role-id'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.value = '';
                });
                this.loadReactionRolesData();
            }
        });
    }

    // ── Leaderboards ──
    switchLeaderboard(type) {
        document.querySelectorAll('[data-leaderboard]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-leaderboard') === type);
        });
        this.apiCall(`/stats/leaderboard?type=${type}`).then(data => {
            const list = document.getElementById('leaderboard-content');
            if (!list) return;
            if (!data || !data.length) { list.innerHTML = '<div style="color:var(--text-secondary);">No data</div>'; return; }
            list.innerHTML = `<table class="leaderboard-table"><thead><tr><th>#</th><th>User</th><th>Value</th></tr></thead><tbody>${
                data.map((u, i) => `<tr><td>${i + 1}</td><td>${u.username || u.user_id}</td><td>$${Number(u.value).toLocaleString()}</td></tr>`).join('')
            }</tbody></table>`;
        });
    }

    // ── ML Settings ──
    addMLSetting() {
        this.showModal('Add ML Setting', `
            <div class="form-group">
                <label>Setting Key</label>
                <input type="text" id="modal-ml-key" placeholder="e.g. learning_rate">
            </div>
            <div class="form-group">
                <label>Value</label>
                <input type="text" id="modal-ml-value" placeholder="e.g. 0.01">
            </div>
        `, async () => {
            const key = document.getElementById('modal-ml-key')?.value.trim();
            const value = document.getElementById('modal-ml-value')?.value.trim();
            if (!key || !value) { alert('Both fields required'); return; }
            await this.apiCall('/ml/settings', {
                method: 'POST',
                body: JSON.stringify({ key, value })
            });
            this.closeModal();
            this.loadMLSettingsData();
        });
    }

    // ── User Management ──
    searchUsers() {
        const query = document.getElementById('user-management-search')?.value.trim();
        if (!query) return;
        this.apiCall(`/users/search?q=${encodeURIComponent(query)}`).then(users => {
            const list = document.getElementById('user-search-results');
            if (!list) return;
            if (!users || !users.length) { list.innerHTML = '<div style="color:var(--text-secondary);">No users found</div>'; return; }
            list.innerHTML = users.map(u => `
                <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${u.username || u.user_id}</strong>
                        <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:0.5rem;">${u.user_id}</span>
                    </div>
                    <div style="display:flex;gap:0.8rem;font-size:0.85rem;">
                        <span>Wallet: $${Number(u.wallet || 0).toLocaleString()}</span>
                        <span>Bank: $${Number(u.bank || 0).toLocaleString()}</span>
                    </div>
                </div>
            `).join('');
        });
    }

    grantBadge() {
        const userId = document.getElementById('badge-user-id')?.value.trim();
        const badgeType = document.getElementById('badge-type')?.value;
        if (!userId) { this.showNotification('Enter a User ID', 'warning'); return; }
        this.apiCall('/users/badges', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, badge: badgeType, action: 'grant' })
        }).then(res => {
            if (res) this.showNotification(`Granted ${badgeType} badge to ${userId}`, 'success');
        });
    }

    revokeBadge() {
        const userId = document.getElementById('badge-user-id')?.value.trim();
        const badgeType = document.getElementById('badge-type')?.value;
        if (!userId) { this.showNotification('Enter a User ID', 'warning'); return; }
        this.apiCall('/users/badges', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, badge: badgeType, action: 'revoke' })
        }).then(res => {
            if (res) this.showNotification(`Revoked ${badgeType} badge from ${userId}`, 'success');
        });
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new BronxBotDashboard();
});

// Additional utility functions
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0
    }).format(amount);
}

function formatNumber(num) {
    if (num >= 1e15) {
        return (num / 1e15).toFixed(1) + 'Q';
    } else if (num >= 1e12) {
        return (num / 1e12).toFixed(1) + 'T';
    } else if (num >= 1e9) {
        return (num / 1e9).toFixed(1) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(1) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(1) + 'K';
    }
    return num.toString();
}

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