// ============================================================
//  dashboard/features/overview.js — Overview tab & stats
// ============================================================

import { formatNumber, timeAgo } from '../utils.js';

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

// Log transform helper - compresses large values while keeping small ones visible
function logTransform(val) {
    if (val <= 0) return 0;
    return Math.log10(val + 1);
}

function logInverse(val) {
    return Math.pow(10, val) - 1;
}

/**
 * Normalize activity action HTML:
 * - Keeps the first <b> (verb like Enabled/Disabled) as bold
 * - Converts subsequent <b>target</b> to <code>target</code>
 */
function formatActivityAction(html) {
    if (!html) return '';
    let first = true;
    return html.replace(/<b>(.*?)<\/b>/g, (match, inner) => {
        if (first) { first = false; return match; }
        return `<code>${inner}</code>`;
    });
}

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

        // Total Members
        if (cards[0] && stats.memberCount !== undefined && stats.memberCount !== null) {
            cards[0].textContent = Number(stats.memberCount).toLocaleString();
        }
        
        // Total Economy Value
        if (cards[1] && stats.totalEconomyValue !== undefined && stats.totalEconomyValue !== null) {
            cards[1].textContent = '$' + formatNumber(parseFloat(stats.totalEconomyValue) || 0);
        }

        // Commands Today
        if (cards[2] && stats.commandsToday !== undefined && stats.commandsToday !== null) {
            cards[2].textContent = Number(stats.commandsToday).toLocaleString();
        }

        // New Members Today
        if (cards[3] && stats.newMembersToday !== undefined && stats.newMembersToday !== null) {
            cards[3].textContent = Number(stats.newMembersToday).toLocaleString();
        }
    },

    // ── Activity Update ────────────────────────────────────────
    updateRecentActivity(activities) {
        const activityList = document.querySelector('#overview-content .activity-list');
        if (!activityList) return;

        if (!activities || activities.length === 0) {
            activityList.innerHTML = `<div class="activity-item activity-empty"><i class="fas fa-info-circle"></i><span>no recent activity in this server</span></div>`;
            return;
        }

        activityList.innerHTML = activities.map(a => {
            // New format with avatar, username, time, source, action
            if (a.avatar && a.source) {
                const userName = a.user_name ? `<span class="activity-user">${a.user_name}</span>` : '';
                return `
                    <div class="activity-item activity-item--rich">
                        <img src="${a.avatar}" alt="" class="activity-avatar" onerror="this.onerror=null;this.src='/api/proxy/avatar-default/0'">
                        ${userName}
                        <span class="activity-time" data-timestamp="${a.timestamp}">${timeAgo(a.timestamp)}</span>
                        <span class="activity-source"><em>${a.source}</em></span>
                        <span class="activity-action">${formatActivityAction(a.action)}</span>
                    </div>
                `;
            }
            // Legacy format fallback
            return `
                <div class="activity-item">
                    <i class="fas fa-${a.icon || 'info-circle'}"></i>
                    <span>${a.description || a.action}</span>
                    <span class="activity-time" data-timestamp="${a.timestamp || a.time}" style="margin-left:auto;font-size:0.72rem;color:var(--fg-dim);">${timeAgo(a.timestamp || a.time)}</span>
                </div>
            `;
        }).join('');
    },

    // Show "See More" activity modal
    async showActivityModal(page = 1) {
        const activityData = await this.apiCall(`/stats/recent-activity/all?page=${page}&limit=20`);
        if (!activityData || !activityData.activities) {
            this.toast('No activity data available', 'info');
            return;
        }

        const currentPage = page;
        const totalPages = activityData.totalPages || 1;

        const modalContent = `
            <div class="activity-modal-list">
                ${activityData.activities.map(a => {
                    const userName = a.user_name ? `<span class="activity-user">${a.user_name}</span>` : '';
                    return `
                    <div class="activity-item activity-item--rich">
                        <img src="${a.avatar}" alt="" class="activity-avatar" onerror="this.onerror=null;this.src='/api/proxy/avatar-default/0'">
                        ${userName}
                        <span class="activity-time" data-timestamp="${a.timestamp}">${timeAgo(a.timestamp)}</span>
                        <span class="activity-source"><em>${a.source}</em></span>
                        <span class="activity-action">${formatActivityAction(a.action)}</span>
                    </div>
                `}).join('')}
            </div>
            ${totalPages > 1 ? `
                <div class="activity-pagination">
                    <button class="btn btn-outline btn-sm activity-page-prev" ${currentPage <= 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> prev
                    </button>
                    <span class="activity-page-info">Page ${currentPage} of ${totalPages}</span>
                    <button class="btn btn-outline btn-sm activity-page-next" ${currentPage >= totalPages ? 'disabled' : ''}>
                        next <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            ` : ''}
        `;

        this.showModal('Recent Activity', modalContent);

        // Attach pagination handlers after modal renders
        if (totalPages > 1) {
            setTimeout(() => {
                const prevBtn = document.querySelector('.activity-page-prev');
                const nextBtn = document.querySelector('.activity-page-next');
                if (prevBtn) {
                    prevBtn.addEventListener('click', () => {
                        if (currentPage > 1) this.navigateActivityPage(currentPage - 1, totalPages);
                    });
                }
                if (nextBtn) {
                    nextBtn.addEventListener('click', () => {
                        if (currentPage < totalPages) this.navigateActivityPage(currentPage + 1, totalPages);
                    });
                }
            }, 0);
        }
    },

    // Navigate activity modal to a specific page without closing/reopening the modal
    async navigateActivityPage(page, totalPages) {
        const activityData = await this.apiCall(`/stats/recent-activity/all?page=${page}&limit=20`);
        if (!activityData || !activityData.activities) return;

        const currentPage = page;
        const resolvedTotalPages = activityData.totalPages || totalPages;

        // Update the modal body content in-place
        const modalBody = document.getElementById('modal-body');
        if (!modalBody) return;

        modalBody.innerHTML = `
            <div class="activity-modal-list">
                ${activityData.activities.map(a => {
                    const userName = a.user_name ? `<span class="activity-user">${a.user_name}</span>` : '';
                    return `
                    <div class="activity-item activity-item--rich">
                        <img src="${a.avatar}" alt="" class="activity-avatar" onerror="this.onerror=null;this.src='/api/proxy/avatar-default/0'">
                        ${userName}
                        <span class="activity-time" data-timestamp="${a.timestamp}">${timeAgo(a.timestamp)}</span>
                        <span class="activity-source"><em>${a.source}</em></span>
                        <span class="activity-action">${formatActivityAction(a.action)}</span>
                    </div>
                `}).join('')}
            </div>
            ${resolvedTotalPages > 1 ? `
                <div class="activity-pagination">
                    <button class="btn btn-outline btn-sm activity-page-prev" ${currentPage <= 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> prev
                    </button>
                    <span class="activity-page-info">Page ${currentPage} of ${resolvedTotalPages}</span>
                    <button class="btn btn-outline btn-sm activity-page-next" ${currentPage >= resolvedTotalPages ? 'disabled' : ''}>
                        next <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            ` : ''}
        `;

        // Re-attach pagination handlers
        const prevBtn = document.querySelector('.activity-page-prev');
        const nextBtn = document.querySelector('.activity-page-next');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (currentPage > 1) this.navigateActivityPage(currentPage - 1, resolvedTotalPages);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (currentPage < resolvedTotalPages) this.navigateActivityPage(currentPage + 1, resolvedTotalPages);
            });
        }

        // Scroll modal list back to top
        const list = modalBody.querySelector('.activity-modal-list');
        if (list) list.scrollTop = 0;
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
                        data: (data.messages || []).map(v => logTransform(v)),
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
                        data: (data.activeUsers || []).map(v => logTransform(v)),
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
                        data: (data.newMembers || []).map(v => logTransform(v)),
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
                        data: (data.commands || []).map(v => logTransform(v)),
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
                        cornerRadius: 8,
                        itemSort: (a, b) => b.raw - a.raw,  // Sort by value, largest first
                        callbacks: {
                            label: (ctx) => {
                                const original = Math.round(logInverse(ctx.raw));
                                return `${ctx.dataset.label}: ${formatNumber(original)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: C.tick, maxRotation: 0 },
                        grid: { color: C.grid }
                    },
                    y: {
                        ticks: { 
                            color: C.tick,
                            callback: (value) => formatNumber(Math.round(logInverse(value)))
                        },
                        grid: { color: C.grid },
                        beginAtZero: true
                    }
                }
            }
        });
    }
};
