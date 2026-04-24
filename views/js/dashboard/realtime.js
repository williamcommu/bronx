// ============================================================
//  dashboard/realtime.js — Socket.io / WebSocket handling
// ============================================================

/**
 * Realtime communication mixin for BronxBotDashboard
 * Handles Socket.io connections and event handling
 */
export const RealtimeMixin = {
    socket: null,
    lastStatsUpdate: null,
    realtimeData: {
        users: 0,
        commands: { total: 0, lastHour: 0 },
        economy: 0,
        fishing: { total: 0, today: 0 }
    },

    // ── Initialization ─────────────────────────────────────────
    initializeRealtime() {
        if (typeof io === 'undefined') {
            console.warn('Socket.io not loaded');
            return;
        }
        this.socket = io();
        this.setupSocketListeners();
        this.updateConnectionStatus('connecting');
    },

    setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('Connected to real-time server');
            this.updateConnectionStatus('connected');
            this.toast('Connected to real-time updates', 'success', 3000);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from real-time server');
            this.updateConnectionStatus('disconnected');
            this.toast('Lost connection to real-time updates', 'error', 3000);
        });

        this.socket.on('db-ping', (data) => {
            this.updateDatabaseStatus(data);
        });

        this.socket.on('stats-update', (stats) => {
            this.lastStatsUpdate = new Date();
            this.realtimeData = stats;
            if (this.charts.overview) {
                this.updateChartsWithRealtime(stats);
            }
            this.showDataUpdateIndicator();
        });

        this.socket.on('server-stats-update', (stats) => {
            if (this.currentTab === 'overview' && stats.guildId === this.currentGuild) {
                this.updateOverviewStats(stats);
            }
        });

        this.socket.on('initial-stats', (data) => {
            console.log('Received initial stats', data);
            if (data.serverStats) {
                const el = document.getElementById('live-users-count');
                if (el) el.textContent = data.serverStats.connectedClients;
            }
        });

        this.socket.on('api-stats-update', (data) => {
            this.updateApiStats(data);
        });

        this.socket.on('manual-update', (stats) => {
            this.toast('Manual update received', 'success', 3000);
            this.updateRealtimeStats(stats);
        });

        // ── Stats tracking events ──────────────────────────────
        this.socket.on('member-event', (data) => {
            // bump activity cards if currently viewing activity tab
            if (this.currentTab === 'activity') {
                const el = document.getElementById('new-members-week');
                if (el && data.type === 'join') {
                    const cur = parseInt(el.textContent.replace(/\D/g, '')) || 0;
                    el.textContent = String(cur + 1);
                }
            }
            if (this.currentTab === 'overview' && data.type === 'join') {
                const section = document.getElementById('overview-content');
                if (section) {
                    const cards = section.querySelectorAll('.stat-card-value');
                    if (cards[3]) {
                        const cur = parseInt(cards[3].textContent.replace(/\D/g, '')) || 0;
                        cards[3].textContent = (cur + 1).toLocaleString();
                    }
                }
            }
        });

        this.socket.on('message-stats-update', () => {
            if (this.currentTab === 'activity') {
                const el = document.getElementById('messages-today');
                if (el) {
                    const cur = parseInt(el.textContent.replace(/\D/g, '')) || 0;
                    el.textContent = String(cur + 1);
                }
            }
        });

        this.socket.on('command-stats-update', (data) => {
            if (this.currentTab === 'statistics') {
                const el = document.getElementById('stats-commands-run');
                if (el) {
                    const cur = parseInt(el.textContent.replace(/\D/g, '')) || 0;
                    el.textContent = String(cur + 1);
                }
            }
            if (this.currentTab === 'overview') {
                const section = document.getElementById('overview-content');
                if (section) {
                    const cards = section.querySelectorAll('.stat-card-value');
                    if (cards[2]) {
                        const cur = parseInt(cards[2].textContent.replace(/\D/g, '')) || 0;
                        cards[2].textContent = (cur + 1).toLocaleString();
                    }
                }
            }
            if (this.currentTab === 'activity') {
                const el = document.getElementById('commands-today');
                if (el) {
                    const cur = parseInt(el.textContent.replace(/\D/g, '')) || 0;
                    el.textContent = String(cur + 1);
                }
            }
        });
    },

    // ── Status Updates ─────────────────────────────────────────
    updateConnectionStatus(status) {
        const pill = document.getElementById('socket-status');
        if (!pill) return;
        pill.classList.remove('online', 'error');
        if (status === 'connected') {
            pill.classList.add('online');
            pill.title = 'Realtime: Connected';
        } else if (status === 'disconnected') {
            pill.classList.add('error');
            pill.title = 'Realtime: Disconnected';
        } else {
            pill.title = 'Realtime: Connecting...';
        }
    },

    updateDatabaseStatus(data) {
        const pill = document.getElementById('db-status');
        if (!pill) return;
        pill.classList.remove('online', 'error');
        if (data.status === 'connected') {
            pill.classList.add('online');
            pill.title = `Database: Connected (${data.responseTime}ms)`;
        } else {
            pill.classList.add('error');
            pill.title = `Database: Error - ${data.error}`;
        }
    },

    // ── Data Updates ───────────────────────────────────────────
    updateRealtimeStats(stats) {
        if (!stats) return;
        if (this.currentTab === 'overview' && this.selectedServerId && this.currentGuild) {
            this.loadOverviewData();
        }
        if (this.charts.overview) {
            this.updateChartsWithRealtime(stats);
        }
        this.showDataUpdateIndicator();
    },

    updateApiStats(data) {
        console.log('API Stats:', data);
    },

    updateChartsWithRealtime(stats) {
        if (this.charts.activity && stats.commands) {
            const chart = this.charts.activity;
            const now = new Date();
            chart.data.labels.push(now.toLocaleTimeString());
            chart.data.datasets[0].data.push(stats.commands.lastHour);
            if (chart.data.labels.length > 20) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }
            chart.update('none');
        }
    },

    // ── Room Management ────────────────────────────────────────
    joinServerRoom(serverId) {
        if (this.socket && serverId) {
            this.socket.emit('join-server', serverId);
        }
    },

    leaveServerRoom(serverId) {
        if (this.socket && serverId) {
            this.socket.emit('leave-server', serverId);
        }
    }
};
