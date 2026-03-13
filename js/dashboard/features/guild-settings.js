// ============================================================
//  dashboard/features/guild-settings.js — Guild configuration
// ============================================================

import { formatNumber } from '../utils.js';

/**
 * Guild Settings feature mixin
 */
export const GuildSettingsMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupGuildSettingsListeners() {
        document.getElementById('add-blocked-channel')?.addEventListener('click', () => this.addBlockedChannel());
        document.getElementById('add-prefix')?.addEventListener('click', () => this.addCustomPrefix());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadGuildSettingsData() {
        const settings = await this.apiCall('/guild/settings');
        if (settings) {
            document.getElementById('guild-prefix').value = settings.prefix || 'bb ';
            document.getElementById('logging-enabled').checked = settings.logging_enabled || false;
        }

        const blockedChannels = await this.apiCall('/guild/blocked-channels');
        if (blockedChannels) this.updateBlockedChannelsList(blockedChannels);

        const customPrefixes = await this.apiCall('/guild/custom-prefixes');
        if (customPrefixes) this.updateCustomPrefixesList(customPrefixes);
    },

    // ── Blocked Channels ───────────────────────────────────────
    addBlockedChannel() {
        this.showModal('Add Blocked Channel', `
            <div class="form-field"><label>Channel ID</label><input type="text" id="modal-channel-id" placeholder="Enter channel ID..." class="input"></div>
        `, () => {
            const channelId = document.getElementById('modal-channel-id').value;
            if (channelId) {
                this.apiCall('/guild/blocked-channels', {
                    method: 'POST', body: JSON.stringify({ channel_id: channelId })
                }).then(() => { this.loadGuildSettingsData(); this.closeModal(); });
            }
        });
    },

    updateBlockedChannelsList(channels) {
        const list = document.getElementById('blocked-channels-list');
        if (!list) return;
        list.innerHTML = (channels || []).map(ch => `
            <div class="item-row">
                <span style="font-family:monospace;font-size:0.78rem;">#${ch.channel_id}</span>
                <div style="display:flex;gap:0.4rem;">
                    <button class="btn btn-outline btn-xs" onclick="dashboard.editBlockedChannel('${ch.channel_id}')"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="dashboard.apiCall('/guild/blocked-channels/${ch.channel_id}', { method: 'DELETE' }).then(() => dashboard.loadGuildSettingsData())"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('') || '<p style="color:var(--fg-dim);">No blocked channels</p>';
    },

    editBlockedChannel(oldChannelId) {
        this.showModal('Edit Blocked Channel', `
            <div class="form-field"><label>Channel ID</label><input type="text" id="modal-channel-id" value="${oldChannelId}" class="input"></div>
        `, async () => {
            const newId = document.getElementById('modal-channel-id')?.value.trim();
            if (!newId) { this.toast('Channel ID required', 'warning'); return; }
            if (newId !== oldChannelId) {
                await this.apiCall(`/guild/blocked-channels/${oldChannelId}`, { method: 'DELETE' });
                await this.apiCall('/guild/blocked-channels', { method: 'POST', body: JSON.stringify({ channel_id: newId }) });
            }
            this.closeModal();
            this.loadGuildSettingsData();
        });
    },

    // ── Custom Prefixes ────────────────────────────────────────
    addCustomPrefix() {
        const prefix = document.getElementById('new-prefix').value.trim();
        if (prefix) {
            this.apiCall('/guild/custom-prefixes', {
                method: 'POST', body: JSON.stringify({ prefix })
            }).then(() => { document.getElementById('new-prefix').value = ''; this.loadGuildSettingsData(); });
        }
    },

    updateCustomPrefixesList(prefixes) {
        const list = document.getElementById('custom-prefixes');
        if (!list) return;
        list.innerHTML = (prefixes || []).map(p => `
            <div class="item-row">
                <code style="color:var(--accent);font-size:0.82rem;">${p.prefix}</code>
                <div style="display:flex;gap:0.4rem;">
                    <button class="btn btn-outline btn-xs" onclick="dashboard.editCustomPrefix('${p.prefix.replace(/'/g, "\\'")}')"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="dashboard.apiCall('/guild/custom-prefixes', { method: 'DELETE', body: JSON.stringify({ prefix: '${p.prefix.replace(/'/g, "\\'")}' }) }).then(() => dashboard.loadGuildSettingsData())"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('') || '<p style="color:var(--fg-dim);">No custom prefixes</p>';
    },

    editCustomPrefix(oldPrefix) {
        this.showModal('Edit Custom Prefix', `
            <div class="form-field"><label>Prefix</label><input type="text" id="modal-prefix" value="${oldPrefix}" class="input"></div>
        `, async () => {
            const newPrefix = document.getElementById('modal-prefix')?.value.trim();
            if (!newPrefix) { this.toast('Prefix required', 'warning'); return; }
            if (newPrefix !== oldPrefix) {
                await this.apiCall('/guild/custom-prefixes', { method: 'DELETE', body: JSON.stringify({ prefix: oldPrefix }) });
                await this.apiCall('/guild/custom-prefixes', { method: 'POST', body: JSON.stringify({ prefix: newPrefix }) });
            }
            this.closeModal();
            this.loadGuildSettingsData();
        });
    }
};
