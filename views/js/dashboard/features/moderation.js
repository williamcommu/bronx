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

        // infraction filters
        document.getElementById('infraction-filter-type')?.addEventListener('change', () => this.loadInfractionsData(1));
        document.getElementById('infraction-filter-user')?.addEventListener('change', () => this.loadInfractionsData(1));
        document.getElementById('infraction-filter-active')?.addEventListener('change', () => this.loadInfractionsData(1));

        // save buttons
        document.getElementById('save-infraction-config')?.addEventListener('click', () => this.saveInfractionConfig());
        document.getElementById('save-automod-config')?.addEventListener('click', () => this.saveAutomodConfig());
        document.getElementById('create-role-class')?.addEventListener('click', () => this.createRoleClass());

        // event delegation for dynamic buttons
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mod-action]');
            if (!btn) return;
            const action = btn.dataset.modAction;
            const id = btn.dataset.id;
            switch (action) {
                case 'view-infraction':   this.viewInfractionDetail(id); break;
                case 'pardon-infraction': this.pardonInfraction(id); break;
                case 'edit-role-class':   this.editRoleClass(id); break;
                case 'delete-role-class': this.deleteRoleClass(id); break;
                case 'assign-role':      this.assignRoleToClass(id); break;
                case 'remove-role':      this.removeRoleFromClass(btn.dataset.classId, id); break;
                case 'infraction-page':  this.loadInfractionsData(parseInt(id)); break;
            }
        });
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

        await Promise.all([
            this.loadInfractionsData(),
            this.loadInfractionConfig(),
            this.loadAutomodConfig(),
            this.loadRoleClassesData(),
        ]);
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

    // ── Infractions ────────────────────────────────────────────
    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    async loadInfractionsData(page = 1) {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        const typeFilter = document.getElementById('infraction-filter-type')?.value || '';
        const userFilter = document.getElementById('infraction-filter-user')?.value.trim() || '';
        const activeOnly = document.getElementById('infraction-filter-active')?.checked || false;

        let url = `/moderation/infractions?page=${page}&limit=25`;
        if (typeFilter) url += `&type=${encodeURIComponent(typeFilter)}`;
        if (userFilter) url += `&user_id=${encodeURIComponent(userFilter)}`;
        if (activeOnly) url += `&active=true`;

        const data = await this.apiCall(url);
        const container = document.getElementById('infractions-container');
        if (!container || !data) return;

        const infractions = data.infractions || [];
        const totalPages = data.totalPages || 1;

        const filterHtml = `
            <div class="infraction-filters" style="display:flex;gap:0.75rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
                <select id="infraction-filter-type" class="input" style="width:auto;">
                    <option value="">all types</option>
                    <option value="warn"${typeFilter === 'warn' ? ' selected' : ''}>warn</option>
                    <option value="mute"${typeFilter === 'mute' ? ' selected' : ''}>mute</option>
                    <option value="kick"${typeFilter === 'kick' ? ' selected' : ''}>kick</option>
                    <option value="ban"${typeFilter === 'ban' ? ' selected' : ''}>ban</option>
                    <option value="timeout"${typeFilter === 'timeout' ? ' selected' : ''}>timeout</option>
                </select>
                <input type="text" id="infraction-filter-user" class="input" placeholder="user id..." value="${esc(userFilter)}" style="width:160px;">
                <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.82rem;">
                    <input type="checkbox" id="infraction-filter-active" ${activeOnly ? 'checked' : ''}> active only
                </label>
            </div>
        `;

        const tableHtml = infractions.length === 0
            ? '<p style="opacity:0.6;font-size:0.85rem;">no infractions found</p>'
            : `
            <table class="infraction-table" style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                <thead>
                    <tr style="text-align:left;border-bottom:1px solid var(--border);">
                        <th style="padding:0.5rem;">case #</th>
                        <th style="padding:0.5rem;">user</th>
                        <th style="padding:0.5rem;">moderator</th>
                        <th style="padding:0.5rem;">type</th>
                        <th style="padding:0.5rem;">points</th>
                        <th style="padding:0.5rem;">date</th>
                        <th style="padding:0.5rem;">status</th>
                        <th style="padding:0.5rem;">actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${infractions.map(inf => {
                        const statusClass = inf.active ? 'active' : 'pardoned';
                        const statusLabel = inf.active ? 'active' : 'pardoned';
                        const dateStr = inf.created_at ? new Date(inf.created_at).toLocaleDateString() : '—';
                        return `
                        <tr class="infraction-row">
                            <td style="padding:0.5rem;font-family:monospace;">${esc(String(inf.case_number))}</td>
                            <td style="padding:0.5rem;font-family:monospace;font-size:0.75rem;">${esc(String(inf.user_id))}</td>
                            <td style="padding:0.5rem;font-family:monospace;font-size:0.75rem;">${esc(String(inf.moderator_id))}</td>
                            <td style="padding:0.5rem;"><span class="infraction-badge infraction-badge--${esc(inf.type)}">${esc(inf.type)}</span></td>
                            <td style="padding:0.5rem;">${inf.points ?? '—'}</td>
                            <td style="padding:0.5rem;">${dateStr}</td>
                            <td style="padding:0.5rem;"><span class="infraction-badge infraction-badge--${statusClass}">${statusLabel}</span></td>
                            <td style="padding:0.5rem;display:flex;gap:0.35rem;">
                                <button class="btn btn-outline btn-xs" data-mod-action="view-infraction" data-id="${esc(String(inf.case_number))}"><i class="fas fa-eye"></i> view</button>
                                ${inf.active ? `<button class="btn btn-outline btn-xs" style="color:var(--warning);" data-mod-action="pardon-infraction" data-id="${esc(String(inf.case_number))}"><i class="fas fa-gavel"></i> pardon</button>` : ''}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;

        const paginationHtml = totalPages > 1 ? `
            <div class="infraction-pagination" style="display:flex;gap:0.5rem;justify-content:center;margin-top:1rem;">
                ${page > 1 ? `<button class="btn btn-outline btn-xs" data-mod-action="infraction-page" data-id="${page - 1}"><i class="fas fa-chevron-left"></i> prev</button>` : ''}
                <span style="font-size:0.82rem;opacity:0.7;">page ${page} / ${totalPages}</span>
                ${page < totalPages ? `<button class="btn btn-outline btn-xs" data-mod-action="infraction-page" data-id="${page + 1}">next <i class="fas fa-chevron-right"></i></button>` : ''}
            </div>` : '';

        container.innerHTML = filterHtml + tableHtml + paginationHtml;

        // re-bind filter listeners after render
        document.getElementById('infraction-filter-type')?.addEventListener('change', () => this.loadInfractionsData(1));
        document.getElementById('infraction-filter-user')?.addEventListener('change', () => this.loadInfractionsData(1));
        document.getElementById('infraction-filter-active')?.addEventListener('change', () => this.loadInfractionsData(1));
    },

    async viewInfractionDetail(caseNumber) {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        const inf = await this.apiCall(`/moderation/infractions/${caseNumber}`);
        if (!inf) return;

        const dateStr = inf.created_at ? new Date(inf.created_at).toLocaleString() : '—';
        const expiresStr = inf.expires_at ? new Date(inf.expires_at).toLocaleString() : '—';
        const metaStr = inf.metadata ? JSON.stringify(inf.metadata, null, 2) : '—';

        this.showModal(`infraction #${esc(String(inf.case_number))}`, `
            <div style="font-size:0.85rem;display:grid;grid-template-columns:auto 1fr;gap:0.4rem 1rem;">
                <strong>case #</strong><span style="font-family:monospace;">${esc(String(inf.case_number))}</span>
                <strong>user</strong><span style="font-family:monospace;">${esc(String(inf.user_id))}</span>
                <strong>moderator</strong><span style="font-family:monospace;">${esc(String(inf.moderator_id))}</span>
                <strong>type</strong><span>${esc(inf.type)}</span>
                <strong>reason</strong><span>${esc(inf.reason || 'none')}</span>
                <strong>points</strong><span>${inf.points ?? '—'}</span>
                <strong>duration</strong><span>${esc(inf.duration || '—')}</span>
                <strong>expires at</strong><span>${expiresStr}</span>
                <strong>active</strong><span>${inf.active ? 'yes' : 'no'}</span>
                ${inf.pardoned_by ? `<strong>pardoned by</strong><span style="font-family:monospace;">${esc(String(inf.pardoned_by))}</span>` : ''}
                ${inf.pardon_reason ? `<strong>pardon reason</strong><span>${esc(inf.pardon_reason)}</span>` : ''}
                <strong>created</strong><span>${dateStr}</span>
                <strong>metadata</strong><pre style="margin:0;font-size:0.75rem;max-height:120px;overflow:auto;background:var(--bg-secondary);padding:0.5rem;border-radius:4px;">${esc(metaStr)}</pre>
            </div>
        `);
    },

    async pardonInfraction(caseNumber) {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        this.showModal(`pardon infraction #${esc(String(caseNumber))}`, `
            <div class="form-field">
                <label>reason for pardon</label>
                <textarea id="modal-pardon-reason" rows="3" class="input" placeholder="reason..." style="resize:vertical;"></textarea>
            </div>
        `, async () => {
            const reason = document.getElementById('modal-pardon-reason')?.value.trim();
            const res = await this.apiCall(`/moderation/infractions/${caseNumber}/pardon`, {
                method: 'POST',
                body: JSON.stringify({ reason }),
            });
            if (res) {
                this.toast('infraction pardoned', 'success');
                this.closeModal();
                this.loadInfractionsData();
            } else {
                this.toast('failed to pardon infraction', 'error');
            }
        });
    },

    // ── Infraction Config ──────────────────────────────────────
    async loadInfractionConfig() {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        const config = await this.apiCall('/moderation/config');
        const container = document.getElementById('infraction-config-container');
        if (!container || !config) return;

        // Schema columns: point_warn, point_timeout, point_mute, point_kick, point_ban
        const pointValues = {
            warn:    config.point_warn    ?? 0.10,
            timeout: config.point_timeout ?? 0.25,
            mute:    config.point_mute    ?? 0.50,
            kick:    config.point_kick    ?? 2.00,
            ban:     config.point_ban     ?? 5.00,
        };
        const escalationRules = (() => {
            try {
                const raw = config.escalation_rules;
                return Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            } catch { return []; }
        })();

        const pointFieldsHtml = Object.entries(pointValues).map(([type, pts]) => `
            <div class="config-field" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <label style="width:100px;font-size:0.82rem;">${esc(type)}</label>
                <input type="number" step="0.01" class="input infraction-point-value" data-type="${esc(type)}" value="${pts}" min="0" style="width:80px;">
            </div>
        `).join('');

        const escalationHtml = escalationRules.map((rule, i) => `
            <div class="config-field" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;background:var(--bg-secondary);padding:0.5rem;border-radius:4px;">
                <span style="font-size:0.8rem;">at <strong>${rule.threshold}</strong> pts → <strong>${esc(rule.action)}</strong>${rule.duration ? ` (${esc(rule.duration)})` : ''}</span>
                <button class="btn btn-outline btn-xs" style="margin-left:auto;color:var(--danger);" onclick="dashboard._removeEscalationRule(${i})"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="config-card" style="margin-bottom:1.5rem;">
                <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">point values</h4>
                ${pointFieldsHtml}
            </div>
            <div class="config-card" style="margin-bottom:1.5rem;">
                <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">escalation rules</h4>
                <div id="escalation-rules-list">${escalationHtml || '<p style="opacity:0.6;font-size:0.82rem;">no escalation rules</p>'}</div>
                <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;">
                    <input type="number" id="new-escalation-threshold" class="input" placeholder="threshold pts" min="1" style="width:110px;">
                    <select id="new-escalation-action" class="input" style="width:auto;">
                        <option value="mute">mute</option>
                        <option value="kick">kick</option>
                        <option value="ban">ban</option>
                        <option value="timeout">timeout</option>
                    </select>
                    <input type="text" id="new-escalation-duration" class="input" placeholder="duration (opt)" style="width:110px;">
                    <button class="btn btn-outline btn-xs" onclick="dashboard._addEscalationRule()"><i class="fas fa-plus"></i> add</button>
                </div>
            </div>
            <div class="config-card" style="margin-bottom:1.5rem;">
                <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">actions</h4>
                <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;">
                    <input type="checkbox" id="infraction-dm-on-action" ${config.dm_on_action ? 'checked' : ''}>
                    DM user on infraction
                </label>
                <div class="form-field" style="margin-top:0.75rem;">
                    <label style="font-size:0.82rem;">log channel ID</label>
                    <input type="text" id="infraction-log-channel" class="input" value="${esc(String(config.log_channel_id || ''))}" placeholder="channel id...">
                </div>
            </div>
            <button class="btn btn-primary" id="save-infraction-config"><i class="fas fa-save"></i> save config</button>
        `;

        this._escalationRules = [...escalationRules];
        document.getElementById('save-infraction-config')?.addEventListener('click', () => this.saveInfractionConfig());
    },

    _addEscalationRule() {
        const threshold = parseFloat(document.getElementById('new-escalation-threshold')?.value);
        const action = document.getElementById('new-escalation-action')?.value;
        const duration = document.getElementById('new-escalation-duration')?.value.trim() || null;
        if (!threshold || !action) { this.toast('threshold and action are required', 'warning'); return; }
        this._escalationRules = this._escalationRules || [];
        this._escalationRules.push({ threshold, action, duration });
        this.loadInfractionConfig();
    },

    _removeEscalationRule(index) {
        this._escalationRules = this._escalationRules || [];
        this._escalationRules.splice(index, 1);
        this.loadInfractionConfig();
    },

    async saveInfractionConfig() {
        const pointValues = {};
        document.querySelectorAll('.infraction-point-value').forEach(el => {
            pointValues[el.dataset.type] = parseFloat(el.value) || 0;
        });

        const res = await this.apiCall('/moderation/config', {
            method: 'POST',
            body: JSON.stringify({
                point_warn:    pointValues['warn']    ?? 0.10,
                point_timeout: pointValues['timeout'] ?? 0.25,
                point_mute:    pointValues['mute']    ?? 0.50,
                point_kick:    pointValues['kick']    ?? 2.00,
                point_ban:     pointValues['ban']     ?? 5.00,
                escalation_rules: this._escalationRules || [],
                dm_on_action: document.getElementById('infraction-dm-on-action')?.checked ?? true,
                log_channel_id: document.getElementById('infraction-log-channel')?.value.trim() || null,
            }),
        });
        if (res) {
            this.toast('infraction config saved', 'success');
        } else {
            this.toast('failed to save config', 'error');
        }
    },

    // ── Automod Config ─────────────────────────────────────────
    async loadAutomodConfig() {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        // GET now returns nested structure: { account_age: { enabled, min_days }, ... }
        const config = await this.apiCall('/moderation/automod');
        const container = document.getElementById('automod-config-container');
        if (!container || !config) return;

        const features = [
            { key: 'account_age',        label: 'account age gate',    fields: [{ name: 'min_days',           label: 'minimum days',           type: 'number'   }] },
            { key: 'avatar',             label: 'avatar check',         fields: [{ name: 'require_avatar',     label: 'require avatar',         type: 'checkbox' }] },
            { key: 'mutual_servers',     label: 'mutual servers',       fields: [{ name: 'min_mutual',         label: 'minimum mutual servers', type: 'number'   }] },
            { key: 'nickname_sanitizer', label: 'nickname sanitizer',   fields: [{ name: 'sanitize_pattern',   label: 'regex pattern',          type: 'text'     }] },
            { key: 'escalation',         label: 'auto escalation',      fields: [{ name: 'enabled_escalation', label: 'enable escalation',      type: 'checkbox' }] },
        ];

        container.innerHTML = features.map(feat => {
            const featureConfig = config[feat.key] || {};
            const enabled = featureConfig.enabled ?? false;

            const fieldsHtml = feat.fields.map(f => {
                const val = featureConfig[f.name] ?? '';
                if (f.type === 'checkbox') {
                    return `
                        <div class="config-field" style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;">
                            <input type="checkbox" class="config-toggle automod-field" data-feature="${esc(feat.key)}" data-field="${esc(f.name)}" ${val ? 'checked' : ''}>
                            <label style="font-size:0.82rem;">${esc(f.label)}</label>
                        </div>`;
                }
                return `
                    <div class="config-field" style="margin-top:0.5rem;">
                        <label style="font-size:0.82rem;">${esc(f.label)}</label>
                        <input type="${f.type}" class="input automod-field" data-feature="${esc(feat.key)}" data-field="${esc(f.name)}" value="${esc(String(val))}" style="width:160px;">
                    </div>`;
            }).join('');

            return `
                <div class="config-card" style="padding:1rem;margin-bottom:1rem;border:1px solid var(--border);border-radius:6px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <h4 style="font-size:0.88rem;margin:0;">${esc(feat.label)}</h4>
                        <label class="config-toggle" style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;">
                            <input type="checkbox" class="automod-enabled" data-feature="${esc(feat.key)}" ${enabled ? 'checked' : ''}>
                            ${enabled ? 'enabled' : 'disabled'}
                        </label>
                    </div>
                    ${fieldsHtml}
                </div>`;
        }).join('');

        container.innerHTML += `<button class="btn btn-primary" id="save-automod-config"><i class="fas fa-save"></i> save automod</button>`;
        document.getElementById('save-automod-config')?.addEventListener('click', () => this.saveAutomodConfig());
    },

    async saveAutomodConfig() {
        const config = {};

        document.querySelectorAll('.automod-enabled').forEach(toggle => {
            const feature = toggle.dataset.feature;
            if (!config[feature]) config[feature] = {};
            config[feature].enabled = toggle.checked;
        });

        document.querySelectorAll('.automod-field').forEach(field => {
            const feature = field.dataset.feature;
            const fieldName = field.dataset.field;
            if (!config[feature]) config[feature] = {};
            config[feature][fieldName] = field.type === 'checkbox' ? field.checked : field.value;
        });

        const res = await this.apiCall('/moderation/automod', {
            method: 'POST',
            body: JSON.stringify(config),
        });
        if (res) {
            this.toast('automod config saved', 'success');
        } else {
            this.toast('failed to save automod config', 'error');
        }
    },

    // ── Role Classes ───────────────────────────────────────────
    async loadRoleClassesData() {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        const data = await this.apiCall('/moderation/role-classes');
        const container = document.getElementById('role-classes-container');
        if (!container) return;

        const classes = data || [];
        if (classes.length === 0) {
            container.innerHTML = `
                <p style="opacity:0.6;font-size:0.85rem;">no role classes configured</p>
                <button class="btn btn-primary btn-sm" id="create-role-class"><i class="fas fa-plus"></i> create role class</button>
            `;
            document.getElementById('create-role-class')?.addEventListener('click', () => this.createRoleClass());
            return;
        }

        container.innerHTML = classes.map(rc => {
            const rolesHtml = (rc.roles || []).map(r => `
                <span style="display:inline-flex;align-items:center;gap:0.25rem;background:var(--bg-secondary);padding:0.15rem 0.5rem;border-radius:3px;font-size:0.78rem;font-family:monospace;">
                    ${esc(String(r))}
                    <button class="btn btn-outline btn-xs" style="padding:0 0.2rem;color:var(--danger);font-size:0.7rem;" data-mod-action="remove-role" data-class-id="${esc(String(rc.id))}" data-id="${esc(String(r))}"><i class="fas fa-times"></i></button>
                </span>
            `).join(' ');

            const allowedCmds = (rc.restrictions?.allowed || []).join(', ') || 'all';
            const deniedCmds = (rc.restrictions?.denied || []).join(', ') || 'none';

            return `
                <div class="role-class-card" style="border:1px solid var(--border);border-radius:6px;margin-bottom:1rem;overflow:hidden;">
                    <div class="role-class-header" style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:var(--bg-secondary);">
                        <div>
                            <strong style="font-size:0.9rem;">${esc(rc.name)}</strong>
                            <span style="font-size:0.78rem;opacity:0.6;margin-left:0.5rem;">priority: ${rc.priority ?? 0}</span>
                            ${rc.inherit_lower ? '<span style="font-size:0.72rem;opacity:0.5;margin-left:0.5rem;">inherits lower</span>' : ''}
                        </div>
                        <div style="display:flex;gap:0.35rem;">
                            <button class="btn btn-outline btn-xs" data-mod-action="assign-role" data-id="${esc(String(rc.id))}"><i class="fas fa-plus"></i> add role</button>
                            <button class="btn btn-outline btn-xs" data-mod-action="edit-role-class" data-id="${esc(String(rc.id))}"><i class="fas fa-pen"></i> edit</button>
                            <button class="btn btn-outline btn-xs" style="color:var(--danger);" data-mod-action="delete-role-class" data-id="${esc(String(rc.id))}"><i class="fas fa-trash"></i> delete</button>
                        </div>
                    </div>
                    <div class="role-class-body" style="padding:0.75rem 1rem;font-size:0.82rem;">
                        <div style="margin-bottom:0.5rem;"><strong>roles:</strong> ${rolesHtml || '<span style="opacity:0.5;">none</span>'}</div>
                        <div style="display:flex;gap:1.5rem;">
                            <div><strong>allowed:</strong> <span style="opacity:0.7;">${esc(allowedCmds)}</span></div>
                            <div><strong>denied:</strong> <span style="opacity:0.7;">${esc(deniedCmds)}</span></div>
                        </div>
                    </div>
                </div>`;
        }).join('');

        container.innerHTML += `<button class="btn btn-primary btn-sm" id="create-role-class"><i class="fas fa-plus"></i> create role class</button>`;
        document.getElementById('create-role-class')?.addEventListener('click', () => this.createRoleClass());
    },

    createRoleClass() {
        this._showRoleClassModal(null);
    },

    async editRoleClass(id) {
        const rc = await this.apiCall(`/moderation/role-classes/${id}`);
        if (!rc) return;
        this._showRoleClassModal(rc);
    },

    _showRoleClassModal(existing) {
        const esc = (s) => this.escapeHtml ? this.escapeHtml(s) : this._escapeHtml(s);
        const isEdit = !!existing;
        const title = isEdit ? `edit role class: ${esc(existing.name)}` : 'create role class';
        const name = existing?.name || '';
        const priority = existing?.priority ?? 0;
        const inheritLower = existing?.inherit_lower ?? false;
        const allowed = (existing?.restrictions?.allowed || []).join('\n');
        const denied = (existing?.restrictions?.denied || []).join('\n');

        this.showModal(title, `
            <div class="form-field"><label>name</label><input type="text" id="modal-rc-name" class="input" value="${esc(name)}"></div>
            <div class="form-row" style="display:flex;gap:0.75rem;">
                <div class="form-field"><label>priority</label><input type="number" id="modal-rc-priority" class="input" value="${priority}" min="0"></div>
                <div class="form-field" style="display:flex;align-items:center;gap:0.35rem;padding-top:1.5rem;"><input type="checkbox" id="modal-rc-inherit" ${inheritLower ? 'checked' : ''}><label>inherit lower</label></div>
            </div>
            <div class="form-field"><label>allowed commands (one per line)</label><textarea id="modal-rc-allowed" rows="4" class="input" style="resize:vertical;font-family:monospace;font-size:0.8rem;">${esc(allowed)}</textarea></div>
            <div class="form-field"><label>denied commands (one per line)</label><textarea id="modal-rc-denied" rows="4" class="input" style="resize:vertical;font-family:monospace;font-size:0.8rem;">${esc(denied)}</textarea></div>
        `, async () => {
            const nameVal = document.getElementById('modal-rc-name')?.value.trim();
            if (!nameVal) { this.toast('name is required', 'warning'); return; }
            const payload = {
                name: nameVal,
                priority: parseInt(document.getElementById('modal-rc-priority')?.value) || 0,
                inherit_lower: document.getElementById('modal-rc-inherit')?.checked || false,
                restrictions: {
                    allowed: (document.getElementById('modal-rc-allowed')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
                    denied:  (document.getElementById('modal-rc-denied')?.value  || '').split('\n').map(s => s.trim()).filter(Boolean),
                },
            };
            if (isEdit) payload.id = existing.id;

            const res = await this.apiCall('/moderation/role-classes', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            if (res) {
                this.toast(isEdit ? 'role class updated' : 'role class created', 'success');
                this.closeModal();
                this.loadRoleClassesData();
            } else {
                this.toast('failed to save role class', 'error');
            }
        });
    },

    async deleteRoleClass(id) {
        this.showModal('delete role class', `
            <p style="font-size:0.85rem;">are you sure you want to delete this role class? this action cannot be undone.</p>
        `, async () => {
            const res = await this.apiCall(`/moderation/role-classes/${id}`, { method: 'DELETE' });
            if (res !== undefined) {
                this.toast('role class deleted', 'success');
                this.closeModal();
                this.loadRoleClassesData();
            } else {
                this.toast('failed to delete role class', 'error');
            }
        });
    },

    async assignRoleToClass(classId) {
        this.showModal('assign role to class', `
            <div class="form-field">
                <label>role id</label>
                <input type="text" id="modal-assign-role-id" class="input" placeholder="role id...">
            </div>
        `, async () => {
            const roleId = document.getElementById('modal-assign-role-id')?.value.trim();
            if (!roleId) { this.toast('role id is required', 'warning'); return; }
            const res = await this.apiCall(`/moderation/role-classes/${classId}/roles`, {
                method: 'POST',
                body: JSON.stringify({ role_id: roleId }),
            });
            if (res) {
                this.toast('role assigned', 'success');
                this.closeModal();
                this.loadRoleClassesData();
            } else {
                this.toast('failed to assign role', 'error');
            }
        });
    },

    async removeRoleFromClass(classId, roleId) {
        const res = await this.apiCall(`/moderation/role-classes/${classId}/roles/${roleId}`, {
            method: 'DELETE',
        });
        if (res !== undefined) {
            this.toast('role removed', 'success');
            this.loadRoleClassesData();
        } else {
            this.toast('failed to remove role', 'error');
        }
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