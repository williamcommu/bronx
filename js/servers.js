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

            // Build server list — bot-present first, then alphabetical
            allGuilds = (data.guilds || []).slice();
            
            // Fetch public guilds for discovery
            try {
                const pubRes = await fetch('/api/guilds/public');
                const publicGuilds = await pubRes.json();
                
                // Merge public guilds that user isn't already a member of or doesn't have access to
                publicGuilds.forEach(pub => {
                    const existing = allGuilds.find(g => g.id === pub.id);
                    if (!existing) {
                        allGuilds.push({
                            ...pub,
                            botPresent: true,
                            isGlobalDiscovery: true
                        });
                    } else {
                        // Mark linked guilds as also being global
                        existing.isGlobalDiscovery = true;
                        existing.rating = pub.rating;
                        existing.trend = pub.trend;
                    }
                });
            } catch (e) {
                console.warn('Failed to fetch public guilds:', e);
            }

            allGuilds.sort((a, b) => {
                const aBp = a.botPresent !== false ? 0 : 1;
                const bBp = b.botPresent !== false ? 0 : 1;
                if (aBp !== bBp) return aBp - bBp;
                
                // If bot is present in both, sort by rating/activity descending
                if (a.botPresent !== false && b.botPresent !== false) {
                    if ((b.rating || 0) !== (a.rating || 0)) {
                        return (b.rating || 0) - (a.rating || 0);
                    }
                }
                
                return (a.name || '').localeCompare(b.name || '');
            });

            allGuilds = allGuilds.filter(g => g && g.id && g.id !== 'undefined' && g.id !== 'null');
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

    const BOT_INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=828380019406929962&permissions=8&scope=bot%20applications.commands';

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
            if (!guild.id) {
                console.warn('Skipping guild with missing ID:', guild);
                continue;
            }
            const botPresent = guild.botPresent !== false;
            const card = document.createElement('a');
            card.href = botPresent
                ? `/dashboard?server=${guild.id}`
                : `${BOT_INVITE_URL}&guild_id=${guild.id}&disable_guild_select=true`;
            if (!botPresent) card.target = '_blank';
            card.className = 'server-card' + (botPresent ? '' : ' server-card--no-bot');
            card.dataset.name = (guild.name || '').toLowerCase();
            card.dataset.id = guild.id;

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

            const nameContainer = document.createElement('div');
            nameContainer.className = 'server-card-name-row';
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.gap = '0.5rem';

            const name = document.createElement('span');
            name.className = 'server-card-name';
            name.textContent = guild.name;
            nameContainer.appendChild(name);

            // Activity Trend Indicator
            if (botPresent && guild.trendIcon) {
                const trend = document.createElement('i');
                const color = guild.trend === 'hot' ? '#ff6b6b' : (guild.trend === 'growing' ? '#10b981' : (guild.trend === 'stable' ? '#9ca3af' : '#3b82f6'));
                trend.className = `fas ${guild.trendIcon} activity-meter`;
                trend.style.color = color;
                trend.style.fontSize = '0.75rem';
                trend.title = `${guild.trendPct}% activity change yesterday`;
                nameContainer.appendChild(trend);
            }

            const roleRow = document.createElement('div');
            roleRow.className = 'server-card-role-row';
            roleRow.style.display = 'flex';
            roleRow.style.alignItems = 'center';
            roleRow.style.gap = '0.4rem';

            const role = document.createElement('span');
            role.className = 'server-card-role';
            role.textContent = getRoleBadge(guild.permissions);
            roleRow.appendChild(role);

            // Rating (Message Volume) Badge
            if (botPresent && guild.rating > 0) {
                const rating = document.createElement('span');
                rating.className = 'server-card-rating';
                rating.style.fontSize = '0.65rem';
                rating.style.color = 'var(--fg-dim)';
                rating.style.background = 'rgba(255,255,255,0.05)';
                rating.style.padding = '1px 5px';
                rating.style.borderRadius = '3px';
                rating.innerHTML = `<i class="fas fa-comment-alt" style="font-size:0.6rem;"></i> ${formatMetric(guild.rating)}`;
                rating.title = `${guild.rating} messages in last 7 days`;
                roleRow.appendChild(rating);
            }

            info.appendChild(nameContainer);
            info.appendChild(roleRow);

            // Global Discovery or Invite badge
            if (guild.isGlobalDiscovery) {
                const badge = document.createElement('span');
                badge.className = 'server-card-invite-badge';
                badge.style.background = 'rgba(168, 85, 247, 0.15)'; // Purple-ish
                badge.style.color = '#a855f7';
                badge.style.border = '1px solid rgba(168, 85, 247, 0.3)';
                badge.innerHTML = '<i class="fas fa-globe"></i> global discovery';
                card.appendChild(iconWrap);
                card.appendChild(info);
                card.appendChild(badge);
            } else if (!botPresent) {
                const badge = document.createElement('span');
                badge.className = 'server-card-invite-badge';
                badge.innerHTML = '<i class="fas fa-plus"></i> invite';
                card.appendChild(iconWrap);
                card.appendChild(info);
                card.appendChild(badge);
            } else {
                // Arrow
                const arrow = document.createElement('i');
                arrow.className = 'fas fa-chevron-right server-card-arrow';
                card.appendChild(iconWrap);
                card.appendChild(info);
                card.appendChild(arrow);
            }

            frag.appendChild(card);
        }
        serverGrid.appendChild(frag);
    }

    /* ── Helpers ───────────────────────────────────────────── */
    function formatMetric(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'm';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return num.toString();
    }

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
