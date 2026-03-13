// ============================================================
//  dashboard/features/moderation.js — Moderation tools
// ============================================================

/**
 * Moderation feature mixin
 */
export const ModerationMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupModerationListeners() {
        document.getElementById('add-autopurge')?.addEventListener('click', () => this.addAutopurge());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadModerationData() {
        const cooldowns = await this.apiCall('/moderation/cooldowns');
        const cdBody = document.getElementById('cooldown-settings-tbody');
        if (cdBody && cooldowns) {
            cdBody.innerHTML = (cooldowns || []).map(c => `
                <tr>
                    <td style="font-family:monospace;font-size:0.78rem;">${c.command}</td>
                    <td>${c.cooldown_seconds}s</td>
                    <td class="text-right"><button class="btn btn-outline btn-xs" onclick="dashboard.editCooldown('${c.command}')"><i class="fas fa-pen"></i> edit</button></td>
                </tr>
            `).join('');
        }
    },

    // ── Edit Cooldown ──────────────────────────────────────────
    editCooldown(command) {
        this.showModal('Edit Cooldown', `
            <div class="form-field"><label>Command: <strong style="color:var(--accent);">${command}</strong></label></div>
            <div class="form-field"><label>Cooldown (seconds)</label><input type="number" id="modal-cooldown-value" min="0" value="5" class="input"></div>
        `, async () => {
            const seconds = parseInt(document.getElementById('modal-cooldown-value')?.value);
            await this.apiCall('/moderation/cooldowns', {
                method: 'POST', body: JSON.stringify({ command, cooldown_seconds: seconds })
            });
            this.closeModal();
            this.loadModerationData();
        });
    },

    // ── Autopurge ──────────────────────────────────────────────
    addAutopurge() {
        this.showModal('Add Autopurge Schedule', `
            <div class="form-field"><label>Channel ID</label><input type="text" id="modal-autopurge-channel" placeholder="Channel ID..." class="input"></div>
            <div class="form-row">
                <div class="form-field"><label>Interval (min)</label><input type="number" id="modal-autopurge-interval" min="1" value="60" class="input"></div>
                <div class="form-field"><label>Max Age (min)</label><input type="number" id="modal-autopurge-age" min="1" value="1440" class="input"></div>
            </div>
        `, async () => {
            const channel_id = document.getElementById('modal-autopurge-channel')?.value.trim();
            const interval = parseInt(document.getElementById('modal-autopurge-interval')?.value);
            const max_age = parseInt(document.getElementById('modal-autopurge-age')?.value);
            if (!channel_id) { this.toast('Channel ID required', 'warning'); return; }
            await this.apiCall('/moderation/autopurge', {
                method: 'POST', body: JSON.stringify({ channel_id, interval_minutes: interval, max_age_minutes: max_age })
            });
            this.closeModal();
            this.loadModerationData();
        });
    },

    // ── Blacklist ──────────────────────────────────────────────
    addToBlacklist() {
        const userId = document.getElementById('blacklist-user-id')?.value.trim();
        if (!userId) { this.toast('Enter a User ID', 'warning'); return; }
        const reason = document.getElementById('blacklist-reason')?.value.trim() || null;
        this.apiCall('/moderation/blacklist', {
            method: 'POST', body: JSON.stringify({ user_id: userId, reason })
        }).then(res => {
            if (res) {
                document.getElementById('blacklist-user-id').value = '';
                const reasonEl = document.getElementById('blacklist-reason');
                if (reasonEl) reasonEl.value = '';
                this.loadModerationData();
            }
        });
    },

    // ── Whitelist ──────────────────────────────────────────────
    addToWhitelist() {
        const userId = document.getElementById('whitelist-user-id')?.value.trim();
        if (!userId) { this.toast('Enter a User ID', 'warning'); return; }
        const reason = document.getElementById('whitelist-reason')?.value.trim() || null;
        this.apiCall('/moderation/whitelist', {
            method: 'POST', body: JSON.stringify({ user_id: userId, reason })
        }).then(res => {
            if (res) {
                document.getElementById('whitelist-user-id').value = '';
                const reasonEl = document.getElementById('whitelist-reason');
                if (reasonEl) reasonEl.value = '';
                this.loadModerationData();
            }
        });
    },

    // ── Edit List Entry ────────────────────────────────────────
    editBlacklistEntry(userId, listType) {
        const card = document.querySelector(`#${listType} .item-row[onclick*="'${userId}'"]`);
        const currentReason = card?.querySelector('span:nth-child(2)')?.textContent || '';
        const displayReason = currentReason === 'No reason' ? '' : currentReason;

        this.showModal(`Edit ${listType === 'blacklist' ? 'Blacklist' : 'Whitelist'} Entry`, `
            <div class="form-field"><label>User ID</label><input type="text" value="${userId}" disabled class="input" style="opacity:0.6;"></div>
            <div class="form-field"><label>Reason</label><textarea id="modal-bl-reason" rows="3" class="input" style="resize:vertical;">${displayReason}</textarea></div>
        `, async () => {
            const reason = document.getElementById('modal-bl-reason')?.value.trim() || null;
            await this.apiCall(`/moderation/${listType}`, {
                method: 'POST', body: JSON.stringify({ user_id: userId, reason })
            });
            this.closeModal();
            this.loadModerationData();
        });
    }
};
