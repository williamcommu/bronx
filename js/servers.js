/* ============================================================
   bronx · servers page — client logic
   ============================================================ */

(function () {
    'use strict';

    /* ── DOM Refs ─────────────────────────────────────────── */
    const $ = id => document.getElementById(id);
    const loadingState    = $('loading-state');
    const loginState      = $('login-state');
    const serversState    = $('servers-state');
    const userChip        = $('user-chip');
    const userAvatar      = $('user-avatar');
    const userName        = $('user-name');
    const logoutBtn       = $('logout-btn');
    const ownerCardWrap   = $('owner-card-wrap');
    const serverSearch    = $('server-search');
    const serverGrid      = $('server-grid');
    const noServers       = $('no-servers');
    const toastContainer  = $('toast-container');

    let allGuilds = [];

    /* ── Init ─────────────────────────────────────────────── */
    async function init() {
        try {
            const res = await fetch('/api/auth/user', { credentials: 'same-origin' });
            const data = await res.json();

            if (!data.authenticated) {
                show(loginState);
                hide(loadingState);
                return;
            }

            // Populate user chip
            const user = data.user;
            if (user.avatar) {
                userAvatar.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
            } else {
                userAvatar.src = `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
            }
            userName.textContent = user.global_name || user.username;
            show(userChip);

            // Show owner card if bot owner
            if (data.isBotOwner) {
                show(ownerCardWrap);
            }

            // Build server list
            allGuilds = (data.guilds || []).slice().sort((a, b) => {
                return (a.name || '').localeCompare(b.name || '');
            });

            renderGuilds(allGuilds);
            hide(loadingState);
            show(serversState);

        } catch (err) {
            console.error('Failed to load auth data:', err);
            hide(loadingState);
            show(loginState);
            toast('Failed to connect. Try again later.', 'error');
        }
    }

    /* ── Render Guild Cards ───────────────────────────────── */
    function renderGuilds(guilds) {
        serverGrid.innerHTML = '';

        if (guilds.length === 0) {
            show(noServers);
            return;
        }
        hide(noServers);

        const frag = document.createDocumentFragment();
        for (const guild of guilds) {
            const card = document.createElement('a');
            card.href = `/dashboard?server=${guild.id}`;
            card.className = 'server-card';
            card.dataset.name = (guild.name || '').toLowerCase();

            // Icon
            const iconWrap = document.createElement('div');
            iconWrap.className = 'server-card-icon';
            if (guild.icon) {
                const img = document.createElement('img');
                img.src = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96`;
                img.alt = guild.name;
                img.loading = 'lazy';
                iconWrap.appendChild(img);
            } else {
                const span = document.createElement('span');
                span.className = 'server-initial';
                span.textContent = getInitials(guild.name);
                iconWrap.appendChild(span);
            }

            // Info
            const info = document.createElement('div');
            info.className = 'server-card-info';

            const name = document.createElement('span');
            name.className = 'server-card-name';
            name.textContent = guild.name;

            const role = document.createElement('span');
            role.className = 'server-card-role';
            role.textContent = getRoleBadge(guild.permissions);

            info.appendChild(name);
            info.appendChild(role);

            // Arrow
            const arrow = document.createElement('i');
            arrow.className = 'fas fa-chevron-right server-card-arrow';

            card.appendChild(iconWrap);
            card.appendChild(info);
            card.appendChild(arrow);
            frag.appendChild(card);
        }
        serverGrid.appendChild(frag);
    }

    /* ── Helpers ───────────────────────────────────────────── */
    function getInitials(name) {
        if (!name) return '?';
        return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }

    function getRoleBadge(permissions) {
        if (!permissions) return 'member';
        // permissions is { isOwner, canManage, canAdmin } from server
        if (typeof permissions === 'object') {
            if (permissions.isOwner) return 'owner';
            if (permissions.canAdmin) return 'administrator';
            if (permissions.canManage) return 'manage server';
            return 'member';
        }
        // Fallback for raw permission integer
        const perm = typeof permissions === 'string' ? parseInt(permissions) : permissions;
        if (perm & 0x8) return 'administrator';
        if (perm & 0x20) return 'manage server';
        return 'member';
    }

    function show(el) { if (el) el.style.display = ''; }
    function hide(el) { if (el) el.style.display = 'none'; }

    /* ── Search / Filter ──────────────────────────────────── */
    if (serverSearch) {
        let debounce;
        serverSearch.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const q = serverSearch.value.trim().toLowerCase();
                if (!q) {
                    renderGuilds(allGuilds);
                    return;
                }
                const filtered = allGuilds.filter(g => (g.name || '').toLowerCase().includes(q));
                renderGuilds(filtered);
            }, 150);
        });
    }

    /* ── Logout ───────────────────────────────────────────── */
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/logout', { credentials: 'same-origin' });
            } catch (_) { /* ignore */ }
            window.location.href = '/servers';
        });
    }

    /* ── Toast ─────────────────────────────────────────────── */
    function toast(message, type = 'info') {
        const el = document.createElement('div');
        el.style.cssText = `
            padding: 0.65rem 1rem;
            background: var(--bg-raised-2);
            border: 1px solid ${type === 'error' ? 'var(--danger)' : 'var(--border)'};
            border-radius: var(--radius);
            color: var(--fg);
            font-size: 0.82rem;
            animation: slideIn 0.25s ease;
            max-width: 340px;
        `;
        el.textContent = message;
        toastContainer.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 300);
        }, 4000);
    }

    /* ── Boot ──────────────────────────────────────────────── */
    init();
})();
