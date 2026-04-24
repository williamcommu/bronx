// ============================================================
//  dashboard/features/statistics.js — Statistics, leaderboards, charts
// ============================================================

import { formatNumber, timeAgo, debounce } from '../utils.js';

// ── Chart colour tokens ────────────────────────────────────────
const C = {
    grid:       'rgba(255,255,255,0.04)',
    tick:       'rgba(255,255,255,0.4)',
    label:      'rgba(255,255,255,0.6)',
    accent:     '#b4a7d6',
    accentFill: 'rgba(180,167,214,0.18)',
    green:      '#10b981',
    greenFill:  'rgba(16,185,129,0.15)',
    red:        '#ef4444',
    redFill:    'rgba(239,68,68,0.15)',
    blue:       '#3b82f6',
    blueFill:   'rgba(59,130,246,0.15)',
    cyan:       '#06b6d4',
    cyanFill:   'rgba(6,182,212,0.15)',
    yellow:     '#f59e0b',
    palette:    ['#b4a7d6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6']
};

// Log transform helper - compresses large values while keeping small ones visible
function logTransform(val) {
    if (val <= 0) return 0;
    return Math.log10(val + 1);  // +1 to handle values between 0-1
}

// Inverse for displaying original values in tooltips
function logInverse(val) {
    return Math.pow(10, val) - 1;
}

// shared chart.js scale defaults with log-transformed data
function defaultScales() {
    return {
        x: { ticks: { color: C.tick, maxRotation: 0 }, grid: { color: C.grid } },
        y: { 
            ticks: { 
                color: C.tick,
                callback: (value) => formatNumber(Math.round(logInverse(value)))
            }, 
            grid: { color: C.grid },
            beginAtZero: true
        }
    };
}

// Default tooltip that shows original (non-logged) values
function logTooltipCallback() {
    return {
        callbacks: {
            label: (ctx) => {
                const original = Math.round(logInverse(ctx.raw));
                return `${ctx.dataset.label}: ${formatNumber(original)}`;
            }
        }
    };
}

// linear scale for stacked charts (log doesn't work well with stacking)
function linearScales() {
    return {
        x: { ticks: { color: C.tick, maxRotation: 0 }, grid: { color: C.grid } },
        y: { ticks: { color: C.tick }, grid: { color: C.grid }, beginAtZero: true }
    };
}

/**
 * Statistics & Leaderboards feature mixin
 */
