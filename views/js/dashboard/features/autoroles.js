// ============================================================
//  dashboard/features/autoroles.js — Auto-role management
//  Automatically assign roles to new members joining the server
// ============================================================

/**
 * Autoroles feature mixin
 * Manages automatic role assignment for new members
 */
export const AutorolesMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupAutorolesListeners() {
        document.getElementById('add-autorole')?.addEventListener('click', () => this.addAutorole());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadAutorolesData() {
        // Initialize the role dropdown
        await this.initAutoroleSelect();
        
        // Load existing autoroles
        const autoroles = await this.apiCall('/autoroles');
        const list = document.getElementById('autoroles-list');
        if (!list) return;
        
        if (!autoroles || !autoroles.length) {
            list.innerHTML = '<p style="color:var(--fg-dim);">No autoroles configured. New members won\'t receive any automatic roles.</p>';
            return;
        }
        
        // Fetch roles to get names
        const guildRoles = await this.selectManager?.fetchRoles() || [];
        const roleMap = new Map(guildRoles.map(r => [r.id, r]));
        
        list.innerHTML = autoroles.map(ar => {
            const role = roleMap.get(ar.role_id);
            const roleName = role ? role.name : `Unknown Role (${ar.role_id})`;
            const roleColor = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--fg-dim)';
            
            return `
            <div class="item-row">
                <div style="display:flex;align-items:center;gap:0.75rem;">
                    <span class="role-color" style="background:${roleColor};width:12px;height:12px;border-radius:50%;flex-shrink:0;"></span>
                    <div style="display:flex;flex-direction:column;gap:0.1rem;">
                        <span style="font-weight:500;">${this.escapeHtml(roleName)}</span>
                        <span style="font-size:0.72rem;color:var(--fg-dim);font-family:monospace;">${ar.role_id}</span>
                    </div>
                </div>
                <div style="display:flex;gap:0.4rem;">
                    <button class="btn btn-danger btn-xs" onclick="dashboard.deleteAutorole('${ar.role_id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `}).join('');
    },

    // ── Initialize Role Dropdown ───────────────────────────────
    async initAutoroleSelect() {
        const selectElement = document.getElementById('autorole-role-id');
        if (!selectElement) return;
        
        // Initialize searchable select if manager exists
        if (this.selectManager) {
            const select = await this.selectManager.init(selectElement, 'role', {
                placeholder: 'Search for a role...',
                onSelect: (item) => {
                    // Optional: could auto-submit or just store the value
                }
            });
            this.autoroleSelect = select;
        }
    },

    // ── Add Autorole ───────────────────────────────────────────
    async addAutorole() {
        const roleId = this.autoroleSelect?.getValue() || document.getElementById('autorole-role-id')?.value?.trim();
        
        if (!roleId) {
            this.toast('Please select a role', 'warning');
            return;
        }
        
        const result = await this.apiCall('/autoroles', {
            method: 'POST',
            body: JSON.stringify({ role_id: roleId })
        });
        
        if (result && result.success) {
            this.toast('Autorole added successfully!', 'success');
            // Clear the selection
            if (this.autoroleSelect) {
                this.autoroleSelect.clear();
            }
            // Reload the list
            this.loadAutorolesData();
        } else if (result && result.error) {
            // Handle duplicate error gracefully
            if (result.error.includes('already')) {
                this.toast('This role is already set as an autorole', 'warning');
            } else {
                this.toast(result.error, 'error');
            }
        }
    },

    // ── Delete Autorole ────────────────────────────────────────
    async deleteAutorole(roleId) {
        const result = await this.apiCall(`/autoroles/${roleId}`, { method: 'DELETE' });
        
        if (result && result.success) {
            this.toast('Autorole removed', 'success');
            this.loadAutorolesData();
        }
    },

    // ── Utility: Escape HTML ───────────────────────────────────
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
