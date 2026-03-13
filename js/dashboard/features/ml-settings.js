// ============================================================
//  dashboard/features/ml-settings.js — ML Settings management
// ============================================================

/**
 * ML Settings feature mixin
 */
export const MLSettingsMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupMLSettingsListeners() {
        document.getElementById('add-ml-setting')?.addEventListener('click', () => this.addMLSetting());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadMLSettingsData() {
        const settings = await this.apiCall('/ml/settings');
        const container = document.getElementById('ml-settings-list');
        if (!container) return;
        if (!settings || !settings.length) {
            container.innerHTML = '<p style="color:var(--fg-dim);">No ML settings configured</p>';
            return;
        }
        container.innerHTML = settings.map(s => `
            <div class="item-row" style="cursor:pointer;" onclick="dashboard.editMLSetting('${s.key}', '${(s.value || '').replace(/'/g, "\\'")}', '${(s.description || '').replace(/'/g, "\\'")}')">
                <div style="display:flex;flex-direction:column;gap:0.15rem;">
                    <span style="font-family:monospace;font-size:0.82rem;color:var(--accent);">${s.key}</span>
                    <span style="font-size:0.72rem;color:var(--fg-dim);">${s.description || 'No description'}</span>
                </div>
                <span class="btn btn-outline btn-xs" style="font-family:monospace;">${s.value}</span>
            </div>
        `).join('');
    },

    // ── Edit ML Setting ────────────────────────────────────────
    editMLSetting(key, value, description) {
        this.showModal(`Edit ML Setting — ${key}`, `
            <div class="form-field"><label>Key</label><input type="text" value="${key}" disabled class="input" style="opacity:0.6;"></div>
            <div class="form-field"><label>Value</label><input type="text" id="modal-ml-value" value="${value}" class="input"></div>
            <div class="form-field"><label>Description</label><textarea id="modal-ml-desc" rows="2" class="input" style="resize:vertical;">${description}</textarea></div>
        `, async () => {
            const newValue = document.getElementById('modal-ml-value')?.value.trim();
            const newDesc = document.getElementById('modal-ml-desc')?.value.trim();
            await this.apiCall('/ml/settings', {
                method: 'POST', body: JSON.stringify({ key, value: newValue, description: newDesc })
            });
            this.closeModal();
            this.loadMLSettingsData();
        });
    },

    // ── Add ML Setting ─────────────────────────────────────────
    addMLSetting() {
        this.showModal('Add ML Setting', `
            <div class="form-field"><label>Key</label><input type="text" id="modal-ml-key" placeholder="setting_key" class="input"></div>
            <div class="form-field"><label>Value</label><input type="text" id="modal-ml-value" placeholder="value" class="input"></div>
            <div class="form-field"><label>Description</label><textarea id="modal-ml-desc" rows="2" placeholder="What does this setting do?" class="input" style="resize:vertical;"></textarea></div>
        `, async () => {
            const key = document.getElementById('modal-ml-key')?.value.trim();
            const value = document.getElementById('modal-ml-value')?.value.trim();
            const desc = document.getElementById('modal-ml-desc')?.value.trim();
            if (!key) { this.toast('Key is required', 'warning'); return; }
            await this.apiCall('/ml/settings', {
                method: 'POST', body: JSON.stringify({ key, value, description: desc })
            });
            this.closeModal();
            this.loadMLSettingsData();
        });
    }
};