export const StatisticsMixin = {
    charts: {},
    statsRange: '7d',
    activityRange: '7d',

    // ── Event Listeners ────────────────────────────────────────
    setupStatisticsListeners() {
        // time range pills for statistics tab
        document.querySelectorAll('.time-range-toggle[data-target="statistics"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="statistics"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.statsRange = e.target.getAttribute('data-range');
                this.loadStatisticsData();
            });
        });

        // time range pills for activity tab
        document.querySelectorAll('.time-range-toggle[data-target="activity"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="activity"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.activityRange = e.target.getAttribute('data-range');
                this.loadActivityData();
            });
        });

        // command search filter (debounced)
        const cmdSearch = document.getElementById('stats-cmd-search');
        if (cmdSearch) {
            cmdSearch.addEventListener('input', debounce(() => this._filterTopCommandsTable(cmdSearch.value), 200));
        }

        // channel filter dropdown
        const chanFilter = document.getElementById('stats-channel-filter');
        if (chanFilter) {
            chanFilter.addEventListener('change', () => this._reloadCommandsByChannel());
        }

        // existing leaderboard listeners
        document.querySelectorAll('[data-leaderboard]').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchLeaderboard(e.target.getAttribute('data-leaderboard')));
        });
    },

    setupLeaderboardListeners() {
        document.getElementById('refresh-leaderboard')?.addEventListener('click', () => this.loadLeaderboardData());
        document.getElementById('leaderboard-type')?.addEventListener('change', (e) => {
            this._lbPage = 1;
            this._lbRetryCount = 0;
            if (this._lbRetryTimer) clearTimeout(this._lbRetryTimer);
            this.switchLeaderboard(e.target.value);
        });
        document.getElementById('lb-prev')?.addEventListener('click', () => {
            if (this._lbPage > 1) {
                const type = document.getElementById('leaderboard-type')?.value || 'xp';
                this.switchLeaderboard(type, this._lbPage - 1);
            }
        });
        document.getElementById('lb-next')?.addEventListener('click', () => {
            const type = document.getElementById('leaderboard-type')?.value || 'xp';
            this.switchLeaderboard(type, this._lbPage + 1);
        });
    },

    setupModLogListeners() {
        document.getElementById('filter-mod-logs')?.addEventListener('click', () => this.loadModLogsData());
    },

    // ── New analytics tab listeners ────────────────────────────
    setupFishingAnalyticsListeners() {
        document.getElementById('refresh-fishing-stats')?.addEventListener('click', () => this.loadFishingAnalytics());
        document.getElementById('fishing-range')?.addEventListener('change', () => this.loadFishingAnalytics());
    },

    setupEconomyAnalyticsListeners() {
        document.getElementById('refresh-economy-analytics')?.addEventListener('click', () => this.loadEconomyAnalytics());
    },

    // called from core.js initialize() — no-op, charts are created on data load
    setupCharts() {},

    // ── Statistics Data ────────────────────────────────────────
    async loadStatisticsData() {
        const range = this.statsRange || '7d';

        // fetch summary + detailed command data in parallel
        const [stats, cmdData, channels] = await Promise.all([
            this.apiCall(`/stats?range=${range}`),
            this.apiCall(`/stats/commands?range=${range}`),
            this.apiCall(`/stats/channels?range=${range}`)
        ]);

        // ── summary cards ──
        if (stats) {
            this._setText('stats-commands-run', formatNumber(stats.total_commands || 0));
            this._setText('stats-messages-seen', formatNumber(stats.total_messages || 0));
            this._setText('stats-active-users', formatNumber(stats.active_users || 0));
            const top = (stats.popular_commands || [])[0];
            this._setText('stats-top-command', top ? top.command : '—');
        }

        // ── top commands table ──
        const topBody = document.getElementById('top-commands-tbody');
        const topEmpty = document.getElementById('top-commands-empty');
        const cmds = cmdData?.topCommands || stats?.popular_commands || [];
        this._topCommandsCache = cmds;
        if (topBody) {
            if (!cmds.length) {
                topBody.innerHTML = '';
                if (topEmpty) topEmpty.style.display = '';
            } else {
                if (topEmpty) topEmpty.style.display = 'none';
                const total = cmds.reduce((s, c) => s + c.count, 0) || 1;
                topBody.innerHTML = cmds.map((c, i) => {
                    const pct = ((c.count / total) * 100).toFixed(1);
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
                    return `<tr><td style="font-weight:600;">${medal}</td><td><code style="color:var(--accent);">${c.command}</code></td><td>${formatNumber(c.count)}</td><td>${pct}%</td></tr>`;
                }).join('');
            }
        }

        // ── commands by channel table ──
        this._cmdByChannelCache = cmdData?.commandsByChannel || [];
        this._renderCmdByChannel(this._cmdByChannelCache);

        // ── channel filter dropdown ──
        const chanSelect = document.getElementById('stats-channel-filter');
        if (chanSelect && channels && channels.length) {
            const current = chanSelect.value;
            chanSelect.innerHTML = '<option value="">all channels</option>'
                + channels.map(ch => `<option value="${ch.channel_id}">${ch.channel_name || ch.channel_id}</option>`).join('');
            chanSelect.value = current;
        }

        // ── trend line chart ──
        this._setupCommandTrendChart(cmdData?.dailyTrend || []);

        // ── breakdown horizontal bar chart ──
        this._setupCommandBreakdownChart(cmds);
    },

    // ── Helpers ────────────────────────────────────────────────
    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    },

    _filterTopCommandsTable(query) {
        const cmds = this._topCommandsCache || [];
        const q = (query || '').toLowerCase();
        const filtered = q ? cmds.filter(c => c.command.toLowerCase().includes(q)) : cmds;
        const topBody = document.getElementById('top-commands-tbody');
        if (!topBody) return;
        const total = cmds.reduce((s, c) => s + c.count, 0) || 1;
        topBody.innerHTML = filtered.map((c, i) => {
            const pct = ((c.count / total) * 100).toFixed(1);
            return `<tr><td>${i + 1}</td><td><code style="color:var(--accent);">${c.command}</code></td><td>${formatNumber(c.count)}</td><td>${pct}%</td></tr>`;
        }).join('');
    },

    async _reloadCommandsByChannel() {
        const chan = document.getElementById('stats-channel-filter')?.value || '';
        const range = this.statsRange || '7d';
        let url = `/stats/commands?range=${range}`;
        if (chan) url += `&channel=${chan}`;
        const data = await this.apiCall(url);
        this._renderCmdByChannel(data?.commandsByChannel || []);
    },

    _renderCmdByChannel(rows) {
        const body = document.getElementById('cmd-by-channel-tbody');
        const empty = document.getElementById('cmd-by-channel-empty');
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        body.innerHTML = rows.slice(0, 50).map(r =>
            `<tr><td><code>${r.channel_name || r.channel_id}</code></td><td><code style="color:var(--accent);">${r.command}</code></td><td>${formatNumber(r.count)}</td></tr>`
        ).join('');
    },

    // ── Charts ─────────────────────────────────────────────────
    _setupCommandTrendChart(trend) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('command-trend-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.commandTrend) this.charts.commandTrend.destroy();

        this.charts.commandTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: trend.map(d => {
                    const dt = new Date(d.date);
                    return `${dt.getMonth() + 1}/${dt.getDate()}`;
                }),
                datasets: [{
                    label: 'commands',
                    data: trend.map(d => logTransform(d.count)),
                    borderColor: C.accent,
                    backgroundColor: C.accentFill,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: C.accent
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: logTooltipCallback() },
                scales: defaultScales()
            }
        });
    },

    _setupCommandBreakdownChart(cmds) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('command-usage-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.commands) this.charts.commands.destroy();

        const top = cmds.slice(0, 8);
        this.charts.commands = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: top.map(c => c.command),
                datasets: [{
                    label: 'uses',
                    data: top.map(c => logTransform(c.count)),
                    backgroundColor: C.palette.slice(0, top.length),
                    borderWidth: 0,
                    borderRadius: 4,
                    barPercentage: 0.6
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: logTooltipCallback() },
                scales: {
                    x: { ticks: { color: C.tick, callback: (v) => formatNumber(Math.round(logInverse(v))) }, grid: { color: C.grid } },
                    y: { ticks: { color: C.label, font: { family: 'system-ui, sans-serif' } }, grid: { display: false } }
                }
            }
        });
    },

    // ── Leaderboard Data ───────────────────────────────────────
    _lbPage: 1,
    _lbPageSize: 15,
    _lbRetryTimer: null,
    _lbRetryCount: 0,
    _lbMaxRetries: 10,
    _lbActiveType: 'xp',
    _defaultAvatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    
    async loadLeaderboardData() {
        const typeSelect = document.getElementById('leaderboard-type');
        const type = typeSelect?.value || 'xp';
        this._lbPage = 1;
        this._lbRetryCount = 0;
        if (this._lbRetryTimer) clearTimeout(this._lbRetryTimer);
        
        // Show loading state immediately
        const list = document.getElementById('leaderboard-body');
        if (list) {
            list.innerHTML = '<tr><td colspan="3" style="color:var(--fg-dim);text-align:center;padding:1.5rem;"><i class="fas fa-spinner fa-spin"></i> Loading leaderboard…</td></tr>';
        }
        
        this.switchLeaderboard(type);
        
        // Auto-refresh after 4s in case first load had unresolved users
        this._lbRetryTimer = setTimeout(() => {
            this.switchLeaderboard(type, 1, true);
        }, 4000);
    },

    switchLeaderboard(type, page = 1, isRetry = false) {
        this._lbPage = page;
        this._lbActiveType = type;
        if (!isRetry) {
            this._lbRetryCount = 0;
            if (this._lbRetryTimer) clearTimeout(this._lbRetryTimer);
        } else if (type !== this._lbActiveType) {
            // Stale retry from a previous type — cancel
            return;
        }
        
        document.querySelectorAll('#leaderboards .tab-pill').forEach(p => p.classList.remove('active'));
        const clickedPill = document.querySelector(`#leaderboards .tab-pill[onclick*="${type}"]`);
        if (clickedPill) clickedPill.classList.add('active');
        
        const offset = (page - 1) * this._lbPageSize;
        this.apiCall(`/leaderboard/${type}?limit=${this._lbPageSize}&offset=${offset}`).then(response => {
            const list = document.getElementById('leaderboard-body');
            const pageEl = document.getElementById('lb-page');
            const prevBtn = document.getElementById('lb-prev');
            const nextBtn = document.getElementById('lb-next');
            
            // Handle new response format { data, unresolved, total }
            const data = response?.data || (Array.isArray(response) ? response : []);
            const unresolved = response?.unresolved || 0;
            
            if (pageEl) pageEl.textContent = page;
            if (prevBtn) prevBtn.disabled = page <= 1;
            if (nextBtn) nextBtn.disabled = !data || data.length < this._lbPageSize;
            
            if (!list) return;
            if (!data || !data.length) {
                list.innerHTML = '<tr><td colspan="3" style="color:var(--fg-dim);text-align:center;padding:1rem;">No entries</td></tr>';
                return;
            }
            list.innerHTML = data.map((u, i) => {
                const rank = offset + i + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
                const isLoading = u.loading === true;
                const avatarUrl = isLoading ? '' : (u.proxy_avatar_url || u.avatar_url || `/api/proxy/avatar/${u.user_id}`);
                const displayName = u.username || u.user_id;
                const avatarHtml = isLoading 
                    ? `<div style="width:24px;height:24px;border-radius:50%;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-spinner fa-spin" style="font-size:10px;color:var(--fg-dim);"></i></div>`
                    : `<img src="${avatarUrl}" alt="" style="width:24px;height:24px;border-radius:50%;flex-shrink:0;" loading="lazy" onerror="this.onerror=null;this.src='${this._defaultAvatarUrl}'">`;
                const nameStyle = isLoading ? 'color:var(--fg-dim);font-style:italic;' : '';
                return `
                <tr>
                    <td style="font-weight:600;">${medal}</td>
                    <td style="display:flex;align-items:center;gap:0.5rem;">
                        ${avatarHtml}
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${nameStyle}">${displayName}</span>
                    </td>
                    <td style="font-weight:500;">${this.formatNumber(u.value || 0)}</td>
                </tr>`;
            }).join('');
            
            // Auto-retry if there are unresolved users (rate limited), with exponential backoff
            if (unresolved > 0 && this._lbRetryCount < this._lbMaxRetries) {
                this._lbRetryCount++;
                // Exponential backoff: 3s, 6s, 9s... capped at 15s
                const delay = Math.min(3000 * this._lbRetryCount, 15000);
                this._lbRetryTimer = setTimeout(() => {
                    this.switchLeaderboard(type, page, true);
                }, delay);
            }
        });
    },

    // ── Mod Logs Data ──────────────────────────────────────────
    async loadModLogsData() {
        const action = document.getElementById('mod-log-action')?.value || '';
        const userId = document.getElementById('mod-log-user')?.value || '';
        let url = '/moderation/logs';
        const params = [];
        if (action) params.push(`action=${action}`);
        if (userId) params.push(`user_id=${userId}`);
        if (params.length) url += '?' + params.join('&');

        const logs = await this.apiCall(url);
        const container = document.getElementById('mod-logs-data') || document.getElementById('mod-logs-content');
        if (!container) return;
        if (!logs || !logs.length) {
            container.innerHTML = '<div style="padding:1.5rem;color:var(--fg-dim);text-align:center;"><i class="fas fa-clipboard-check"></i> no mod logs found</div>';
            return;
        }
        const icons = { ban: 'gavel', kick: 'boot', warn: 'exclamation-triangle', mute: 'volume-mute', unban: 'unlock', timeout: 'clock', auto_spam: 'robot', auto_filter: 'filter', auto_raid: 'shield-virus', auto_link: 'link', auto_caps: 'font', auto_mention: 'at' };
        container.innerHTML = logs.map(log => {
            const icon = icons[log.action] || 'shield-alt';
            const isAuto = (log.action || '').startsWith('auto_');
            const statusColor = log.active ? 'var(--red, #e74c3c)' : 'var(--green, #2ecc71)';
            const statusLabel = log.active ? 'ACTIVE' : 'PARDONED';
            const pts = log.points != null ? log.points : 0;
            const caseNum = log.case_number ? `#${log.case_number}` : '';
            return `
            <div class="mod-log-entry" style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid var(--border);">
                <i class="fas fa-${icon}" style="color:${isAuto ? 'var(--yellow, #f1c40f)' : 'var(--accent)'};font-size:0.82rem;width:1.2rem;text-align:center;"></i>
                <div style="flex:1;display:flex;flex-direction:column;gap:0.15rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                        ${caseNum ? `<span style="font-family:monospace;font-size:0.7rem;color:var(--fg-dim);background:var(--bg-card,rgba(255,255,255,0.05));padding:0.05rem 0.35rem;border-radius:3px;">${caseNum}</span>` : ''}
                        <span style="font-weight:600;font-size:0.82rem;text-transform:capitalize;">${log.action}</span>
                        <span style="font-size:0.65rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:4px;color:#fff;background:${statusColor};">${statusLabel}</span>
                        ${pts ? `<span style="font-size:0.68rem;color:var(--yellow,#f1c40f);" title="infraction points"><i class="fas fa-star" style="font-size:0.6rem;"></i> ${pts}</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.72rem;color:var(--fg-dim);">
                        <span style="font-family:monospace;">user: ${log.target_id || log.user_id}</span>
                        ${log.moderator_id ? `<span style="font-family:monospace;">mod: ${log.moderator_id}</span>` : ''}
                    </div>
                    <span style="font-size:0.72rem;color:var(--fg-dim);">${log.reason || 'no reason provided'}</span>
                </div>
                <span style="font-size:0.68rem;color:var(--fg-dim);white-space:nowrap;">${timeAgo(log.created_at || log.timestamp)}</span>
            </div>`;
        }).join('');
    },

    // ── Activity Data ──────────────────────────────────────────
    async loadActivityData() {
        const range = this.activityRange || '7d';
        const data = await this.apiCall(`/stats/activity?range=${range}`);
        if (!data) return;

        // ── summary cards ──
        this._setText('daily-active-users', formatNumber(data.dailyActiveUsersToday || 0));
        this._setText('messages-today', formatNumber(data.messagesToday || 0));
        this._setText('new-members-week', formatNumber(data.newMembersWeek || 0));
        this._setText('commands-today', formatNumber(data.commandsToday || 0));

        // ── messages / day chart ──
        this._setupMessagesChart(data.dailyMessages || []);

        // ── member growth chart ──
        this._setupMembersChart(data.dailyMembers || []);

        // ── active users / day chart ──
        this._setupActiveUsersChart(data.dailyActiveUsers || []);
    },

    _hideMessagesChart() {
        // Hide the messages chart container
        const container = document.getElementById('activity-messages-chart')?.closest('.chart-container, .card');
        if (container) container.style.display = 'none';
    },

    _setupMessagesChart(rows) {
        if (typeof Chart === 'undefined') return;
        // Ensure container is visible (may have been hidden previously)
        const container = document.getElementById('activity-messages-chart')?.closest('.chart-container, .card');
        if (container) container.style.display = '';
        const ctx = document.getElementById('activity-messages-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.activityMessages) this.charts.activityMessages.destroy();

        const labels = rows.map(r => { const d = new Date(r.date); return `${d.getMonth()+1}/${d.getDate()}`; });

        this.charts.activityMessages = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'messages', data: rows.map(r => r.messages), backgroundColor: C.accentFill, borderColor: C.accent, borderWidth: 1, borderRadius: 3 },
                    { label: 'edits', data: rows.map(r => r.edits), backgroundColor: C.blueFill, borderColor: C.blue, borderWidth: 1, borderRadius: 3 },
                    { label: 'deletes', data: rows.map(r => r.deletes), backgroundColor: C.redFill, borderColor: C.red, borderWidth: 1, borderRadius: 3 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: C.label, boxWidth: 12 } } },
                scales: { ...linearScales(), x: { ...linearScales().x, stacked: true }, y: { ...linearScales().y, stacked: true } }
            }
        });
    },

    _setupMembersChart(rows) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('activity-members-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.activityMembers) this.charts.activityMembers.destroy();

        const labels = rows.map(r => { const d = new Date(r.date); return `${d.getMonth()+1}/${d.getDate()}`; });

        this.charts.activityMembers = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'joins', data: rows.map(r => logTransform(r.joins)), borderColor: C.green, backgroundColor: C.greenFill, fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3 },
                    { label: 'leaves', data: rows.map(r => logTransform(r.leaves)), borderColor: C.red, backgroundColor: C.redFill, fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: C.label, boxWidth: 12 } }, tooltip: logTooltipCallback() },
                scales: defaultScales()
            }
        });
    },

    _setupActiveUsersChart(rows) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('activity-users-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.activityUsers) this.charts.activityUsers.destroy();

        const labels = rows.map(r => { const d = new Date(r.date); return `${d.getMonth()+1}/${d.getDate()}`; });

        this.charts.activityUsers = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'active users',
                    data: rows.map(r => logTransform(r.count)),
                    borderColor: C.cyan,
                    backgroundColor: C.cyanFill,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: C.cyan
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: logTooltipCallback() },
                scales: defaultScales()
            }
        });
    },

    // ================================================================
    //  FISHING ANALYTICS
    // ================================================================
    async loadFishingAnalytics() {
        const range = document.getElementById('fishing-range')?.value || '7d';
        const data = await this.apiCall(`/stats/fishing?range=${range}`);
        if (!data) return;

        // stat cards
        this._setText('fish-total-caught', formatNumber(data.totalCaught || 0));
        this._setText('fish-total-value', '$' + formatNumber(data.totalValue || 0));
        this._setText('fish-unique-fishers', formatNumber(data.uniqueFishers || 0));
        const avg = data.totalCaught ? Math.round((data.totalValue || 0) / data.totalCaught) : 0;
        this._setText('fish-avg-value', '$' + formatNumber(avg));

        // catch trend chart
        this._setupFishingTrendChart(data.catchTrend || []);

        // rarity distribution chart
        this._setupFishingRarityChart(data.rarityBreakdown || []);

        // top fish table
        this._renderTopFish(data.topFish || []);
    },

    _setupFishingTrendChart(trend) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('fishing-catch-trend-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.fishingTrend) this.charts.fishingTrend.destroy();

        const labels = trend.map(d => {
            const dt = new Date(d.date);
            return `${dt.getMonth() + 1}/${dt.getDate()}`;
        });

        this.charts.fishingTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'catches',
                    data: trend.map(d => logTransform(d.count)),
                    borderColor: C.blue,
                    backgroundColor: C.blueFill,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: C.blue
                }, {
                    label: 'value',
                    data: trend.map(d => logTransform(d.value)),
                    borderColor: C.green,
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 2,
                    borderDash: [4, 2],
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: C.label, boxWidth: 12 } }, tooltip: logTooltipCallback() },
                scales: {
                    ...defaultScales(),
                    y1: { position: 'right', ticks: { color: C.tick, callback: (v) => formatNumber(Math.round(logInverse(v))) }, grid: { display: false }, beginAtZero: true }
                }
            }
        });
    },

    _setupFishingRarityChart(rarities) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('fishing-rarity-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.fishingRarity) this.charts.fishingRarity.destroy();

        const rarityColors = {
            common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6',
            epic: '#a855f7', legendary: '#f59e0b', mythic: '#ef4444'
        };

        this.charts.fishingRarity = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: rarities.map(r => r.rarity || 'unknown'),
                datasets: [{
                    data: rarities.map(r => r.count),
                    backgroundColor: rarities.map(r => rarityColors[(r.rarity || '').toLowerCase()] || C.accent),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: C.label, padding: 12, boxWidth: 14 } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const r = rarities[ctx.dataIndex];
                                return ` ${r.count} caught — $${formatNumber(r.value || 0)} value`;
                            }
                        }
                    }
                }
            }
        });
    },

    _renderTopFish(fish) {
        const body = document.getElementById('top-fish-tbody');
        if (!body) return;
        if (!fish.length) {
            body.innerHTML = '<tr><td colspan="5" style="color:var(--fg-dim);text-align:center;padding:1rem;">no data yet</td></tr>';
            return;
        }
        body.innerHTML = fish.map(f => `
            <tr>
                <td style="font-weight:600;">${f.fish_name || f.name || '—'}</td>
                <td><span style="color:var(--accent);text-transform:capitalize;">${f.rarity || '—'}</span></td>
                <td>$${formatNumber(f.max_value || f.value || 0)}</td>
                <td>${f.max_weight ? (f.max_weight + ' lb') : '—'}</td>
                <td>${formatNumber(f.count || f.times_caught || 0)}</td>
            </tr>
        `).join('');
    },

    // ================================================================
    //  ECONOMY ANALYTICS
    // ================================================================
    async loadEconomyAnalytics() {
        const data = await this.apiCall('/stats/economy');
        if (!data) return;

        // stat cards
        this._setText('econ-total-wealth', '$' + formatNumber(data.totalWealth || 0));
        this._setText('econ-wallet-total', '$' + formatNumber(data.totalWallet || 0));
        this._setText('econ-bank-total', '$' + formatNumber(data.totalBank || 0));
        const ratio = data.totalBank ? ((data.totalWallet || 0) / data.totalBank).toFixed(2) : '—';
        this._setText('econ-ratio', ratio === '—' ? '—' : ratio + ':1');

        // wealth distribution chart
        this._setupWealthDistributionChart(data.wealthDistribution || []);

        // gambling overview
        this._renderGamblingOverview(data.gambling || {});
    },

    _setupWealthDistributionChart(dist) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('wealth-distribution-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.wealthDist) this.charts.wealthDist.destroy();

        this.charts.wealthDist = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dist.map(d => d.label),
                datasets: [{
                    label: 'users',
                    data: dist.map(d => logTransform(d.count)),
                    backgroundColor: C.palette.slice(0, dist.length),
                    borderWidth: 0,
                    borderRadius: 4,
                    barPercentage: 0.7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: logTooltipCallback() },
                scales: defaultScales()
            }
        });
    },

    _renderGamblingOverview(gambling) {
        this._setText('gamble-total-wagered', '$' + formatNumber((gambling.totalWon || 0) + (gambling.totalLost || 0)));
        this._setText('gamble-total-won', '$' + formatNumber(gambling.totalWon || 0));
        const totalWag = (gambling.totalWon || 0) + (gambling.totalLost || 0);
        const edge = totalWag > 0 ? (((gambling.totalLost || 0) / totalWag) * 100).toFixed(1) + '%' : '—';
        this._setText('gamble-house-edge', edge);

        const body = document.getElementById('gambling-breakdown-tbody');
        if (!body) return;
        const games = gambling.gameBreakdown || [];
        if (!games.length) {
            body.innerHTML = '<tr><td colspan="5" style="color:var(--fg-dim);text-align:center;padding:1rem;">no gambling data</td></tr>';
            return;
        }
        body.innerHTML = games.map(g => `
            <tr>
                <td style="font-weight:600;text-transform:capitalize;">${g.game || '—'}</td>
                <td>${formatNumber(g.games || 0)}</td>
                <td style="color:${C.green};">$${formatNumber(g.won || 0)}</td>
                <td style="color:${C.red};">$${formatNumber(g.lost || 0)}</td>
                <td style="color:${C.yellow};">$${formatNumber(g.biggestWin || 0)}</td>
            </tr>
        `).join('');
    },

    // ================================================================
    //  GAMBLING ANALYTICS (detailed tab)
    // ================================================================
    async loadGamblingAnalytics() {
        const data = await this.apiCall('/stats/economy');
        if (!data?.gambling) return;
        const gambling = data.gambling;
        const games = gambling.gameBreakdown || [];

        // stat cards
        const totalBets = games.reduce((s, g) => s + (g.games || 0), 0);
        this._setText('gamble-total-bets', formatNumber(totalBets));
        const biggestWin = games.reduce((m, g) => Math.max(m, g.biggestWin || 0), 0);
        this._setText('gamble-biggest-win', '$' + formatNumber(biggestWin));
        this._setText('gamble-unique-players', formatNumber(games.length));

        // P&L bar chart
        this._setupGamblingPnlChart(games);

        // detail table
        const body = document.getElementById('gambling-detail-tbody');
        if (!body) return;
        if (!games.length) {
            body.innerHTML = '<tr><td colspan="6" style="color:var(--fg-dim);text-align:center;">no data</td></tr>';
            return;
        }
        body.innerHTML = games.map(g => {
            const net = (g.won || 0) - (g.lost || 0);
            const netColor = net >= 0 ? C.green : C.red;
            return `
            <tr>
                <td style="font-weight:600;text-transform:capitalize;">${g.game || '—'}</td>
                <td>${formatNumber(g.games || 0)}</td>
                <td style="color:${C.green};">$${formatNumber(g.won || 0)}</td>
                <td style="color:${C.red};">$${formatNumber(g.lost || 0)}</td>
                <td style="color:${netColor};">${net >= 0 ? '+' : ''}$${formatNumber(Math.abs(net))}</td>
                <td style="color:${C.yellow};">$${formatNumber(g.biggestWin || 0)}</td>
            </tr>`;
        }).join('');
    },

    _setupGamblingPnlChart(games) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('gambling-pnl-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.gamblingPnl) this.charts.gamblingPnl.destroy();

        const labels = games.map(g => g.game || 'unknown');
        const netData = games.map(g => (g.won || 0) - (g.lost || 0));
        const colors = netData.map(v => v >= 0 ? C.green : C.red);

        this.charts.gamblingPnl = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'net P&L',
                    data: netData,
                    backgroundColor: colors.map(c => c + '44'),
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: linearScales()  // P&L has signed values, keep linear
            }
        });
    },

    // ================================================================
    //  VOICE ANALYTICS
    // ================================================================

    voiceRange: '7d',

    setupVoiceAnalyticsListeners() {
        document.querySelectorAll('.time-range-toggle[data-target="voice-analytics"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="voice-analytics"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.voiceRange = e.target.getAttribute('data-range');
                this.loadVoiceAnalytics();
            });
        });
        document.getElementById('refresh-voice-analytics')?.addEventListener('click', () => this.loadVoiceAnalytics());
    },

    async loadVoiceAnalytics() {
        const range = this.voiceRange || '7d';
        const data = await this.apiCall(`/stats/voice?range=${range}`);
        if (!data || data.error) return;

        // ── summary cards ──
        this._setText('voice-total-sessions', formatNumber(data.totalSessions || 0));
        this._setText('voice-unique-users', formatNumber(data.uniqueUsers || 0));
        this._setText('voice-total-time', this._formatDuration(data.totalMinutes || 0));
        this._setText('voice-avg-session', this._formatDuration(data.avgSessionMin || 0));

        // ── daily voice activity chart ──
        this._setupVoiceDailyChart(data.dailyVoice || []);

        // ── peak hours chart ──
        this._setupVoicePeakHoursChart(data.peakHours || []);

        // ── top channels table ──
        this._renderVoiceTopChannels(data.topChannels || []);

        // ── top users table ──
        this._renderVoiceTopUsers(data.topUsers || []);

        // ── recent sessions table ──
        this._renderVoiceRecentSessions(data.recentSessions || []);
    },

    _formatDuration(minutes) {
        if (minutes < 60) return `${minutes}m`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
        const d = Math.floor(h / 24);
        const rh = h % 24;
        return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
    },

    _setupVoiceDailyChart(rows) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('voice-daily-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.voiceDaily) this.charts.voiceDaily.destroy();

        const labels = rows.map(r => { const d = new Date(r.date); return `${d.getMonth()+1}/${d.getDate()}`; });

        this.charts.voiceDaily = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'joins',
                        data: rows.map(r => logTransform(r.joins)),
                        borderColor: C.green,
                        backgroundColor: C.greenFill,
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: C.green
                    },
                    {
                        label: 'leaves',
                        data: rows.map(r => logTransform(r.leaves)),
                        borderColor: C.red,
                        backgroundColor: C.redFill,
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: C.red
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: C.label, boxWidth: 12 } }, tooltip: logTooltipCallback() },
                scales: defaultScales()
            }
        });
    },

    _setupVoicePeakHoursChart(hours) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('voice-peak-hours-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.voicePeakHours) this.charts.voicePeakHours.destroy();

        const labels = hours.map(h => {
            const hr = h.hour;
            if (hr === 0) return '12am';
            if (hr === 12) return '12pm';
            return hr < 12 ? `${hr}am` : `${hr - 12}pm`;
        });
        const data = hours.map(h => h.joins);
        const maxVal = Math.max(...data, 1);
        const bgColors = data.map(v => {
            const intensity = Math.max(0.15, (v / maxVal) * 0.8);
            return `rgba(180,167,214,${intensity})`;
        });

        this.charts.voicePeakHours = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'joins',
                    data,
                    backgroundColor: bgColors,
                    borderColor: C.accent,
                    borderWidth: 1,
                    borderRadius: 3,
                    barPercentage: 0.85
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    ...defaultScales(),
                    x: { ...defaultScales().x, ticks: { color: C.tick, maxRotation: 45, font: { size: 10 } } }
                }
            }
        });
    },

    _renderVoiceTopChannels(channels) {
        const tbody = document.getElementById('voice-top-channels-tbody');
        const empty = document.getElementById('voice-channels-empty');
        if (!tbody) return;

        if (!channels.length) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = channels.map((ch, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
            const channelName = ch.channel_name ? `#${ch.channel_name}` : `<#${ch.channel_id}>`;
            return `<tr>
                <td style="text-align:center;">${medal}</td>
                <td>${channelName}</td>
                <td>${formatNumber(ch.sessions)}</td>
                <td>${formatNumber(ch.unique_users)}</td>
                <td>${this._formatDuration(ch.total_minutes)}</td>
            </tr>`;
        }).join('');
    },

    _renderVoiceTopUsers(users) {
        const tbody = document.getElementById('voice-top-users-tbody');
        const empty = document.getElementById('voice-users-empty');
        if (!tbody) return;

        if (!users.length) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = users.map((u, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
            const userName = u.username || `User#${String(u.user_id).slice(-4)}`;
            const avatarUrl = u.proxy_avatar_url || `/api/proxy/avatar/${u.user_id}`;
            return `<tr>
                <td style="text-align:center;">${medal}</td>
                <td style="display:flex;align-items:center;gap:0.5rem;"><img src="${avatarUrl}" alt="" style="width:20px;height:20px;border-radius:50%;" onerror="this.onerror=null;this.src='https://cdn.discordapp.com/embed/avatars/0.png'">${userName}</td>
                <td>${formatNumber(u.sessions)}</td>
                <td>${formatNumber(u.channels_used)}</td>
                <td>${this._formatDuration(u.total_minutes)}</td>
            </tr>`;
        }).join('');
    },

    _renderVoiceRecentSessions(sessions) {
        const tbody = document.getElementById('voice-recent-tbody');
        const empty = document.getElementById('voice-recent-empty');
        if (!tbody) return;

        if (!sessions.length) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = sessions.map(s => {
            const userName = s.username || `User#${String(s.user_id).slice(-4)}`;
            const channelName = s.channel_name || `<#${s.channel_id}>`;
            const joinTime = timeAgo(s.join_time);
            let duration = '—';
            if (s.duration_sec !== null && s.duration_sec > 0) {
                duration = this._formatDuration(Math.round(s.duration_sec / 60));
            } else if (s.duration_sec === null) {
                duration = '<span style="color:' + C.green + ';">● active</span>';
            }
            return `<tr>
                <td>${userName}</td>
                <td>${channelName}</td>
                <td>${joinTime}</td>
                <td>${duration}</td>
            </tr>`;
        }).join('');
    },

    // ================================================================
    //  TOP 10 USERS
    // ================================================================

    topUsersRange: '7d',

    setupTopUsersListeners() {
        document.querySelectorAll('.time-range-toggle[data-target="top-users"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="top-users"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.topUsersRange = e.target.getAttribute('data-range');
                this.loadTopUsersData();
            });
        });
        document.getElementById('refresh-top-users')?.addEventListener('click', () => this.loadTopUsersData());

        // chart type toggles
        document.querySelectorAll('.chart-type-toggle').forEach(group => {
            group.querySelectorAll('.chart-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    group.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const canvasId = group.dataset.canvas;
                    const chartType = btn.dataset.type;
                    this._switchChartType(canvasId, chartType);
                });
            });
        });
    },

    async loadTopUsersData() {
        const range = this.topUsersRange || '7d';
        const data = await this.apiCall(`/stats/top-users?range=${range}`);
        if (!data || data.error) return;

        const medals = ['🥇', '🥈', '🥉'];
        const getUserDisplay = (u) => {
            const name = u.username || `User#${String(u.user_id).slice(-4)}`;
            const avatarUrl = u.proxy_avatar_url || `/api/proxy/avatar/${u.user_id}`;
            return `<span style="display:flex;align-items:center;gap:0.4rem;"><img src="${avatarUrl}" style="width:20px;height:20px;border-radius:50%;" onerror="this.onerror=null;this.src='https://cdn.discordapp.com/embed/avatars/0.png'">${name}</span>`;
        };

        // Messages table
        this._renderTopTable('top-messages-tbody', 'top-messages-empty', data.messages || [], (u, i) =>
            `<tr><td>${medals[i] || (i + 1)}</td><td>${getUserDisplay(u)}</td><td>${formatNumber(u.total)}</td></tr>`
        );

        // VC table
        this._renderTopTable('top-vc-tbody', 'top-vc-empty', data.voice || [], (u, i) =>
            `<tr><td>${medals[i] || (i + 1)}</td><td>${getUserDisplay(u)}</td><td>${this._formatDuration(u.total)}</td></tr>`
        );

        // Commands table
        this._renderTopTable('top-cmds-tbody', 'top-cmds-empty', data.commands || [], (u, i) =>
            `<tr><td>${medals[i] || (i + 1)}</td><td>${getUserDisplay(u)}</td><td>${formatNumber(u.total)}</td></tr>`
        );

        // Message distribution pie chart
        this._renderTopUsersChart('top-users-msg-chart', data.messages || [], 'messages');
        // Voice distribution pie chart
        this._renderTopUsersChart('top-users-vc-chart', data.voice || [], 'voice (minutes)');

        // Store data for chart-type switching
        this._topUsersData = data;
    },

    _renderTopTable(tbodyId, emptyId, items, rowFn) {
        const tbody = document.getElementById(tbodyId);
        const empty = document.getElementById(emptyId);
        if (!tbody) return;
        if (!items.length) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        tbody.innerHTML = items.map(rowFn).join('');
    },

    _renderTopUsersChart(canvasId, items, label) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !items.length) return;

        if (this.charts[canvasId]) { this.charts[canvasId].destroy(); delete this.charts[canvasId]; }

        const labels = items.map(u => u.username || `User#${String(u.user_id).slice(-4)}`);
        const values = items.map(u => u.total);
        const colors = items.map((_, i) => C.palette[i % C.palette.length]);

        // Store config for chart type switching
        canvas._chartData = { labels, values, colors, label };

        this.charts[canvasId] = new Chart(canvas, {
            type: 'pie',
            data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: C.tick, boxWidth: 12 } } }
            }
        });
    },

    /**
     * Switch chart type for a given canvas (pie <-> bar)
     */
    _switchChartType(canvasId, type) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !canvas._chartData) return;
        const { labels, values, colors, label } = canvas._chartData;

        if (this.charts[canvasId]) { this.charts[canvasId].destroy(); delete this.charts[canvasId]; }

        if (type === 'bar') {
            this.charts[canvasId] = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ label, data: values.map(v => logTransform(v)), backgroundColor: colors, borderRadius: 6, maxBarThickness: 40 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { display: false }, tooltip: logTooltipCallback() },
                    scales: {
                        x: { ticks: { color: C.tick, callback: (v) => formatNumber(Math.round(logInverse(v))) }, grid: { color: C.grid }, beginAtZero: true },
                        y: { ticks: { color: C.tick }, grid: { display: false } }
                    }
                }
            });
        } else {
            this.charts[canvasId] = new Chart(canvas, {
                type: type === 'line' ? 'line' : 'pie',
                data: type === 'line'
                    ? { labels, datasets: [{ label, data: values.map(v => logTransform(v)), borderColor: C.accent, backgroundColor: C.accentFill, tension: 0.3, fill: true }] }
                    : { labels, datasets: [{ data: values, backgroundColor: colors }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: type === 'line' ? 'top' : 'right', labels: { color: C.tick, boxWidth: 12 } }, ...(type === 'line' ? { tooltip: logTooltipCallback() } : {}) },
                    ...(type === 'line' ? { scales: defaultScales() } : {})
                }
            });
        }
    },

    // ================================================================
    //  ACTIVITY HEATMAP
    // ================================================================

    heatmapRange: '7d',

    setupHeatmapListeners() {
        document.querySelectorAll('.time-range-toggle[data-target="heatmap"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="heatmap"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.heatmapRange = e.target.getAttribute('data-range');
                this.loadHeatmapData();
            });
        });
        document.getElementById('refresh-heatmap')?.addEventListener('click', () => this.loadHeatmapData());
    },

    async loadHeatmapData() {
        const range = this.heatmapRange || '7d';
        const data = await this.apiCall(`/stats/heatmap?range=${range}`);
        if (!data || !data.matrix) return;

        const canvas = document.getElementById('heatmap-chart');
        if (!canvas) return;

        // Draw heatmap on canvas using 2D context (Chart.js doesn't have a native heatmap)
        this._renderCanvasHeatmap(canvas, data.matrix, data.rowLabels, data.colLabels);
    },

    /**
     * Render a heatmap directly on canvas (not Chart.js — it lacks native heatmap support)
     */
    _renderCanvasHeatmap(canvas, matrix, rowLabels, colLabels) {
        const ctx = canvas.getContext('2d');
        const parent = canvas.parentElement;
        const W = parent.clientWidth || 800;
        const H = parent.clientHeight || 300;
        canvas.width = W;
        canvas.height = H;

        const padLeft = 50, padTop = 30, padRight = 10, padBottom = 10;
        const cols = colLabels.length;
        const rows = rowLabels.length;
        const cellW = (W - padLeft - padRight) / cols;
        const cellH = (H - padTop - padBottom) / rows;

        // find max
        let maxVal = 0;
        for (const row of matrix) for (const v of row) if (v > maxVal) maxVal = v;
        if (maxVal === 0) maxVal = 1;

        ctx.clearRect(0, 0, W, H);

        // draw cells
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const val = matrix[r][c];
                const intensity = val / maxVal;
                const h = 260 - intensity * 35; // purple → blue shift
                const s = 40 + intensity * 40;
                const l = 12 + intensity * 45;
                ctx.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
                ctx.fillRect(padLeft + c * cellW, padTop + r * cellH, cellW - 1, cellH - 1);

                // value text on bright cells
                if (intensity > 0.3) {
                    ctx.fillStyle = intensity > 0.6 ? '#fff' : 'rgba(255,255,255,0.6)';
                    ctx.font = `${Math.min(cellW, cellH) * 0.35}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(val, padLeft + c * cellW + cellW / 2, padTop + r * cellH + cellH / 2);
                }
            }
        }

        // row labels
        ctx.fillStyle = C.tick;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < rows; r++) {
            ctx.fillText(rowLabels[r], padLeft - 6, padTop + r * cellH + cellH / 2);
        }

        // col labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let c = 0; c < cols; c++) {
            if (c % 2 === 0) { // every other hour to avoid crowding
                ctx.fillText(colLabels[c], padLeft + c * cellW + cellW / 2, padTop - 4);
            }
        }
    },

    // ================================================================
    //  USER PROFILES
    // ================================================================

    userProfileRange: '7d',

    setupUserProfilesListeners() {
        document.querySelectorAll('.time-range-toggle[data-target="user-profiles"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="user-profiles"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.userProfileRange = e.target.getAttribute('data-range');
                if (this._profileUserId) this._loadUserProfile(this._profileUserId);
            });
        });

        document.getElementById('load-user-profile')?.addEventListener('click', () => {
            const input = document.getElementById('profile-user-search');
            const userId = input?.value?.trim();
            if (!userId || !/^\d+$/.test(userId)) {
                this.toast('enter a valid user ID', 'warning');
                return;
            }
            this._profileUserId = userId;
            this._loadUserProfile(userId);
        });
    },

    async _loadUserProfile(userId) {
        const range = this.userProfileRange || '7d';
        const data = await this.apiCall(`/stats/user/${userId}?range=${range}`);
        if (!data || data.error) {
            this.toast('failed to load user profile', 'error');
            return;
        }

        document.getElementById('user-profile-content').style.display = '';
        document.getElementById('user-profile-empty').style.display = 'none';

        this._setText('profile-messages', formatNumber(data.totals?.messages || 0));
        this._setText('profile-voice', this._formatDuration(data.totals?.voice_minutes || 0));
        this._setText('profile-commands', formatNumber(data.totals?.commands || 0));

        // daily chart
        const daily = data.daily || [];
        if (!daily.length) return;

        const labels = daily.map(d => {
            const dt = new Date(d.date);
            return `${dt.getMonth() + 1}/${dt.getDate()}`;
        });

        const canvas = document.getElementById('profile-daily-chart');
        if (!canvas) return;

        // store data for chart type switching
        canvas._chartData = {
            labels,
            values: daily.map(d => d.messages),
            colors: [C.accent],
            label: 'messages'
        };
        canvas._multiData = {
            labels,
            datasets: [
                { label: 'messages', data: daily.map(d => logTransform(d.messages)), borderColor: C.accent, backgroundColor: C.accentFill, tension: 0.3, fill: true },
                { label: 'commands', data: daily.map(d => logTransform(d.commands)), borderColor: C.green, backgroundColor: C.greenFill, tension: 0.3, fill: true },
                { label: 'VC mins', data: daily.map(d => logTransform(d.voice_minutes)), borderColor: C.cyan, backgroundColor: C.cyanFill, tension: 0.3, fill: true }
            ]
        };

        if (this.charts['profile-daily-chart']) { this.charts['profile-daily-chart'].destroy(); }
        this.charts['profile-daily-chart'] = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: canvas._multiData.datasets
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: C.tick } }, tooltip: logTooltipCallback() },
                scales: defaultScales()
            }
        });

        // ── infractions section ──
        this._loadUserInfractions(userId);
    },

    async _loadUserInfractions(userId) {
        const container = document.getElementById('profile-infractions');
        // Create the section container if not present
        if (!container) {
            const profileContent = document.getElementById('user-profile-content');
            if (!profileContent) return;
            const section = document.createElement('div');
            section.id = 'profile-infractions';
            section.style.cssText = 'margin-top:1.2rem;';
            profileContent.appendChild(section);
            return this._loadUserInfractions(userId);
        }

        container.innerHTML = '<div style="padding:1rem;color:var(--fg-dim);text-align:center;"><i class="fas fa-spinner fa-spin"></i> loading infractions…</div>';

        try {
            const summary = await this.apiCall(`/moderation/user/${userId}/summary`);
            if (!summary || summary.error) {
                container.innerHTML = '<div style="padding:1rem;color:var(--fg-dim);text-align:center;"><i class="fas fa-check-circle"></i> no infractions</div>';
                return;
            }

            const total = summary.total || 0;
            const active = summary.active || 0;
            const pardoned = summary.pardoned || 0;
            const points = summary.active_points != null ? summary.active_points : 0;
            const recent = Array.isArray(summary.recent) ? summary.recent.slice(0, 10) : [];

            const infIcons = { ban: 'gavel', kick: 'boot', warn: 'exclamation-triangle', mute: 'volume-mute', timeout: 'clock', auto_spam: 'robot', auto_filter: 'filter' };

            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;">
                    <i class="fas fa-exclamation-circle" style="color:var(--accent);"></i>
                    <span style="font-weight:700;font-size:0.88rem;">Infractions</span>
                    ${points ? `<span style="margin-left:auto;font-size:0.72rem;font-weight:700;padding:0.15rem 0.55rem;border-radius:6px;color:#fff;background:var(--red,#e74c3c);">${points} pts active</span>` : ''}
                </div>
                <div style="display:flex;gap:0.75rem;margin-bottom:0.8rem;flex-wrap:wrap;">
                    <div style="padding:0.4rem 0.8rem;border-radius:6px;background:var(--bg-card,rgba(255,255,255,0.05));font-size:0.78rem;">
                        <span style="color:var(--fg-dim);">total</span> <strong>${total}</strong>
                    </div>
                    <div style="padding:0.4rem 0.8rem;border-radius:6px;background:var(--bg-card,rgba(255,255,255,0.05));font-size:0.78rem;">
                        <span style="color:var(--red,#e74c3c);">active</span> <strong>${active}</strong>
                    </div>
                    <div style="padding:0.4rem 0.8rem;border-radius:6px;background:var(--bg-card,rgba(255,255,255,0.05));font-size:0.78rem;">
                        <span style="color:var(--green,#2ecc71);">pardoned</span> <strong>${pardoned}</strong>
                    </div>
                </div>
                ${recent.length ? `<div style="display:flex;flex-direction:column;gap:0;">
                    ${recent.map(inf => {
                        const ic = infIcons[inf.action || inf.type] || 'shield-alt';
                        const st = inf.active ? 'ACTIVE' : 'PARDONED';
                        const stC = inf.active ? 'var(--red,#e74c3c)' : 'var(--green,#2ecc71)';
                        const p = inf.points != null ? inf.points : 0;
                        const cn = inf.case_number ? `#${inf.case_number}` : '';
                        return `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0;border-bottom:1px solid var(--border);">
                            <i class="fas fa-${ic}" style="color:var(--accent);font-size:0.75rem;width:1rem;text-align:center;"></i>
                            <div style="flex:1;display:flex;flex-direction:column;gap:0.05rem;">
                                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                    ${cn ? `<span style="font-family:monospace;font-size:0.68rem;color:var(--fg-dim);">${cn}</span>` : ''}
                                    <span style="font-weight:600;font-size:0.78rem;text-transform:capitalize;">${inf.action || inf.type}</span>
                                    <span style="font-size:0.6rem;font-weight:600;padding:0.05rem 0.3rem;border-radius:3px;color:#fff;background:${stC};">${st}</span>
                                    ${p ? `<span style="font-size:0.65rem;color:var(--yellow,#f1c40f);"><i class="fas fa-star" style="font-size:0.55rem;"></i> ${p}</span>` : ''}
                                </div>
                                <span style="font-size:0.68rem;color:var(--fg-dim);">${inf.reason || 'no reason'}</span>
                            </div>
                            <span style="font-size:0.65rem;color:var(--fg-dim);white-space:nowrap;">${timeAgo(inf.created_at)}</span>
                        </div>`;
                    }).join('')}
                </div>` : '<div style="padding:0.5rem;color:var(--fg-dim);font-size:0.78rem;">no recent infractions</div>'}
            `;
        } catch (e) {
            container.innerHTML = '<div style="padding:1rem;color:var(--fg-dim);text-align:center;"><i class="fas fa-times-circle"></i> failed to load infractions</div>';
        }
    },

    // ================================================================
    //  CHANNEL ANALYTICS
    // ================================================================

    channelAnalyticsRange: '7d',

    setupChannelAnalyticsListeners() {
        document.querySelectorAll('.time-range-toggle[data-target="channel-analytics"] .range-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-toggle[data-target="channel-analytics"] .range-pill')
                    .forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.channelAnalyticsRange = e.target.getAttribute('data-range');
                this.loadChannelAnalytics();
            });
        });
        document.getElementById('refresh-channel-analytics')?.addEventListener('click', () => this.loadChannelAnalytics());
    },

    async loadChannelAnalytics() {
        const range = this.channelAnalyticsRange || '7d';
        let data = await this.apiCall(`/stats/channels/analytics?range=${range}`);
        if (!data || !Array.isArray(data)) return;

        // Hide channels that couldn't be resolved to a name (show as raw ID)
        data = data.filter(ch => ch.channel_name && !/^\d+$/.test(ch.channel_name));

        const resolveChannel = (ch) => ch.channel_name ? `#${ch.channel_name}` : `#${ch.channel_id}`;

        // Table
        const tbody = document.getElementById('channel-analytics-tbody');
        const empty = document.getElementById('channel-analytics-empty');
        if (tbody) {
            if (!data.length) {
                tbody.innerHTML = '';
                if (empty) empty.style.display = '';
            } else {
                if (empty) empty.style.display = 'none';
                tbody.innerHTML = data.map((ch, i) => `<tr>
                    <td>${i + 1}</td>
                    <td>${resolveChannel(ch)}</td>
                    <td>${formatNumber(ch.messages)}</td>
                    <td>${formatNumber(ch.edits)}</td>
                    <td>${formatNumber(ch.deletes)}</td>
                    <td>${formatNumber(ch.unique_users)}</td>
                </tr>`).join('');
            }
        }

        // Pie chart
        const pieCanvas = document.getElementById('channel-pie-chart');
        if (pieCanvas && data.length) {
            const top10 = data.slice(0, 10);
            const labels = top10.map(ch => resolveChannel(ch));
            const values = top10.map(ch => ch.messages);
            const colors = top10.map((_, i) => C.palette[i % C.palette.length]);

            pieCanvas._chartData = { labels, values, colors, label: 'messages' };

            if (this.charts['channel-pie-chart']) this.charts['channel-pie-chart'].destroy();
            this.charts['channel-pie-chart'] = new Chart(pieCanvas, {
                type: 'pie',
                data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'right', labels: { color: C.tick, boxWidth: 12 } } }
                }
            });
        }

        // Stacked bar chart (messages vs edits vs deletes per top channel)
        const stackedCanvas = document.getElementById('channel-stacked-chart');
        if (stackedCanvas && data.length) {
            const top10 = data.slice(0, 10);
            const labels = top10.map(ch => resolveChannel(ch.channel_id));

            if (this.charts['channel-stacked-chart']) this.charts['channel-stacked-chart'].destroy();
            this.charts['channel-stacked-chart'] = new Chart(stackedCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'messages', data: top10.map(ch => ch.messages), backgroundColor: C.accent, borderRadius: 4, maxBarThickness: 30 },
                        { label: 'edits', data: top10.map(ch => ch.edits), backgroundColor: C.yellow, borderRadius: 4, maxBarThickness: 30 },
                        { label: 'deletes', data: top10.map(ch => ch.deletes), backgroundColor: C.red, borderRadius: 4, maxBarThickness: 30 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: C.tick } } },
                    scales: {
                        x: { stacked: false, ticks: { color: C.tick, maxRotation: 45 }, grid: { color: C.grid } },
                        y: {
                            stacked: false,
                            type: 'logarithmic',
                            ticks: {
                                color: C.tick,
                                callback: (v) => Number.isInteger(Math.log10(v)) || [1,2,5].includes(v / Math.pow(10, Math.floor(Math.log10(v)))) ? formatNumber(v) : ''
                            },
                            grid: { color: C.grid },
                            beginAtZero: false
                        }
                    }
                }
            });
        }
    }
};
