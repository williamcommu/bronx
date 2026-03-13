// ============================================================
//  dashboard/features/overview.js — Overview tab & stats
// ============================================================

import { formatNumber } from '../utils.js';

// Chart colour tokens (matching statistics.js palette)
const C = {
    grid:       'rgba(255,255,255,0.04)',
    tick:       'rgba(255,255,255,0.4)',
    label:      'rgba(255,255,255,0.6)',
    accent:     '#b4a7d6',
    accentFill: 'rgba(180,167,214,0.18)',
    green:      '#10b981',
    greenFill:  'rgba(16,185,129,0.15)',
    red:        '#ef4444',
    blue:       '#3b82f6',
    blueFill:   'rgba(59,130,246,0.15)',
    cyan:       '#06b6d4',
    cyanFill:   'rgba(6,182,212,0.15)',
    yellow:     '#f59e0b',
    yellowFill: 'rgba(245,158,11,0.15)',
};

/**
 * Overview feature mixin
 */
export const OverviewMixin = {
    // ── Data Loading ───────────────────────────────────────────
    async loadOverviewData() {
        const stats = await this.apiCall('/stats/overview');

        if (stats && !stats.noServerSelected) {
            this.updateOverviewStats(stats);
        }

        const [activity, trend] = await Promise.all([
            this.apiCall('/stats/recent-activity'),
            this.apiCall('/stats/overview/trend')
        ]);
        if (activity) this.updateRecentActivity(activity);
        if (trend) this._setupOverviewTrendChart(trend);
    },

    // ── Stats Update ───────────────────────────────────────────
    updateOverviewStats(stats) {
        const section = document.getElementById('overview-content');
        if (!section) return;
        const cards = section.querySelectorAll('.stat-card-value');
        if (cards[0] && stats.memberCount !== undefined) {
            cards[0].textContent = stats.memberCount != null ? Number(stats.memberCount).toLocaleString() : '—';
        }
        if (cards[1]) cards[1].textContent = '$' + formatNumber(parseFloat(stats.totalEconomyValue) || 0);
        if (cards[2]) cards[2].textContent = (stats.commandsToday ?? 0).toLocaleString();
        if (cards[3]) cards[3].textContent = (stats.fishCaughtToday ?? 0).toLocaleString();
    },

    // ── Activity Update ────────────────────────────────────────
    updateRecentActivity(activities) {
        const activityList = document.querySelector('#overview-content .activity-list');
        if (!activityList) return;

        if (!activities || activities.length === 0) {
            activityList.innerHTML = `<div class="activity-item activity-empty"><i class="fas fa-info-circle"></i><span>no recent activity in this server</span></div>`;
            return;
        }

        activityList.innerHTML = activities.map(a => `
            <div class="activity-item">
                <i class="fas fa-${a.icon}"></i>
                <span>${a.description}</span>
                <span style="margin-left:auto;font-size:0.72rem;color:var(--fg-dim);">${a.time}</span>
            </div>
        `).join('');
    },

    // ── Overview Trend Chart ───────────────────────────────────
    _setupOverviewTrendChart(data) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('overview-trend-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts && this.charts.overviewTrend) this.charts.overviewTrend.destroy();
        if (!this.charts) this.charts = {};

        const labels = (data.labels || []).map(d => {
            const dt = new Date(d + 'T00:00:00');
            return `${dt.getMonth() + 1}/${dt.getDate()}`;
        });

        this.charts.overviewTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'messages',
                        data: data.messages || [],
                        borderColor: C.accent,
                        backgroundColor: C.accentFill,
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: C.accent
                    },
                    {
                        label: 'active users',
                        data: data.activeUsers || [],
                        borderColor: C.cyan,
                        backgroundColor: C.cyanFill,
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: C.cyan
                    },
                    {
                        label: 'new members',
                        data: data.newMembers || [],
                        borderColor: C.green,
                        backgroundColor: C.greenFill,
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: C.green
                    },
                    {
                        label: 'commands',
                        data: data.commands || [],
                        borderColor: C.yellow,
                        backgroundColor: C.yellowFill,
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: C.yellow
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: {
                            color: C.label,
                            boxWidth: 12,
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20,20,30,0.92)',
                        titleColor: '#fff',
                        bodyColor: 'rgba(255,255,255,0.8)',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        cornerRadius: 8
                    }
                },
                scales: {
                    x: {
                        ticks: { color: C.tick, maxRotation: 0 },
                        grid: { color: C.grid }
                    },
                    y: {
                        ticks: { color: C.tick },
                        grid: { color: C.grid },
                        beginAtZero: true
                    }
                }
            }
        });
    }
};
