// ============================================================
//  dashboard/features/users.js — User management
// ============================================================

import { formatNumber, formatCurrency } from '../utils.js';

/**
 * Helper: render a user avatar element (image or fallback icon)
 */
function userAvatar(user) {
    if (user.proxy_avatar_url || user.avatar_url) {
        const src = user.proxy_avatar_url || user.avatar_url;
        return `<img src="${src}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:none;align-items:center;justify-content:center;">
                    <i class="fas fa-user" style="font-size:0.72rem;color:var(--fg-dim);"></i>
                </div>`;
    }
    return `<div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;">
                <i class="fas fa-user" style="font-size:0.72rem;color:var(--fg-dim);"></i>
            </div>`;
}

/**
 * User Management feature mixin
 */
export const UsersMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupUserManagementListeners() {
        document.getElementById('search-users')?.addEventListener('click', () => this.searchUsers());
        document.getElementById('grant-badge')?.addEventListener('click', () => this.grantBadge());
        document.getElementById('revoke-badge')?.addEventListener('click', () => this.revokeBadge());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadUsersData() {
        const users = await this.apiCall('/users?limit=20');
        const list = document.getElementById('users-list');
        if (!list) return;
        if (!users || !users.length) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>No Users Found</h3><p>User data will appear once the bot is active.</p></div>';
            return;
        }

        // If the API didn't return usernames, try resolving client-side
        let memberMap = null;
        if (users.some(u => !u.username) && this.selectManager) {
            try {
                const members = await this.selectManager.fetchMembers();
                if (members && members.length) {
                    memberMap = new Map(members.map(m => [m.id, m]));
                }
            } catch (e) { /* ignore */ }
        }

        list.innerHTML = users.map(u => {
            const displayName = u.username || (memberMap?.get(u.user_id)?.display_name) || (memberMap?.get(u.user_id)?.username) || 'Unknown';
            return `
            <div class="item-row">
                <div style="display:flex;align-items:center;gap:0.7rem;">
                    ${userAvatar(u)}
                    <div style="display:flex;flex-direction:column;gap:0.1rem;">
                        <span style="font-weight:600;font-size:0.82rem;">${displayName}</span>
                        <span style="font-family:monospace;font-size:0.68rem;color:var(--fg-dim);">${u.user_id}</span>
                    </div>
                </div>
                <div style="display:flex;gap:0.4rem;align-items:center;">
                    <span style="font-size:0.72rem;padding:0.18rem 0.55rem;background:var(--border);border-radius:0.3rem;">Lv ${u.level || 0}</span>
                    <span style="font-size:0.72rem;padding:0.18rem 0.55rem;background:rgba(180,167,214,0.15);color:var(--accent);border-radius:0.3rem;">${formatCurrency(u.balance || 0)}</span>
                </div>
            </div>
        `}).join('');
    },

    // ── Search Users ───────────────────────────────────────────
    searchUsers() {
        const query = document.getElementById('user-search')?.value.trim();
        if (!query) { this.loadUsersData(); return; }
        this.apiCall(`/users/search?q=${encodeURIComponent(query)}`).then(async users => {
            const list = document.getElementById('users-list');
            if (!list) return;
            if (!users || !users.length) {
                list.innerHTML = '<p style="color:var(--fg-dim);padding:1rem;">No users match that query</p>';
                return;
            }

            // If the API didn't return usernames, try resolving client-side
            let memberMap = null;
            if (users.some(u => !u.username) && this.selectManager) {
                try {
                    const members = await this.selectManager.fetchMembers();
                    if (members && members.length) {
                        memberMap = new Map(members.map(m => [m.id, m]));
                    }
                } catch (e) { /* ignore */ }
            }

            list.innerHTML = users.map(u => {
                const displayName = u.username || (memberMap?.get(u.user_id)?.display_name) || (memberMap?.get(u.user_id)?.username) || 'Unknown';
                return `
                <div class="item-row">
                    <div style="display:flex;align-items:center;gap:0.7rem;">
                        ${userAvatar(u)}
                        <div style="display:flex;flex-direction:column;gap:0.1rem;">
                            <span style="font-weight:600;font-size:0.82rem;">${displayName}</span>
                            <span style="font-family:monospace;font-size:0.68rem;color:var(--fg-dim);">${u.user_id}</span>
                        </div>
                    </div>
                    <span style="font-size:0.72rem;padding:0.18rem 0.55rem;background:var(--border);border-radius:0.3rem;">Lv ${u.level || 0}</span>
                </div>
            `}).join('');
        });
    },

    // ── Badge Management ───────────────────────────────────────
    grantBadge() {
        const userId = document.getElementById('badge-user-id')?.value.trim();
        const badge = document.getElementById('badge-name')?.value.trim();
        if (!userId || !badge) { this.toast('User ID and badge name required', 'warning'); return; }
        this.apiCall('/users/badge', {
            method: 'POST', body: JSON.stringify({ user_id: userId, badge_name: badge })
        }).then(res => {
            if (res) {
                this.toast(`Badge "${badge}" granted`, 'success');
                document.getElementById('badge-user-id').value = '';
                document.getElementById('badge-name').value = '';
            }
        });
    },

    revokeBadge() {
        const userId = document.getElementById('badge-user-id')?.value.trim();
        const badge = document.getElementById('badge-name')?.value.trim();
        if (!userId || !badge) { this.toast('User ID and badge name required', 'warning'); return; }
        this.apiCall('/users/badge', {
            method: 'DELETE', body: JSON.stringify({ user_id: userId, badge_name: badge })
        }).then(res => {
            if (res) this.toast(`Badge "${badge}" revoked`, 'success');
        });
    }
};
