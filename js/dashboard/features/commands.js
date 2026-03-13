// ============================================================
//  dashboard/features/commands.js — Commands & Modules management
// ============================================================

/**
 * Commands & Modules feature mixin
 */
export const CommandsMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupCommandsListeners() {
        document.getElementById('command-search')?.addEventListener('input', (e) => this.filterCommands(e.target.value));
        document.getElementById('add-scope-rule')?.addEventListener('click', () => this.addScopeRule());
        document.querySelectorAll('[data-module]').forEach(toggle => {
            toggle.addEventListener('change', (e) => this.toggleModule(e.target.getAttribute('data-module'), e.target.checked));
        });
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadCommandsData() {
        const modules = await this.apiCall('/modules');
        if (modules) this.updateModuleToggles(modules);

        const commands = await this.apiCall('/commands');
        if (commands) this.updateCommandsList(commands);

        const scopeRules = await this.apiCall('/scope-rules');
        if (scopeRules) this.updateScopeRulesList(scopeRules);
    },

    // ── Command Filtering ──────────────────────────────────────
    filterCommands(searchTerm) {
        document.querySelectorAll('.command-item').forEach(item => {
            const name = item.dataset.command || item.textContent;
            item.style.display = name.toLowerCase().includes(searchTerm.toLowerCase()) ? '' : 'none';
        });
    },

    // ── Module Toggle ──────────────────────────────────────────
    toggleModule(moduleName, enabled) {
        this.apiCall('/modules/toggle', {
            method: 'POST', body: JSON.stringify({ module: moduleName, enabled })
        });
    },

    updateModuleToggles(modules) {
        if (!modules || !Array.isArray(modules)) return;
        modules.forEach(mod => {
            const toggle = document.querySelector(`[data-module="${mod.module}"]`);
            if (toggle) toggle.checked = mod.enabled;
        });
    },

    // ── Commands List ──────────────────────────────────────────
    updateCommandsList(commands) {
        const list = document.getElementById('command-toggles');
        if (!list || !commands) return;
        list.innerHTML = commands.map(cmd => {
            const name = cmd.name || cmd.command;
            const hasExclusive = cmd.exclusive_channel || cmd.exclusive_role;
            return `
            <div class="command-item" data-command="${name}">
                <div style="display:flex;align-items:center;gap:0.5rem;flex:1;min-width:0;">
                    <span style="font-family:monospace;font-size:0.82rem;color:var(--accent);">${name}</span>
                    ${cmd.usage !== undefined ? `<span style="color:var(--fg-dim);font-size:0.72rem;">(${cmd.usage})</span>` : ''}
                    ${hasExclusive ? `<span style="font-size:0.6rem;padding:0.1rem 0.35rem;background:rgba(180,167,214,0.2);color:var(--accent);border-radius:0.2rem;">-e</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();dashboard.showExclusiveModal('${name}','command')" title="Exclusive"><i class="fas fa-lock"></i></button>
                    <label class="switch"><input type="checkbox" ${cmd.enabled !== false ? 'checked' : ''} onchange="dashboard.toggleModule('${name}',this.checked)"><span class="switch-slider"></span></label>
                </div>
            </div>`;
        }).join('');
    },

    // ── Scope Rules ────────────────────────────────────────────
    updateScopeRulesList(rules) {
        const list = document.getElementById('scope-rules-list');
        if (!list || !rules) return;
        if (!rules.length) {
            list.innerHTML = '<p style="color:var(--fg-dim);">No scope rules configured</p>';
            return;
        }
        list.innerHTML = rules.map(r => `
            <div class="scope-rule-card" onclick="dashboard.editScopeRule(${r.id})" data-rule-id="${r.id}">
                <div style="display:flex;align-items:center;gap:0.5rem;flex:1;flex-wrap:wrap;">
                    <span style="font-family:monospace;color:var(--accent);font-size:0.82rem;">${r.command_name}</span>
                    <span style="font-size:0.65rem;padding:0.12rem 0.4rem;border-radius:0.25rem;font-weight:600;text-transform:uppercase;background:${r.scope_type === 'exclusive' ? 'rgba(180,167,214,0.2);color:var(--accent)' : r.scope_type === 'allow' ? 'rgba(16,185,129,0.15);color:#10b981' : 'rgba(239,68,68,0.15);color:#ef4444'};">${r.scope_type}${r.scope_type === 'exclusive' ? ' (-e)' : ''}</span>
                    <span style="font-size:0.72rem;color:var(--fg-dim);">${r.target_type}: ${r.target_id}</span>
                </div>
                <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();dashboard.deleteScopeRule(${r.id})"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');
    },

    addScopeRule() {
        this.showModal('Add Scope Rule', `
            <div class="form-field"><label>Command(s)</label><input type="text" id="modal-scope-cmd" placeholder="e.g. ban, kick" class="input"></div>
            <div class="form-row">
                <div class="form-field">
                    <label>Type</label>
                    <select id="modal-scope-type" class="input">
                        <option value="channel">Channel</option>
                        <option value="role">Role</option>
                    </select>
                </div>
                <div class="form-field"><label>Target ID</label><input type="text" id="modal-scope-target" placeholder="Channel or Role ID" class="input"></div>
            </div>
            <div class="form-field">
                <label>Action</label>
                <select id="modal-scope-action" class="input">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                    <option value="exclusive">Exclusive</option>
                </select>
            </div>
        `, async () => {
            const commands = document.getElementById('modal-scope-cmd')?.value.trim();
            const type = document.getElementById('modal-scope-type')?.value;
            const target_id = document.getElementById('modal-scope-target')?.value.trim();
            const action = document.getElementById('modal-scope-action')?.value;
            if (!commands || !target_id) { this.toast('Command and target required', 'warning'); return; }
            await this.apiCall('/scope-rules', {
                method: 'POST', body: JSON.stringify({ commands, type, target_id, action })
            });
            this.closeModal();
            this.loadCommandsData();
        });
    },

    editScopeRule(ruleId) {
        this.apiCall(`/scope-rules/${ruleId}`).then(rule => {
            if (!rule) return;
            this.showModal('Edit Scope Rule', `
                <div class="form-field"><label>Command(s)</label><input type="text" id="modal-scope-cmd" value="${rule.commands || ''}" class="input"></div>
                <div class="form-row">
                    <div class="form-field">
                        <label>Type</label>
                        <select id="modal-scope-type" class="input">
                            <option value="channel" ${rule.type === 'channel' ? 'selected' : ''}>Channel</option>
                            <option value="role" ${rule.type === 'role' ? 'selected' : ''}>Role</option>
                        </select>
                    </div>
                    <div class="form-field"><label>Target ID</label><input type="text" id="modal-scope-target" value="${rule.target_id || ''}" class="input"></div>
                </div>
                <div class="form-field">
                    <label>Action</label>
                    <select id="modal-scope-action" class="input">
                        <option value="allow" ${rule.action === 'allow' ? 'selected' : ''}>Allow</option>
                        <option value="deny" ${rule.action === 'deny' ? 'selected' : ''}>Deny</option>
                        <option value="exclusive" ${rule.action === 'exclusive' ? 'selected' : ''}>Exclusive</option>
                    </select>
                </div>
            `, async () => {
                const commands = document.getElementById('modal-scope-cmd')?.value.trim();
                const type = document.getElementById('modal-scope-type')?.value;
                const target_id = document.getElementById('modal-scope-target')?.value.trim();
                const action = document.getElementById('modal-scope-action')?.value;
                if (!commands || !target_id) { this.toast('Command and target required', 'warning'); return; }
                await this.apiCall(`/scope-rules/${ruleId}`, {
                    method: 'PUT', body: JSON.stringify({ commands, type, target_id, action })
                });
                this.closeModal();
                this.loadCommandsData();
            });
        });
    },

    deleteScopeRule(ruleId) {
        if (!confirm('Delete this scope rule?')) return;
        this.apiCall(`/scope-rules/${ruleId}`, { method: 'DELETE' }).then(() => this.loadCommandsData());
    },

    // ── Exclusive Modal ────────────────────────────────────────
    showExclusiveModal(ruleId) {
        this.showModal('Exclusive Rule Channels', `
            <p style="color:var(--fg-dim);margin-bottom:0.7rem;">Manage which channels this exclusive rule applies to.</p>
            <div id="exclusive-channels-list" style="max-height:180px;overflow-y:auto;">
                <div class="loading-skeleton" style="height:2.4rem;border-radius:0.5rem;"></div>
            </div>
            <div class="form-field" style="margin-top:0.8rem;">
                <label>Add Channel ID</label>
                <div style="display:flex;gap:0.5rem;">
                    <input type="text" id="modal-exc-channel" placeholder="Channel ID" class="input" style="flex:1;">
                    <button class="btn btn-primary btn-sm" onclick="dashboard.addExclusiveChannel(${ruleId})">Add</button>
                </div>
            </div>
        `, null);
        this.apiCall(`/scope-rules/${ruleId}/channels`).then(channels => {
            const list = document.getElementById('exclusive-channels-list');
            if (!list) return;
            list.innerHTML = (channels || []).map(ch => `
                <div class="item-row" style="padding:0.35rem 0;">
                    <span style="font-family:monospace;font-size:0.78rem;">${ch.channel_id || ch}</span>
                    <button class="btn btn-danger btn-xs" onclick="dashboard.removeExclusiveChannel(${ruleId}, '${ch.channel_id || ch}')"><i class="fas fa-times"></i></button>
                </div>
            `).join('') || '<p style="color:var(--fg-dim);">No channels added</p>';
        });
    },

    async addExclusiveChannel(ruleId) {
        const channelId = document.getElementById('modal-exc-channel')?.value.trim();
        if (!channelId) return;
        await this.apiCall(`/scope-rules/${ruleId}/channels`, {
            method: 'POST', body: JSON.stringify({ channel_id: channelId })
        });
        document.getElementById('modal-exc-channel').value = '';
        this.showExclusiveModal(ruleId);
    },

    async removeExclusiveChannel(ruleId, channelId) {
        await this.apiCall(`/scope-rules/${ruleId}/channels/${channelId}`, { method: 'DELETE' });
        this.showExclusiveModal(ruleId);
    }
};
