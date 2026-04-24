// ============================================================
//  dashboard/features/commands.js — Commands & Modules management
// ============================================================

/**
 * Commands & Modules feature mixin
 * - Loads ALL bot commands with their modules
 * - Provides per-command configuration: enable/disable, restrict by role/channel/user, exclusive
 * - Provides per-module advanced settings
 * - Integrates with scope editor using searchable selects
 */
export const CommandsMixin = {
    // Cache for loaded data
    _modulesData: null,
    _commandsData: null,
    _commandFilter: '',
    _moduleFilter: 'all',

    // ── Event Listeners ────────────────────────────────────────
    setupCommandsListeners() {
        document.getElementById('command-search')?.addEventListener('input', (e) => {
            this._commandFilter = e.target.value.toLowerCase();
            this.renderCommandsList();
        });
        
        document.getElementById('module-filter')?.addEventListener('change', (e) => {
            this._moduleFilter = e.target.value;
            this.renderCommandsList();
        });
        
        document.getElementById('add-scope-rule')?.addEventListener('click', () => this.openScopeRuleModal());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadCommandsData() {
        // Load modules
        const modules = await this.apiCall('/modules');
        if (modules && Array.isArray(modules)) {
            this._modulesData = modules;
            this.renderModulesList();
        }

        // Load commands
        const commands = await this.apiCall('/commands');
        if (commands && Array.isArray(commands)) {
            this._commandsData = commands;
            this.renderCommandsList();
            this.populateModuleFilter();
        }

        // Load scope rules
        const scopeRules = await this.apiCall('/scope-rules');
        if (scopeRules) this.renderScopeRulesList(scopeRules);
    },

    // ── Populate Module Filter Dropdown ────────────────────────
    populateModuleFilter() {
        const filter = document.getElementById('module-filter');
        if (!filter || !this._commandsData) return;

        // Get unique modules from commands
        const modules = [...new Set(this._commandsData.map(c => c.module))].filter(Boolean).sort();
        
        filter.innerHTML = `<option value="all">All Modules</option>` +
            modules.map(m => `<option value="${m}">${m}</option>`).join('');
    },

    // ── Modules Rendering ──────────────────────────────────────
    renderModulesList() {
        const container = document.querySelector('.module-toggles');
        if (!container || !this._modulesData) return;

        container.innerHTML = this._modulesData.map(mod => `
            <div class="module-row" data-module="${mod.module}">
                <div class="module-info">
                    <i class="fas ${mod.icon} module-icon"></i>
                    <div>
                        <span class="module-name">${mod.module}</span>
                        <span class="module-desc">${mod.description}</span>
                        <span class="module-cmd-count">— ${mod.commandCount} commands</span>
                    </div>
                </div>
                <div class="module-actions">
                    <button class="btn btn-ghost btn-xs" onclick="dashboard.openModuleSettings('${mod.module}')" title="Advanced Settings">
                        <i class="fas fa-cog"></i>
                    </button>
                    <button class="btn btn-ghost btn-xs" onclick="dashboard.openModuleScopeModal('${mod.module}')" title="Scope Restrictions">
                        <i class="fas fa-lock"></i>
                    </button>
                    <label class="switch">
                        <input type="checkbox" ${mod.enabled ? 'checked' : ''} onchange="dashboard.toggleModule('${mod.module}', this.checked)">
                        <span class="switch-slider"></span>
                    </label>
                </div>
            </div>
        `).join('');
    },

    // ── Commands Rendering ─────────────────────────────────────
    renderCommandsList() {
        const list = document.getElementById('command-toggles');
        if (!list || !this._commandsData) return;

        // Filter commands
        let filtered = this._commandsData;
        if (this._commandFilter) {
            filtered = filtered.filter(c => 
                c.name.toLowerCase().includes(this._commandFilter) ||
                (c.module && c.module.toLowerCase().includes(this._commandFilter))
            );
        }
        if (this._moduleFilter && this._moduleFilter !== 'all') {
            filtered = filtered.filter(c => c.module === this._moduleFilter);
        }

        if (filtered.length === 0) {
            list.innerHTML = '<p style="color:var(--fg-dim);padding:1rem;">No commands match your filter</p>';
            return;
        }

        list.innerHTML = filtered.map(cmd => `
            <div class="command-item" data-command="${cmd.name}" onclick="dashboard.openCommandConfig('${cmd.name}')">
                <div class="command-info">
                    <span class="command-name">${cmd.name}</span>
                    <span class="command-module">
                        <i class="fas ${cmd.moduleIcon || 'fa-terminal'}" style="font-size:0.65rem;"></i>
                        ${cmd.module || 'unknown'}
                    </span>
                    ${cmd.usage ? `<span class="command-usage">${cmd.usage} uses</span>` : ''}
                </div>
                <div class="command-actions" onclick="event.stopPropagation();">
                    <button class="btn btn-ghost btn-xs" onclick="dashboard.openCommandConfig('${cmd.name}')" title="Configure">
                        <i class="fas fa-cog"></i>
                    </button>
                    <label class="switch">
                        <input type="checkbox" ${cmd.enabled ? 'checked' : ''} onchange="dashboard.toggleCommand('${cmd.name}', this.checked)">
                        <span class="switch-slider"></span>
                    </label>
                </div>
            </div>
        `).join('');
    },

    // ── Toggle Module ──────────────────────────────────────────
    async toggleModule(moduleName, enabled) {
        const result = await this.apiCall('/modules/toggle', {
            method: 'POST',
            body: JSON.stringify({ module: moduleName, enabled })
        });
        if (result?.success) {
            this.toast(`Module ${moduleName} ${enabled ? 'enabled' : 'disabled'}`, 'success');
            // Update local cache
            const mod = this._modulesData?.find(m => m.module === moduleName);
            if (mod) mod.enabled = enabled;
        }
    },

    // ── Toggle Command ─────────────────────────────────────────
    async toggleCommand(cmdName, enabled) {
        const result = await this.apiCall('/commands/toggle', {
            method: 'POST',
            body: JSON.stringify({ command: cmdName, enabled })
        });
        if (result?.success) {
            this.toast(`Command ${cmdName} ${enabled ? 'enabled' : 'disabled'}`, 'success');
            // Update local cache
            const cmd = this._commandsData?.find(c => c.name === cmdName);
            if (cmd) cmd.enabled = enabled;
        }
    },

    // ── Open Module Advanced Settings ──────────────────────────
    async openModuleSettings(moduleName) {
        const settings = await this.apiCall(`/modules/${moduleName}/settings`);
        if (!settings) return;

        const modalContent = `
            <div class="module-settings-modal">
                <div class="module-header">
                    <i class="fas ${settings.info?.icon || 'fa-cube'}"></i>
                    <div>
                        <h4>${moduleName}</h4>
                        <p>${settings.info?.description || ''}</p>
                    </div>
                </div>

                <div class="form-field">
                    <label class="switch-label">
                        <span>Module Enabled</span>
                        <label class="switch">
                            <input type="checkbox" id="modal-mod-enabled" ${settings.enabled ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                    </label>
                </div>

                <h5>Commands in this Module</h5>
                <div class="module-commands-list" style="max-height:200px;overflow-y:auto;">
                    ${settings.commands?.map(cmd => `
                        <div class="mini-command-row">
                            <span>${cmd.name}</span>
                            <label class="switch switch--sm">
                                <input type="checkbox" data-cmd="${cmd.name}" ${cmd.enabled ? 'checked' : ''}>
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                    `).join('') || '<p style="color:var(--fg-dim);font-size:0.8rem;">No commands in this module</p>'}
                </div>

                <div class="scope-section-header">
                    <span class="scope-section-title">Scope Restrictions</span>
                    <span class="scope-col-label" style="margin-left:auto;">Allow</span>
                    <span class="scope-col-label">Exclusive</span>
                </div>
                <div id="modal-mod-scopes" class="scope-list">
                    ${this.renderScopesInModal(settings.scopes || [])}
                </div>
                <button class="btn btn-outline btn-sm scope-add-btn" onclick="dashboard.addScopeToModal('module')">
                    <i class="fas fa-plus"></i> Add Restriction
                </button>
            </div>
        `;

        // Build map of original command states so we only send changes
        const originalCmdStates = {};
        (settings.commands || []).forEach(cmd => { originalCmdStates[cmd.name] = !!cmd.enabled; });

        this.showModal(`${moduleName} Settings`, modalContent, async () => {
            const enabled = document.getElementById('modal-mod-enabled')?.checked;
            const scopes = this.collectScopesFromModal();
            
            // Only collect commands whose state actually changed
            const cmdToggles = document.querySelectorAll('.module-commands-list [data-cmd]');
            const cmdUpdates = [];
            cmdToggles.forEach(toggle => {
                const name = toggle.dataset.cmd;
                const nowEnabled = toggle.checked;
                if (nowEnabled !== originalCmdStates[name]) {
                    cmdUpdates.push({ command: name, enabled: nowEnabled });
                }
            });

            // Save module settings
            await this.apiCall(`/modules/${moduleName}/settings`, {
                method: 'PUT',
                body: JSON.stringify({ enabled, scopes })
            });

            // Save only changed command states (batched in parallel)
            if (cmdUpdates.length > 0) {
                await Promise.all(cmdUpdates.map(update =>
                    this.apiCall('/commands/toggle', {
                        method: 'POST',
                        body: JSON.stringify(update)
                    })
                ));
            }

            this.closeModal();
            this.loadCommandsData();
            this.toast('Module settings saved', 'success');
        });
    },

    // ── Open Command Configuration Modal ───────────────────────
    async openCommandConfig(cmdName) {
        const config = await this.apiCall(`/commands/${cmdName}/config`);
        if (!config) return;

        const modalContent = `
            <div class="command-config-modal">
                <div class="command-header">
                    <code style="font-size:1.1rem;color:var(--accent);">${cmdName}</code>
                    ${config.module ? `<span class="command-module-badge">${config.module}</span>` : ''}
                </div>

                <div class="form-field" style="margin-top:1rem;">
                    <label class="switch-label">
                        <span>Command Enabled</span>
                        <label class="switch">
                            <input type="checkbox" id="modal-cmd-enabled" ${config.enabled ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                    </label>
                </div>

                <div class="scope-section-header">
                    <span class="scope-section-title">Scope Restrictions</span>
                    <span class="scope-col-label" style="margin-left:auto;">Allow</span>
                    <span class="scope-col-label">Exclusive</span>
                </div>

                <div id="modal-cmd-scopes" class="scope-list">
                    ${this.renderScopesInModal(config.scopes || [])}
                </div>
                <button class="btn btn-outline btn-sm scope-add-btn" onclick="dashboard.addScopeToModal('command')">
                    <i class="fas fa-plus"></i> Add Restriction
                </button>
            </div>
        `;

        this.showModal(`Configure: ${cmdName}`, modalContent, async () => {
            const enabled = document.getElementById('modal-cmd-enabled')?.checked;
            const scopes = this.collectScopesFromModal();

            await this.apiCall(`/commands/${cmdName}/config`, {
                method: 'PUT',
                body: JSON.stringify({ enabled, scopes })
            });

            this.closeModal();
            this.loadCommandsData();
            this.toast('Command settings saved', 'success');
        });
    },

    // ── Render Scopes in Modal ─────────────────────────────────
    renderScopesInModal(scopes) {
        if (!scopes || scopes.length === 0) {
            return '<p style="color:var(--fg-dim);font-size:0.8rem;">No restrictions configured</p>';
        }

        return scopes.map((s, i) => `
            <div class="scope-row" data-scope-idx="${i}">
                <select class="input input--sm scope-type">
                    <option value="channel" ${s.type === 'channel' ? 'selected' : ''}>Channel</option>
                    <option value="role" ${s.type === 'role' ? 'selected' : ''}>Role</option>
                    <option value="user" ${s.type === 'user' ? 'selected' : ''}>User</option>
                </select>
                <div class="searchable-select scope-target">
                    <input type="hidden" class="scope-id" value="${s.id || ''}">
                    <input type="text" class="input input--sm searchable-input scope-display" 
                           placeholder="Select target..." value="${s.id || ''}" readonly>
                </div>
                <div class="scope-toggle-group">
                    <label class="scope-toggle-label" title="Allow or Deny">
                        <label class="switch switch--sm">
                            <input type="checkbox" class="scope-enabled" ${s.enabled !== false ? 'checked' : ''} onchange="this.closest('.scope-toggle-label').querySelector('.scope-toggle-text').textContent = this.checked ? 'Allow' : 'Deny'; this.closest('.scope-toggle-label').querySelector('.scope-toggle-text').className = 'scope-toggle-text ' + (this.checked ? 'active' : 'inactive')">
                            <span class="switch-slider"></span>
                        </label>
                    </label>
                    <label class="scope-toggle-label" title="Exclusive: only usable here">
                        <label class="switch switch--sm">
                            <input type="checkbox" class="scope-exclusive" ${s.exclusive ? 'checked' : ''} onchange="this.closest('.scope-toggle-label').querySelector('.scope-toggle-text').classList.toggle('exclusive', this.checked)">
                            <span class="switch-slider switch-slider--accent"></span>
                        </label>
                    </label>
                </div>
                <button class="btn btn-danger btn-xs" onclick="this.closest('.scope-row').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    },

    // ── Add Scope Row to Modal ─────────────────────────────────
    async addScopeToModal(targetType) {
        const container = document.getElementById(targetType === 'module' ? 'modal-mod-scopes' : 'modal-cmd-scopes');
        if (!container) return;

        // Remove "no restrictions" message if present
        const noMsg = container.querySelector('p');
        if (noMsg) noMsg.remove();

        const idx = container.querySelectorAll('.scope-row').length;
        const div = document.createElement('div');
        div.className = 'scope-row';
        div.dataset.scopeIdx = idx;
        div.innerHTML = `
            <select class="input input--sm scope-type" onchange="dashboard.updateScopeTarget(this)">
                <option value="channel">Channel</option>
                <option value="role">Role</option>
                <option value="user">User</option>
            </select>
            <div class="searchable-select scope-target">
                <input type="hidden" class="scope-id" value="">
                <input type="text" class="input input--sm searchable-input scope-display" 
                       placeholder="Click to select..." readonly>
            </div>
            <div class="scope-toggle-group">
                <label class="scope-toggle-label" title="Allow or Deny">
                    <label class="switch switch--sm">
                        <input type="checkbox" class="scope-enabled" checked onchange="this.closest('.scope-toggle-label').querySelector('.scope-toggle-text').textContent = this.checked ? 'Allow' : 'Deny'; this.closest('.scope-toggle-label').querySelector('.scope-toggle-text').className = 'scope-toggle-text ' + (this.checked ? 'active' : 'inactive')">
                        <span class="switch-slider"></span>
                    </label>
                </label>
                <label class="scope-toggle-label" title="Exclusive: only usable here">
                    <label class="switch switch--sm">
                        <input type="checkbox" class="scope-exclusive" onchange="this.closest('.scope-toggle-label').querySelector('.scope-toggle-text').classList.toggle('exclusive', this.checked)">
                        <span class="switch-slider switch-slider--accent"></span>
                    </label>
                </label>
            </div>
            <button class="btn btn-danger btn-xs" onclick="this.closest('.scope-row').remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(div);

        // Initialize the searchable select for this row
        this.initScopeTargetSelect(div);
    },

    // ── Initialize Scope Target Searchable Select ──────────────
    async initScopeTargetSelect(row) {
        const typeSelect = row.querySelector('.scope-type');
        const targetWrapper = row.querySelector('.scope-target');
        const hiddenInput = targetWrapper.querySelector('.scope-id');
        const displayInput = targetWrapper.querySelector('.scope-display');

        const type = typeSelect.value;
        let items = [];

        if (type === 'channel') {
            items = await this.selectManager.fetchChannels();
        } else if (type === 'role') {
            items = await this.selectManager.fetchRoles();
        } else if (type === 'user') {
            items = await this.selectManager.fetchMembers();
        }

        // Create dropdown
        displayInput.onclick = () => {
            this.showScopeDropdown(displayInput, items, type, (selected) => {
                hiddenInput.value = selected.id;
                displayInput.value = type === 'channel' ? `#${selected.name}` :
                                    type === 'role' ? `@${selected.name}` :
                                    selected.display_name || selected.username || selected.name;
            });
        };
    },

    // ── Show Scope Target Dropdown ─────────────────────────────
    showScopeDropdown(input, items, type, onSelect) {
        // Remove any existing dropdown
        document.querySelectorAll('.scope-dropdown').forEach(d => d.remove());

        const dropdown = document.createElement('div');
        dropdown.className = 'scope-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            z-index: 9999;
            background: var(--bg-raised);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            max-height: 200px;
            overflow-y: auto;
            width: ${input.offsetWidth}px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        const rect = input.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
        dropdown.style.left = `${rect.left + window.scrollX}px`;

        items.forEach(item => {
            const opt = document.createElement('div');
            opt.className = 'scope-dropdown-item';
            opt.style.cssText = `
                padding: 0.5rem 0.75rem;
                cursor: pointer;
                font-size: 0.85rem;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            `;
            opt.onmouseenter = () => opt.style.background = 'var(--bg-raised-2)';
            opt.onmouseleave = () => opt.style.background = '';

            if (type === 'channel') {
                opt.innerHTML = `<i class="fas fa-hashtag" style="color:var(--fg-dim);"></i> ${item.name}`;
            } else if (type === 'role') {
                const color = item.color ? `#${item.color.toString(16).padStart(6, '0')}` : 'var(--fg-dim)';
                opt.innerHTML = `<span style="width:12px;height:12px;border-radius:50%;background:${color};"></span> ${item.name}`;
            } else {
                opt.innerHTML = `<i class="fas fa-user" style="color:var(--fg-dim);"></i> ${item.display_name || item.username}`;
            }

            opt.onclick = () => {
                onSelect(item);
                dropdown.remove();
            };
            dropdown.appendChild(opt);
        });

        document.body.appendChild(dropdown);

        // Close on outside click
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    },

    // ── Update Scope Target When Type Changes ──────────────────
    updateScopeTarget(typeSelect) {
        const row = typeSelect.closest('.scope-row');
        const hiddenInput = row.querySelector('.scope-id');
        const displayInput = row.querySelector('.scope-display');
        
        // Clear current selection
        hiddenInput.value = '';
        displayInput.value = '';
        
        // Re-init with new type
        this.initScopeTargetSelect(row);
    },

    // ── Collect Scopes from Modal ──────────────────────────────
    collectScopesFromModal() {
        const rows = document.querySelectorAll('.scope-row');
        const scopes = [];
        rows.forEach(row => {
            const type = row.querySelector('.scope-type')?.value;
            const id = row.querySelector('.scope-id')?.value;
            const enabled = row.querySelector('.scope-enabled')?.checked;
            const exclusive = row.querySelector('.scope-exclusive')?.checked;
            if (type && id) {
                scopes.push({ type, id, enabled: enabled !== false, exclusive: exclusive || false });
            }
        });
        return scopes;
    },

    // ── Module Scope Modal ─────────────────────────────────────
    async openModuleScopeModal(moduleName) {
        // Redirect to the full settings modal
        await this.openModuleSettings(moduleName);
    },

    // ══════════════════════════════════════════════════════════
    //  SCOPE RULES SECTION (Legacy + Enhanced)
    // ══════════════════════════════════════════════════════════

    renderScopeRulesList(rules) {
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
                    <span class="scope-badge scope-badge--${r.scope_type}">${r.scope_type}</span>
                    <span style="font-size:0.72rem;color:var(--fg-dim);">
                        ${r.target_type}: <code>${r.target_id || 'all'}</code>
                    </span>
                </div>
                <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();dashboard.deleteScopeRule(${r.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    },

    // ── Open Scope Rule Modal (Add/Edit) ───────────────────────
    async openScopeRuleModal(existingRule = null) {
        const isEdit = !!existingRule;
        const title = isEdit ? 'Edit Scope Rule' : 'Add Scope Rule';

        // Build command options from loaded commands
        const commandOptions = this._commandsData?.map(c => 
            `<option value="${c.name}" ${existingRule?.command_name === c.name ? 'selected' : ''}>${c.name}</option>`
        ).join('') || '';

        const modalContent = `
            <div class="scope-rule-modal">
                <div class="form-field">
                    <label>Command</label>
                    <select id="modal-scope-cmd" class="input">
                        <option value="">Select command...</option>
                        ${commandOptions}
                    </select>
                </div>

                <div class="form-row">
                    <div class="form-field">
                        <label>Target Type</label>
                        <select id="modal-scope-target-type" class="input" onchange="dashboard.updateScopeRuleTarget()">
                            <option value="channel" ${existingRule?.target_type === 'channel' ? 'selected' : ''}>Channel</option>
                            <option value="role" ${existingRule?.target_type === 'role' ? 'selected' : ''}>Role</option>
                            <option value="user" ${existingRule?.target_type === 'user' ? 'selected' : ''}>User</option>
                        </select>
                    </div>
                    <div class="form-field" style="flex:2;">
                        <label>Target</label>
                        <div class="searchable-select" id="scope-rule-target-wrapper">
                            <input type="hidden" id="modal-scope-target" value="${existingRule?.target_id || ''}">
                            <input type="text" id="modal-scope-target-display" class="input searchable-input" 
                                   placeholder="Click to select..." value="${existingRule?.target_id || ''}" readonly>
                        </div>
                    </div>
                </div>

                <div class="form-field">
                    <label>Action</label>
                    <select id="modal-scope-action" class="input">
                        <option value="allow" ${existingRule?.scope_type === 'allow' ? 'selected' : ''}>Allow</option>
                        <option value="deny" ${existingRule?.scope_type === 'deny' ? 'selected' : ''}>Deny</option>
                    </select>
                </div>
            </div>
        `;

        this.showModal(title, modalContent, async () => {
            const command_name = document.getElementById('modal-scope-cmd')?.value;
            const target_type = document.getElementById('modal-scope-target-type')?.value;
            const target_id = document.getElementById('modal-scope-target')?.value;
            const scope_type = document.getElementById('modal-scope-action')?.value;

            if (!command_name) {
                this.toast('Please select a command', 'warning');
                return;
            }

            const data = { command_name, scope_type, target_type, target_id };

            if (isEdit) {
                await this.apiCall(`/scope-rules/${existingRule.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
            } else {
                await this.apiCall('/scope-rules', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
            }

            this.closeModal();
            this.loadCommandsData();
            this.toast(`Scope rule ${isEdit ? 'updated' : 'created'}`, 'success');
        });

        // Initialize target selector
        setTimeout(() => this.initScopeRuleTargetSelect(), 50);
    },

    // ── Initialize Scope Rule Target Select ────────────────────
    async initScopeRuleTargetSelect() {
        const typeSelect = document.getElementById('modal-scope-target-type');
        const hiddenInput = document.getElementById('modal-scope-target');
        const displayInput = document.getElementById('modal-scope-target-display');
        if (!typeSelect || !hiddenInput || !displayInput) return;

        const type = typeSelect.value;
        let items = [];

        if (type === 'channel') {
            items = await this.selectManager.fetchChannels();
        } else if (type === 'role') {
            items = await this.selectManager.fetchRoles();
        } else if (type === 'user') {
            items = await this.selectManager.fetchMembers();
        }

        displayInput.onclick = () => {
            this.showScopeDropdown(displayInput, items, type, (selected) => {
                hiddenInput.value = selected.id;
                displayInput.value = type === 'channel' ? `#${selected.name}` :
                                    type === 'role' ? `@${selected.name}` :
                                    selected.display_name || selected.username || selected.name;
            });
        };
    },

    updateScopeRuleTarget() {
        document.getElementById('modal-scope-target').value = '';
        document.getElementById('modal-scope-target-display').value = '';
        this.initScopeRuleTargetSelect();
    },

    async editScopeRule(ruleId) {
        const rule = await this.apiCall(`/scope-rules/${ruleId}`);
        if (rule) {
            this.openScopeRuleModal(rule);
        }
    },

    async deleteScopeRule(ruleId) {
        if (!confirm('Delete this scope rule?')) return;
        await this.apiCall(`/scope-rules/${ruleId}`, { method: 'DELETE' });
        this.loadCommandsData();
        this.toast('Scope rule deleted', 'success');
    }
};
