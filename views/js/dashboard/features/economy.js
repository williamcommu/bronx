// ============================================================
//  dashboard/features/economy.js — Economy management
// ============================================================

import { formatNumber, formatCurrency } from '../utils.js';

/**
 * Economy feature mixin
 */
export const EconomyMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupEconomyListeners() {
        document.getElementById('search-user')?.addEventListener('click', () => this.searchUser());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadEconomyData() {
        const guildBalance = await this.apiCall('/economy/guild-balance');
        if (guildBalance) this.updateGuildBalance(guildBalance);

        const interestSettings = await this.apiCall('/economy/interest-settings');
        if (interestSettings) this.updateInterestSettings(interestSettings);
    },

    // ── User Search ────────────────────────────────────────────
    searchUser() {
        const searchTerm = document.getElementById('user-search').value.trim();
        if (searchTerm) {
            this.apiCall(`/users/search?q=${encodeURIComponent(searchTerm)}`).then(users => this.displayUserEconomyResults(users));
        }
    },

    displayUserEconomyResults(users) {
        const list = document.getElementById('user-economy-result');
        if (!list || !users) return;
        list.innerHTML = users.map(u => `
            <div class="item-row">
                <span style="font-family:monospace;font-size:0.78rem;">${u.user_id}</span>
                <div style="display:flex;gap:0.7rem;font-size:0.78rem;">
                    <span>Wallet: <strong>${formatCurrency(u.wallet || 0)}</strong></span>
                    <span>Bank: <strong>${formatCurrency(u.bank || 0)}</strong></span>
                </div>
            </div>
        `).join('');
    },

    // ── Guild Balance ──────────────────────────────────────────
    updateGuildBalance(data) {
        if (!data) return;
        const amounts = document.querySelectorAll('#economy .balance-amount');
        if (amounts[0]) amounts[0].textContent = '$' + Number(data.treasury || data.balance || 0).toLocaleString();
        if (amounts[1]) amounts[1].textContent = '$' + Number(data.total_donated || 0).toLocaleString();
        if (amounts[2]) amounts[2].textContent = '$' + Number(data.total_given || 0).toLocaleString();
    },

    adjustGuildBalance() {
        this.showModal('Adjust Guild Balance', `
            <div class="form-field"><label>Adjustment Amount</label><input type="number" id="modal-balance-adjustment" step="1" class="input"></div>
            <div class="form-field"><label>Reason</label><textarea id="modal-adjustment-reason" rows="3" placeholder="Enter reason..." class="input" style="resize:vertical;"></textarea></div>
        `, () => {
            const adjustment = parseInt(document.getElementById('modal-balance-adjustment').value);
            const reason = document.getElementById('modal-adjustment-reason').value;
            if (adjustment !== 0) {
                this.apiCall('/economy/guild-balance/adjust', {
                    method: 'POST', body: JSON.stringify({ adjustment, reason })
                }).then(() => { this.loadEconomyData(); this.closeModal(); });
            }
        });
    },

    // ── Interest Settings ──────────────────────────────────────
    updateInterestSettings(data) {
        if (!data) return;
        const rate = document.getElementById('default-interest-rate');
        const maxLevel = document.getElementById('max-interest-level');
        if (rate && data.interest_rate !== undefined) rate.value = data.interest_rate;
        if (maxLevel && data.max_interest_level !== undefined) maxLevel.value = data.max_interest_level;
    },

    // ── Economy Mode Gating ────────────────────────────────────
    applyEconomyModeGating() {
        const isRestricted = this.economyMode !== 'server' && !this.isBotOwner;
        const interestInputs = document.querySelectorAll('#economy input[type="number"]');
        interestInputs.forEach(input => {
            input.disabled = isRestricted;
            if (isRestricted) {
                input.title = 'Economy is in global mode. Only the bot owner can modify these settings.';
            } else {
                input.title = '';
            }
        });

        const shopNav = document.querySelector('.nav-item[data-tab="shop"]');
        if (shopNav) {
            shopNav.style.display = this.economyMode === 'server' ? '' : 'none';
        }
    }
};
