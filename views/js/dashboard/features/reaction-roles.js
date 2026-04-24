// ============================================================
//  dashboard/features/reaction-roles.js — Reaction role management
// ============================================================

/**
 * Reaction Roles feature mixin
 */
export const ReactionRolesMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupReactionRoleListeners() {
        document.getElementById('add-reaction-role')?.addEventListener('click', () => this.addReactionRole());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadReactionRolesData() {
        // Initialize searchable selects for channel and role
        await this.initReactionRoleSelects();
        
        const roles = await this.apiCall('/reaction-roles');
        const list = document.getElementById('reaction-roles-list');
        if (!list) return;
        if (!roles || !roles.length) {
            list.innerHTML = '<p style="color:var(--fg-dim);">No reaction roles configured</p>';
            return;
        }
        
        // Fetch guild roles and channels for display names
        const guildRoles = await this.selectManager?.fetchRoles() || [];
        const guildChannels = await this.selectManager?.fetchChannels() || [];
        const roleMap = new Map(guildRoles.map(r => [r.id, r]));
        const channelMap = new Map(guildChannels.map(c => [c.id, c]));
        
        // Helper to escape for HTML attributes
        const escAttr = s => String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
        list.innerHTML = roles.map(r => {
            const emojiSafe = escAttr(r.emoji_raw);
            const role = roleMap.get(r.role_id);
            const channel = channelMap.get(r.channel_id);
            const roleName = role ? role.name : r.role_id;
            const channelName = channel ? `#${channel.name}` : r.channel_id;
            const roleColor = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--fg-dim)';
            
            return `
            <div class="item-row" style="cursor:pointer;" onclick="dashboard.editReactionRole('${r.message_id}', '${r.message_id}', '${r.channel_id || ''}', '${emojiSafe}', '${r.role_id}')">
                <div style="display:flex;align-items:center;gap:0.75rem;">
                    <span style="font-size:1.2rem;">${r.emoji_raw}</span>
                    <div style="display:flex;flex-direction:column;gap:0.1rem;">
                        <span style="font-size:0.78rem;">Message: <span style="font-family:monospace;">${r.message_id}</span></span>
                        <span style="font-size:0.72rem;color:var(--fg-dim);">${channelName}</span>
                        <div style="display:flex;align-items:center;gap:0.35rem;">
                            <span class="role-color" style="background:${roleColor};width:8px;height:8px;border-radius:50%;"></span>
                            <span style="font-size:0.72rem;">${this.escapeHtmlRR(roleName)}</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:0.4rem;">
                    <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();dashboard.editReactionRole('${r.message_id}', '${r.message_id}', '${r.channel_id || ''}', '${emojiSafe}', '${r.role_id}')"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();dashboard.deleteReactionRole('${r.message_id}', '${emojiSafe}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `}).join('');
    },

    // ── Initialize Searchable Selects ──────────────────────────
    async initReactionRoleSelects() {
        if (!this.selectManager) return;
        
        // Initialize channel select
        const channelWrapper = document.querySelector('.searchable-select[data-field="rr-channel-id"]');
        if (channelWrapper && !this.rrChannelSelect) {
            this.rrChannelSelect = await this.selectManager.init(channelWrapper, 'channel');
        }
        
        // Initialize role select
        const roleWrapper = document.querySelector('.searchable-select[data-field="rr-role-id"]');
        if (roleWrapper && !this.rrRoleSelect) {
            this.rrRoleSelect = await this.selectManager.init(roleWrapper, 'role');
        }
    },

    // ── Delete Reaction Role ───────────────────────────────────
    async deleteReactionRole(messageId, emojiRaw) {
        const result = await this.apiCall(`/reaction-roles/${messageId}?emoji_raw=${encodeURIComponent(emojiRaw)}`, { method: 'DELETE' });
        if (result && result.success) {
            this.toast('Reaction role deleted', 'success');
        }
        this.loadReactionRolesData();
    },

    // ── Edit Reaction Role ─────────────────────────────────────
    async editReactionRole(id, messageId, channelId, emoji, roleId) {
        // Get channel and role names for display
        const guildRoles = await this.selectManager?.fetchRoles() || [];
        const guildChannels = await this.selectManager?.fetchChannels() || [];
        const role = guildRoles.find(r => r.id === roleId);
        const channel = guildChannels.find(c => c.id === channelId);
        
        this.showModal('Edit Reaction Role', `
            <div class="form-row">
                <div class="form-field"><label>Message ID</label><input type="text" id="modal-rr-message" value="${messageId}" class="input"></div>
                <div class="form-field"><label>Channel</label>
                    <div class="searchable-select" data-type="channel" data-field="modal-rr-channel">
                        <input type="text" class="input searchable-input" placeholder="Select channel..." value="${channel ? channel.name : ''}">
                        <input type="hidden" id="modal-rr-channel" value="${channelId}">
                    </div>
                </div>
            </div>
            <div class="form-row">
                <div class="form-field"><label>Emoji</label><input type="text" id="modal-rr-emoji" value="${emoji}" class="input"></div>
                <div class="form-field"><label>Role</label>
                    <div class="searchable-select" data-type="role" data-field="modal-rr-role">
                        <input type="text" class="input searchable-input" placeholder="Select role..." value="${role ? role.name : ''}">
                        <input type="hidden" id="modal-rr-role" value="${roleId}">
                    </div>
                </div>
            </div>
        `, async () => {
            const newMessageId = document.getElementById('modal-rr-message')?.value.trim();
            const newChannelId = document.getElementById('modal-rr-channel')?.value.trim();
            const newEmoji = document.getElementById('modal-rr-emoji')?.value.trim();
            const newRoleId = document.getElementById('modal-rr-role')?.value.trim();
            if (!newMessageId || !newChannelId || !newEmoji || !newRoleId) { this.toast('All fields are required', 'warning'); return; }
            await this.apiCall(`/reaction-roles/${id}`, {
                method: 'PUT', body: JSON.stringify({ message_id: newMessageId, channel_id: newChannelId, emoji_raw: newEmoji, role_id: newRoleId })
            });
            this.closeModal();
            this.loadReactionRolesData();
        });
        
        // Initialize searchable selects in modal after it's rendered
        setTimeout(async () => {
            const modalChannelWrapper = document.querySelector('.searchable-select[data-field="modal-rr-channel"]');
            const modalRoleWrapper = document.querySelector('.searchable-select[data-field="modal-rr-role"]');
            
            if (modalChannelWrapper && this.selectManager) {
                const channelSelect = await this.selectManager.init(modalChannelWrapper, 'channel');
                channelSelect?.setValue(channelId, channel?.name);
            }
            if (modalRoleWrapper && this.selectManager) {
                const roleSelect = await this.selectManager.init(modalRoleWrapper, 'role');
                roleSelect?.setValue(roleId, role?.name);
            }
        }, 50);
    },

    // ── Add Reaction Role ──────────────────────────────────────
    addReactionRole() {
        const message_id = document.getElementById('rr-message-id')?.value.trim();
        const channel_id = document.getElementById('rr-channel-id')?.value.trim();
        const emoji = document.getElementById('rr-emoji')?.value.trim();
        const role_id = document.getElementById('rr-role-id')?.value.trim();
        
        if (!message_id || !channel_id || !emoji || !role_id) { 
            this.toast('All fields are required', 'warning'); 
            return; 
        }
        
        this.apiCall('/reaction-roles', {
            method: 'POST', body: JSON.stringify({ message_id, channel_id, emoji_raw: emoji, role_id })
        }).then(res => {
            if (res) {
                this.toast('Reaction role added!', 'success');
                // Clear form fields
                document.getElementById('rr-message-id').value = '';
                document.getElementById('rr-emoji').value = '';
                // Clear searchable selects
                this.rrChannelSelect?.clear();
                this.rrRoleSelect?.clear();
                this.loadReactionRolesData();
            }
        });
    },
    
    // ── Utility: Escape HTML ───────────────────────────────────
    escapeHtmlRR(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
