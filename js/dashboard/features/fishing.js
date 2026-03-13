// ============================================================
//  dashboard/features/fishing.js — Fishing stats (read-only)
// ============================================================

import { formatNumber } from '../utils.js';

/**
 * Fishing feature mixin (read-only for server dashboards)
 */
export const FishingMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupFishingListeners() {
        // Fishing stats are read-only for server dashboards — no owner controls
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadFishingData() {
        const stats = await this.apiCall('/fishing/stats');
        if (stats) {
            const cards = document.querySelectorAll('#fishing .stat-card-value');
            if (cards[0]) cards[0].textContent = formatNumber(stats.total_caught || 0);
            if (cards[1]) cards[1].textContent = '$' + formatNumber(stats.most_valuable || 0);
            if (cards[2]) cards[2].textContent = formatNumber(stats.legendary_count || 0);
            if (cards[3]) cards[3].textContent = formatNumber(stats.fish_today || 0);
        }

        const gear = await this.apiCall('/fishing/gear');
        if (gear) {
            this.renderGearListReadOnly('rods-list', gear.rods || [], 'rod');
            this.renderGearListReadOnly('bait-list', gear.bait || [], 'bait');
        }
    },

    // ── Gear List Render ───────────────────────────────────────
    renderGearListReadOnly(listId, items, type) {
        const list = document.getElementById(listId);
        if (!list) return;
        if (items.length === 0) {
            list.innerHTML = `<p style="color:var(--fg-dim);font-size:0.82rem;">No ${type === 'rod' ? 'rods' : 'bait'} available</p>`;
            return;
        }
        list.innerHTML = items.map(item => `
            <div class="gear-card" style="cursor:default;">
                <div class="gear-card-icon"><i class="fas fa-${type === 'rod' ? 'magic' : 'worm'}"></i></div>
                <div class="gear-card-info">
                    <span class="gear-card-name">${item.name}</span>
                    <span class="gear-card-desc">${item.description || `Lv.${item.level}`} · <span style="color:var(--accent);">$${formatNumber(item.price)}</span></span>
                </div>
            </div>
        `).join('');
    }
};
