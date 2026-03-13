/* ============================================================
   bronx · owner dashboard — client logic
   ============================================================ */
(function () {
    'use strict';

    /* ── State ────────────────────────────────────────────── */
    let csrfToken = null;
    let currentTab = 'overview';
    let commandChart = null;
    let priceChart = null;

    /* ── Boot ─────────────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        try {
            const [authData] = await Promise.all([
                fetchJSON('/api/auth/user'),
                loadCsrfToken()
            ]);

            if (!authData.authenticated || !authData.isBotOwner) {
                window.location.href = '/servers';
                return;
            }

            populateUserChip(authData.user);
            hide('loading-state');
            showTab('overview');
            setupTabs();
            setupListeners();
            loadOverview();
        } catch (err) {
            console.error('Owner init error:', err);
            window.location.href = '/servers';
        }
    }

    /* ── CSRF ─────────────────────────────────────────────── */
    async function loadCsrfToken() {
        try {
            const data = await fetchJSON('/api/csrf-token');
            csrfToken = data.csrfToken;
        } catch { /* non-fatal */ }
    }

    /* ── User chip ─────────────────────────────────────────── */
    function populateUserChip(user) {
        const chip = document.getElementById('user-chip');
        const avatar = document.getElementById('user-avatar');
        const name = document.getElementById('user-name');
        if (!chip) return;
        avatar.src = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;
        name.textContent = user.global_name || user.username;
        chip.style.display = 'flex';
    }

    /* ── Tabs ──────────────────────────────────────────────── */
    function setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => showTab(btn.dataset.tab));
        });
    }

    function showTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));

        // Lazy-load tab data
        const loaders = {
            overview: loadOverview,
            users: () => {},           // user-initiated search
            shop: loadShopData,
            ml: loadMLSettings,
            lists: loadLists,
            economy: loadEconomySettings
        };
        (loaders[tab] || (() => {}))();
    }

    /* ── Setup Listeners ──────────────────────────────────── */
    function setupListeners() {
        // Overview
        on('refresh-suggestions', 'click', loadSuggestions);

        // Users
        on('search-users-btn', 'click', searchUsers);
        document.getElementById('user-search-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') searchUsers();
        });
        on('grant-badge', 'click', () => manageBadge('grant'));
        on('revoke-badge', 'click', () => manageBadge('revoke'));

        // ML
        on('add-ml-setting', 'click', addMLSetting);

        // Lists
        on('add-bl', 'click', () => addListEntry('blacklist'));
        on('add-wl', 'click', () => addListEntry('whitelist'));

        // Shop
        on('add-shop-item', 'click', showAddShopItemModal);
        on('add-daily-deal', 'click', addDailyDeal);
        on('add-rod-btn', 'click', () => showAddGearModal('rod'));
        on('add-bait-btn', 'click', () => showAddGearModal('bait'));

        // Economy
        on('save-economy-settings', 'click', saveEconomySettings);
        on('adjust-balance-btn', 'click', adjustGuildBalance);
    }

    /* ============================================================
       Overview Tab
       ============================================================ */
    async function loadOverview() {
        try {
            const [stats, commands] = await Promise.all([
                loadGlobalStats(),
                loadGlobalCommands()
            ]);
            renderCommandChart(commands);
            loadSuggestions();
        } catch (err) {
            console.error('Overview load error:', err);
        }
    }

    async function loadGlobalStats() {
        try {
            // Fetch aggregate stats — no guild context
            const data = await fetchJSON('/api/stats/overview');
            setTextById('stat-guilds', fmt(data.memberCount || 0));
            setTextById('stat-commands', fmt(data.commandsToday || 0));
            setTextById('stat-economy', '$' + fmt(data.totalEconomyValue || 0));

            // Try to count distinct guilds from the database
            try {
                const guilds = await fetchJSON('/api/auth/guilds');
                setTextById('stat-guilds', fmt(guilds.length || 0));
            } catch { /* keep previous value */ }

            // Users stat from a simple count
            try {
                const users = await fetchJSON('/api/users/search?q=0', { headers: { 'X-Guild-ID': 'global' } });
                setTextById('stat-users', fmt(Array.isArray(users) ? users.length : 0));
            } catch {
                setTextById('stat-users', '—');
            }
        } catch (err) {
            console.error('Global stats error:', err);
        }
    }

    async function loadGlobalCommands() {
        try {
            const data = await fetchJSON('/api/commands');
            if (!data || !Array.isArray(data)) return [];
            // Group by category and count
            const cats = {};
            data.forEach(cmd => {
                const cat = cmd.category || 'general';
                cats[cat] = (cats[cat] || 0) + 1;
            });
            return Object.entries(cats).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
        } catch {
            return [];
        }
    }

    function renderCommandChart(commands) {
        const ctx = document.getElementById('global-command-chart');
        if (!ctx) return;

        if (commandChart) commandChart.destroy();

        const labels = commands.map(c => c.name);
        const values = commands.map(c => c.count);

        commandChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'commands',
                    data: values,
                    backgroundColor: 'rgba(180,167,214,0.3)',
                    borderColor: '#b4a7d6',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: '#e4e4e7', font: { size: 11 } }, grid: { display: false } }
                }
            }
        });
    }

    async function loadSuggestions() {
        const list = document.getElementById('suggestions-list');
        if (!list) return;
        list.innerHTML = '<p class="text-muted">loading...</p>';

        try {
            const data = await fetchJSON('/api/suggestions');
            if (!data || !data.length) {
                list.innerHTML = '<p class="text-muted">no suggestions yet</p>';
                return;
            }
            list.innerHTML = data.map(s => `
                <div class="item-row">
                    <div>
                        <strong style="font-size:0.82rem;">${esc(s.content || s.suggestion || '(empty)')}</strong>
                        <div class="text-muted" style="font-size:0.72rem;">user ${esc(s.user_id)} · ${timeAgo(s.submitted_at || s.created_at)}</div>
                    </div>
                </div>
            `).join('');
        } catch {
            list.innerHTML = '<p class="text-muted">failed to load suggestions</p>';
        }
    }

    /* ============================================================
       Users Tab
       ============================================================ */
    async function searchUsers() {
        const q = document.getElementById('user-search-input')?.value?.trim();
        const results = document.getElementById('user-search-results');
        if (!q || !results) return;

        results.innerHTML = '<p class="text-muted">searching...</p>';

        try {
            // Search globally — send no guild header so it falls through to global
            const data = await fetchJSON(`/api/users/search?q=${encodeURIComponent(q)}`);

            if (!data || data.error || !Array.isArray(data) || !data.length) {
                results.innerHTML = '<p class="text-muted">no users found</p>';
                return;
            }

            results.innerHTML = data.map(u => `
                <div class="item-row">
                    <div>
                        <strong style="font-size:0.82rem;">${esc(u.user_id)}</strong>
                        <span class="text-muted" style="font-size:0.72rem; margin-left: 0.5rem;">
                            guild ${esc(u.guild_id)} · $${fmt(u.wallet + u.bank)} net
                        </span>
                    </div>
                    <div class="text-muted" style="font-size:0.72rem;">
                        ${u.commands_used || 0} cmds · last active ${timeAgo(u.last_active)}
                    </div>
                </div>
            `).join('');
        } catch (err) {
            results.innerHTML = '<p class="text-muted">search failed</p>';
            console.error('User search error:', err);
        }
    }

    async function manageBadge(action) {
        const userId = document.getElementById('badge-user-id')?.value?.trim();
        const type = document.getElementById('badge-type')?.value;
        if (!userId) return toast('enter a user ID', 'error');

        try {
            const body = { user_id: userId, badge_type: type, action };
            await postJSON('/api/users/badge', body);
            toast(`badge ${action}ed for ${userId}`, 'success');
            document.getElementById('badge-user-id').value = '';
        } catch (err) {
            toast(`failed to ${action} badge`, 'error');
        }
    }

    /* ============================================================
       ML Config Tab
       ============================================================ */
    async function loadMLSettings() {
        const list = document.getElementById('ml-settings-list');
        if (!list) return;
        list.innerHTML = '<p class="text-muted">loading...</p>';

        try {
            const data = await fetchJSON('/api/ml/settings');
            if (!data || !Object.keys(data).length) {
                list.innerHTML = '<p class="text-muted">no ML settings configured</p>';
                return;
            }

            list.innerHTML = Object.entries(data).map(([key, value]) => `
                <div class="item-row" data-key="${esc(key)}">
                    <div>
                        <strong style="font-size:0.82rem;">${esc(key)}</strong>
                        <span class="text-muted" style="font-size:0.72rem; margin-left: 0.5rem;">${esc(String(value))}</span>
                    </div>
                    <div style="display: flex; gap: 0.35rem;">
                        <button class="btn btn-outline btn-xs ml-edit" data-key="${esc(key)}" data-value="${esc(String(value))}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-danger btn-xs ml-delete" data-key="${esc(key)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            // Bind edit/delete
            list.querySelectorAll('.ml-edit').forEach(btn => {
                btn.addEventListener('click', () => editMLSetting(btn.dataset.key, btn.dataset.value));
            });
            list.querySelectorAll('.ml-delete').forEach(btn => {
                btn.addEventListener('click', () => deleteMLSetting(btn.dataset.key));
            });
        } catch {
            list.innerHTML = '<p class="text-muted">failed to load ML settings</p>';
        }

        loadPriceChart();
    }

    async function addMLSetting() {
        const key = prompt('Setting key:');
        if (!key) return;
        const value = prompt('Setting value:');
        if (value === null) return;

        try {
            await postJSON('/api/ml/settings', { key, value });
            toast('ML setting added', 'success');
            loadMLSettings();
        } catch {
            toast('failed to add ML setting', 'error');
        }
    }

    async function editMLSetting(key, currentValue) {
        const newValue = prompt(`Edit "${key}":`, currentValue);
        if (newValue === null || newValue === currentValue) return;

        try {
            await postJSON('/api/ml/settings', { key, value: newValue });
            toast('ML setting updated', 'success');
            loadMLSettings();
        } catch {
            toast('failed to update ML setting', 'error');
        }
    }

    async function deleteMLSetting(key) {
        if (!confirm(`Delete ML setting "${key}"?`)) return;

        try {
            await deleteJSON(`/api/ml/settings/${encodeURIComponent(key)}`);
            toast('ML setting deleted', 'success');
            loadMLSettings();
        } catch {
            toast('failed to delete ML setting', 'error');
        }
    }

    async function loadPriceChart() {
        const ctx = document.getElementById('price-changes-chart');
        if (!ctx) return;

        // Attempt to fetch bazaar price stats for chart
        try {
            const data = await fetchJSON('/api/bazaar/stats');
            if (priceChart) priceChart.destroy();

            if (!data || !data.length) {
                // No data — render an empty placeholder
                priceChart = new Chart(ctx, {
                    type: 'line',
                    data: { labels: ['no data'], datasets: [{ data: [0], borderColor: '#b4a7d6' }] },
                    options: { responsive: true, plugins: { legend: { display: false } } }
                });
                return;
            }

            const labels = data.map(d => d.item_name || d.name || d.id);
            const values = data.map(d => d.avg_price || d.price || 0);

            priceChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'avg price',
                        data: values,
                        borderColor: '#b4a7d6',
                        backgroundColor: 'rgba(180,167,214,0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.04)' } },
                        y: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.04)' } }
                    }
                }
            });
        } catch {
            // Silently fail — chart stays empty
        }
    }

    /* ============================================================
       Lists Tab (Blacklist / Whitelist)
       ============================================================ */
    async function loadLists() {
        await Promise.all([loadList('blacklist'), loadList('whitelist')]);
    }

    async function loadList(type) {
        const list = document.getElementById(`${type}-list`);
        if (!list) return;
        list.innerHTML = '<p class="text-muted">loading...</p>';

        try {
            const data = await fetchJSON(`/api/moderation/${type}`);
            if (!data || !data.length) {
                list.innerHTML = `<p class="text-muted">no ${type}ed users</p>`;
                return;
            }

            list.innerHTML = data.map(item => `
                <div class="item-row">
                    <div>
                        <strong style="font-size:0.82rem;">${esc(item.user_id)}</strong>
                        ${item.reason ? `<span class="text-muted" style="font-size:0.72rem; margin-left: 0.5rem;">${esc(item.reason)}</span>` : ''}
                    </div>
                    <button class="btn btn-danger btn-xs list-remove" data-type="${type}" data-id="${esc(item.user_id)}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');

            list.querySelectorAll('.list-remove').forEach(btn => {
                btn.addEventListener('click', () => removeListEntry(btn.dataset.type, btn.dataset.id));
            });
        } catch {
            list.innerHTML = `<p class="text-muted">failed to load ${type}</p>`;
        }
    }

    async function addListEntry(type) {
        const prefix = type === 'blacklist' ? 'bl' : 'wl';
        const userId = document.getElementById(`${prefix}-user-id`)?.value?.trim();
        const reason = document.getElementById(`${prefix}-reason`)?.value?.trim();
        if (!userId) return toast('enter a user ID', 'error');

        try {
            await postJSON(`/api/moderation/${type}`, { user_id: userId, reason });
            toast(`added to ${type}`, 'success');
            document.getElementById(`${prefix}-user-id`).value = '';
            document.getElementById(`${prefix}-reason`).value = '';
            loadList(type);
        } catch {
            toast(`failed to add to ${type}`, 'error');
        }
    }

    async function removeListEntry(type, userId) {
        if (!confirm(`Remove ${userId} from ${type}?`)) return;

        try {
            await deleteJSON(`/api/moderation/${type}/${encodeURIComponent(userId)}`);
            toast(`removed from ${type}`, 'success');
            loadList(type);
        } catch {
            toast(`failed to remove from ${type}`, 'error');
        }
    }

    /* ============================================================
       Shop Tab (Global Shop Items)
       ============================================================ */
    async function loadShopData() {
        try {
            const [items, deals, bazaar, gear] = await Promise.all([
                fetchJSON('/api/shop/items'),
                fetchJSON('/api/shop/daily-deals'),
                fetchJSON('/api/bazaar/stats'),
                fetchJSON('/api/fishing/gear')
            ]);

            updateShopItemsTable(items);
            populateDealDropdown(items);
            updateDailyDealsList(deals);
            updateBazaarStats(bazaar);
            if (gear) {
                renderGearList('rods-list', gear.rods || [], 'rod');
                renderGearList('bait-list', gear.bait || [], 'bait');
            }
        } catch (err) {
            console.error('Shop data load error:', err);
        }
    }

    function updateShopItemsTable(items) {
        const tbody = document.getElementById('shop-items-tbody');
        const empty = document.getElementById('shop-items-empty');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = items.map(item => `
            <tr data-item-id="${item.item_id}">
                <td style="font-family:monospace;font-size:0.78rem;">${item.item_id}</td>
                <td class="shop-item-name">${item.name}</td>
                <td class="shop-item-category">${item.category}</td>
                <td class="shop-item-price" style="color:var(--accent);font-weight:600;">$${Number(item.price).toLocaleString()}</td>
                <td class="shop-item-level">${item.level || 1}</td>
                <td class="shop-item-desc" style="display:none;">${item.description || ''}</td>
                <td class="shop-item-maxqty" style="display:none;">${item.max_quantity || 1}</td>
                <td style="text-align:right;">
                    <button class="btn btn-ghost btn-xs" onclick="window.editShopItem('${item.item_id}')"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="window.deleteShopItem('${item.item_id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }

    function populateDealDropdown(items) {
        const sel = document.getElementById('deal-item-select');
        if (!sel || !items) return;
        sel.innerHTML = '<option value="">select item...</option>' +
            items.map(i => `<option value="${i.item_id}">${i.name} ($${Number(i.price).toLocaleString()})</option>`).join('');
    }

    function showAddShopItemModal() {
        showModal('Add Shop Item', `
            <div class="form-field"><label>Item ID</label><input type="text" id="modal-item-id" placeholder="unique_item_id" class="input"></div>
            <div class="form-field"><label>Item Name</label><input type="text" id="modal-item-name" placeholder="Display Name" class="input"></div>
            <div class="form-field"><label>Description</label><textarea id="modal-item-desc" rows="2" placeholder="Item description..." class="input" style="resize:vertical;"></textarea></div>
            <div class="form-row">
                <div class="form-field"><label>Category</label><select id="modal-item-category" class="input"><option value="potion">Potion</option><option value="upgrade">Upgrade</option><option value="rod">Rod</option><option value="bait">Bait</option><option value="collectible">Collectible</option><option value="other">Other</option></select></div>
                <div class="form-field"><label>Price</label><input type="number" id="modal-item-price" min="1" class="input"></div>
            </div>
            <div class="form-row">
                <div class="form-field"><label>Level</label><input type="number" id="modal-item-level" min="1" value="1" class="input"></div>
                <div class="form-field"><label>Max Quantity</label><input type="number" id="modal-item-max-qty" class="input"></div>
            </div>
        `, async () => {
            const data = {
                item_id: document.getElementById('modal-item-id')?.value.trim(),
                name: document.getElementById('modal-item-name')?.value.trim(),
                description: document.getElementById('modal-item-desc')?.value.trim(),
                category: document.getElementById('modal-item-category')?.value,
                price: parseInt(document.getElementById('modal-item-price')?.value),
                level: parseInt(document.getElementById('modal-item-level')?.value) || 1,
                max_quantity: document.getElementById('modal-item-max-qty')?.value ? parseInt(document.getElementById('modal-item-max-qty').value) : null
            };
            if (!data.item_id || !data.name || !data.price) return toast('ID, name, and price required', 'error');
            await postJSON('/api/shop/items', data);
            closeModal();
            loadShopData();
            toast('shop item added', 'success');
        });
    }

    window.editShopItem = function(itemId) {
        const row = document.querySelector(`tr[data-item-id="${itemId}"]`);
        if (!row) return;
        const name = row.querySelector('.shop-item-name')?.textContent || '';
        const cat = row.querySelector('.shop-item-category')?.textContent || 'other';
        const priceText = row.querySelector('.shop-item-price')?.textContent || '0';
        const price = parseInt(priceText.replace(/[^0-9]/g,'')) || 0;
        const level = row.querySelector('.shop-item-level')?.textContent || '1';
        const desc = row.querySelector('.shop-item-desc')?.textContent || '';
        const maxQty = row.querySelector('.shop-item-maxqty')?.textContent || '1';

        showModal(`Edit: ${itemId}`, `
            <div class="form-field"><label>Item ID</label><input type="text" value="${itemId}" disabled class="input" style="opacity:0.6;"></div>
            <div class="form-field"><label>Name</label><input type="text" id="modal-item-name" value="${name}" class="input"></div>
            <div class="form-field"><label>Description</label><textarea id="modal-item-desc" rows="2" class="input" style="resize:vertical;">${desc}</textarea></div>
            <div class="form-row">
                <div class="form-field"><label>Category</label><select id="modal-item-category" class="input">${['potion','upgrade','rod','bait','collectible','other'].map(c => `<option value="${c}" ${c === cat ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}</select></div>
                <div class="form-field"><label>Price</label><input type="number" id="modal-item-price" min="1" value="${price}" class="input"></div>
            </div>
            <div class="form-row">
                <div class="form-field"><label>Level</label><input type="number" id="modal-item-level" min="1" value="${level}" class="input"></div>
                <div class="form-field"><label>Max Qty</label><input type="number" id="modal-item-maxqty" min="1" value="${maxQty}" class="input"></div>
            </div>
        `, async () => {
            const data = {
                name: document.getElementById('modal-item-name')?.value.trim(),
                description: document.getElementById('modal-item-desc')?.value.trim(),
                category: document.getElementById('modal-item-category')?.value,
                price: parseInt(document.getElementById('modal-item-price')?.value),
                level: parseInt(document.getElementById('modal-item-level')?.value) || 1,
                max_quantity: parseInt(document.getElementById('modal-item-maxqty')?.value) || 1
            };
            if (!data.name || !data.price) return toast('Name and price required', 'error');
            await putJSON(`/api/shop/items/${encodeURIComponent(itemId)}`, data);
            closeModal();
            loadShopData();
            toast('shop item updated', 'success');
        });
    };

    window.deleteShopItem = async function(itemId) {
        if (!confirm(`Delete shop item "${itemId}"?`)) return;
        try {
            await deleteJSON(`/api/shop/items/${encodeURIComponent(itemId)}`);
            loadShopData();
            toast('shop item deleted', 'success');
        } catch { toast('failed to delete', 'error'); }
    };

    function updateDailyDealsList(deals) {
        const list = document.getElementById('daily-deals-list');
        if (!list) return;
        if (!deals || !deals.length) {
            list.innerHTML = '<p class="text-muted">no daily deals configured</p>';
            return;
        }
        list.innerHTML = deals.map(d => `
            <div class="item-row">
                <div style="display:flex;align-items:center;gap:0.6rem;">
                    <span style="font-family:monospace;font-size:0.78rem;">${d.item_id}</span>
                    <span style="color:var(--accent);font-weight:600;">${d.discount}% off</span>
                    ${d.stock ? `<span style="font-size:0.72rem;color:var(--fg-dim);">Stock: ${d.stock}</span>` : ''}
                </div>
                <button class="btn btn-danger btn-xs" onclick="window.deleteDailyDeal('${d.id || d.item_id}')"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');
    }

    async function addDailyDeal() {
        const item_id = document.getElementById('deal-item-select')?.value;
        const discount = parseInt(document.getElementById('deal-discount')?.value);
        const stockVal = document.getElementById('deal-stock')?.value;
        const stock = stockVal ? parseInt(stockVal) : null;
        if (!item_id || !discount) return toast('Select item and discount %', 'error');
        try {
            await postJSON('/api/shop/daily-deals', { item_id, discount, stock });
            loadShopData();
            toast('daily deal added', 'success');
        } catch { toast('failed to add deal', 'error'); }
    }

    window.deleteDailyDeal = async function(id) {
        if (!confirm('Delete this daily deal?')) return;
        try {
            await deleteJSON(`/api/shop/daily-deals/${encodeURIComponent(id)}`);
            loadShopData();
            toast('deal deleted', 'success');
        } catch { toast('failed to delete', 'error'); }
    };

    function updateBazaarStats(stats) {
        if (!stats) return;
        setTextById('total-shareholders', fmt(stats.shareholders || 0));
        setTextById('total-shares', fmt(stats.shares || stats.stock || 0));
        setTextById('recent-visitors', fmt(stats.visitors || 0));
    }

    /* ── Fishing Gear (Owner) ─────────────────────────────── */
    function renderGearList(listId, items, type) {
        const list = document.getElementById(listId);
        if (!list) return;
        if (!items || items.length === 0) {
            list.innerHTML = `<p class="text-muted">no ${type === 'rod' ? 'rods' : 'bait'} configured</p>`;
            return;
        }
        list.innerHTML = items.map(item => `
            <div class="gear-card" data-item-id="${item.item_id}">
                <div class="gear-card-info">
                    <span class="gear-card-name">${item.name}</span>
                    <span class="gear-card-desc">${item.description || `Lv.${item.level}`} · <span style="color:var(--accent);">$${fmt(item.price)}</span></span>
                </div>
                <div style="display:flex;gap:0.3rem;">
                    <button class="btn btn-ghost btn-xs" onclick="window.editGearItem('${item.item_id}', '${type}')"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="window.deleteGearItem('${item.item_id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    }

    function showAddGearModal(type) {
        const label = type === 'rod' ? 'Rod' : 'Bait';
        showModal(`Add ${label}`, `
            <div class="form-field"><label>Item ID</label><input type="text" id="modal-gear-id" placeholder="${type}_custom" class="input"></div>
            <div class="form-field"><label>Name</label><input type="text" id="modal-gear-name" placeholder="Display Name" class="input"></div>
            <div class="form-field"><label>Description</label><input type="text" id="modal-gear-desc" placeholder="Short description" class="input"></div>
            <div class="form-row">
                <div class="form-field"><label>Price</label><input type="number" id="modal-gear-price" min="1" value="500" class="input"></div>
                <div class="form-field"><label>Level</label><input type="number" id="modal-gear-level" min="1" max="10" value="1" class="input"></div>
            </div>
        `, async () => {
            const item_id = document.getElementById('modal-gear-id')?.value.trim();
            const name = document.getElementById('modal-gear-name')?.value.trim();
            const description = document.getElementById('modal-gear-desc')?.value.trim();
            const price = parseInt(document.getElementById('modal-gear-price')?.value);
            const level = parseInt(document.getElementById('modal-gear-level')?.value) || 1;
            if (!item_id || !name || !price) return toast('ID, name, and price required', 'error');
            await postJSON('/api/fishing/gear', { item_id, name, description, category: type, price, level, max_quantity: 1 });
            closeModal();
            loadShopData();
            toast(`${label} added`, 'success');
        });
    }

    window.editGearItem = function(itemId, type) {
        const card = document.querySelector(`.gear-card[data-item-id="${itemId}"]`);
        if (!card) return;
        const name = card.querySelector('.gear-card-name')?.textContent || '';
        const descSpan = card.querySelector('.gear-card-desc')?.textContent || '';
        const descMatch = descSpan.match(/^(.+?)\s·/) || ['', ''];
        const desc = descMatch[1]?.startsWith('Lv.') ? '' : descMatch[1];
        const levelMatch = descSpan.match(/Lv\.(\d+)/);
        const level = levelMatch ? levelMatch[1] : '1';
        const priceMatch = descSpan.match(/\$([0-9,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
        const label = type === 'rod' ? 'Rod' : 'Bait';

        showModal(`Edit ${label}: ${name}`, `
            <div class="form-field"><label>Name</label><input type="text" id="modal-gear-name" value="${name}" class="input"></div>
            <div class="form-field"><label>Description</label><input type="text" id="modal-gear-desc" value="${desc}" class="input"></div>
            <div class="form-row">
                <div class="form-field"><label>Price</label><input type="number" id="modal-gear-price" min="1" value="${price}" class="input"></div>
                <div class="form-field"><label>Level</label><input type="number" id="modal-gear-level" min="1" max="10" value="${level}" class="input"></div>
            </div>
        `, async () => {
            const data = {
                name: document.getElementById('modal-gear-name')?.value.trim(),
                description: document.getElementById('modal-gear-desc')?.value.trim(),
                price: parseInt(document.getElementById('modal-gear-price')?.value),
                level: parseInt(document.getElementById('modal-gear-level')?.value) || 1,
                max_quantity: 1
            };
            if (!data.name || !data.price) return toast('Name and price required', 'error');
            await putJSON(`/api/fishing/gear/${encodeURIComponent(itemId)}`, data);
            closeModal();
            loadShopData();
            toast(`${label} updated`, 'success');
        });
    };

    window.deleteGearItem = async function(itemId) {
        if (!confirm(`Delete "${itemId}" from fishing gear?`)) return;
        try {
            await deleteJSON(`/api/fishing/gear/${encodeURIComponent(itemId)}`);
            loadShopData();
            toast('gear deleted', 'success');
        } catch { toast('failed to delete', 'error'); }
    };

    /* ============================================================
       Economy Tab
       ============================================================ */
    async function loadEconomySettings() {
        try {
            const data = await fetchJSON('/api/economy/interest-settings');
            if (data) {
                setValue('global-interest-rate', (data.interest_rate || 0.02) * 100);
                setValue('global-interest-interval', data.interest_interval_hours || 24);
                setValue('global-max-interest', data.max_bank_interest || 1000000);
            }
        } catch {
            // Defaults remain
        }

        // Load economy mode
        try {
            const mode = await fetchJSON('/api/economy/mode');
            if (mode?.economy_mode) {
                setValue('default-economy-mode', mode.economy_mode);
            }
        } catch { /* keep default */ }
    }

    async function saveEconomySettings() {
        try {
            const rate = parseFloat(document.getElementById('global-interest-rate')?.value) / 100;
            const interval = parseInt(document.getElementById('global-interest-interval')?.value);
            const max = parseInt(document.getElementById('global-max-interest')?.value);
            const mode = document.getElementById('default-economy-mode')?.value;

            // Save interest settings
            await Promise.all([
                postJSON('/api/economy/interest-settings', { key: 'interest_rate', value: String(rate) }),
                postJSON('/api/economy/interest-settings', { key: 'interest_interval_hours', value: String(interval) }),
                postJSON('/api/economy/interest-settings', { key: 'max_bank_interest', value: String(max) }),
                postJSON('/api/economy/interest-settings', { key: 'economy_mode', value: mode })
            ]);

            toast('economy settings saved', 'success');
        } catch {
            toast('failed to save economy settings', 'error');
        }
    }

    async function adjustGuildBalance() {
        const guildId = document.getElementById('adjust-guild-id')?.value?.trim();
        const amount = parseFloat(document.getElementById('adjust-amount')?.value);
        const reason = document.getElementById('adjust-reason')?.value?.trim();

        if (!guildId) return toast('enter a guild ID', 'error');
        if (isNaN(amount) || amount === 0) return toast('enter a valid amount', 'error');

        try {
            await postJSON('/api/economy/guild-balance/adjust', { adjustment: amount, reason }, { 'X-Guild-ID': guildId });
            toast(`adjusted guild balance by $${fmt(amount)}`, 'success');
            document.getElementById('adjust-guild-id').value = '';
            document.getElementById('adjust-amount').value = '';
            document.getElementById('adjust-reason').value = '';
        } catch {
            toast('failed to adjust balance', 'error');
        }
    }

    /* ============================================================
       Fetch Helpers
       ============================================================ */
    async function fetchJSON(url, opts = {}) {
        const res = await fetch(url, { credentials: 'include', ...opts });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function postJSON(url, body, extraHeaders = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...extraHeaders
        };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            // If CSRF expired, refresh and retry once
            if (res.status === 403) {
                await loadCsrfToken();
                headers['X-CSRF-Token'] = csrfToken;
                const retry = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    headers,
                    body: JSON.stringify(body)
                });
                if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
                return retry.json();
            }
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    }

    async function deleteJSON(url, extraHeaders = {}) {
        const headers = { ...extraHeaders };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const res = await fetch(url, {
            method: 'DELETE',
            credentials: 'include',
            headers
        });
        if (!res.ok) {
            if (res.status === 403) {
                await loadCsrfToken();
                headers['X-CSRF-Token'] = csrfToken;
                const retry = await fetch(url, {
                    method: 'DELETE',
                    credentials: 'include',
                    headers
                });
                if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
                return retry.json();
            }
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    }

    async function putJSON(url, body, extraHeaders = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...extraHeaders
        };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const res = await fetch(url, {
            method: 'PUT',
            credentials: 'include',
            headers,
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            if (res.status === 403) {
                await loadCsrfToken();
                headers['X-CSRF-Token'] = csrfToken;
                const retry = await fetch(url, {
                    method: 'PUT',
                    credentials: 'include',
                    headers,
                    body: JSON.stringify(body)
                });
                if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
                return retry.json();
            }
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    }

    /* ============================================================
       Modal Helpers
       ============================================================ */
    let activeModal = null;

    function showModal(title, content, onConfirm) {
        closeModal();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.6);
            display: flex; align-items: center; justify-content: center;
            z-index: 9999; animation: fadeIn 0.15s ease;
        `;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.cssText = `
            background: var(--bg-raised); border: 1px solid var(--border);
            border-radius: var(--radius); padding: 1.25rem;
            min-width: 340px; max-width: 500px; max-height: 80vh; overflow-y: auto;
        `;

        modal.innerHTML = `
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h3 style="font-size:1rem;font-weight:600;">${title}</h3>
                <button class="modal-close btn btn-ghost btn-xs" style="font-size:1rem;">&times;</button>
            </div>
            <div class="modal-body">${content}</div>
            ${onConfirm ? `
            <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;">
                <button class="modal-cancel btn btn-outline btn-sm">Cancel</button>
                <button class="modal-confirm btn btn-primary btn-sm">Confirm</button>
            </div>` : ''}
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        activeModal = overlay;

        overlay.querySelector('.modal-close')?.addEventListener('click', closeModal);
        overlay.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
        overlay.querySelector('.modal-confirm')?.addEventListener('click', () => onConfirm?.());
        overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    }

    function closeModal() {
        if (activeModal) {
            activeModal.remove();
            activeModal = null;
        }
    }

    /* ============================================================
       Utilities
       ============================================================ */
    function on(id, event, fn) {
        document.getElementById(id)?.addEventListener(event, fn);
    }

    function hide(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    function setTextById(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setValue(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    function fmt(n) {
        return Number(n).toLocaleString();
    }

    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function timeAgo(date) {
        if (!date) return 'unknown';
        const diff = Date.now() - new Date(date).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }

    /* ── Toast ─────────────────────────────────────────────── */
    function toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const el = document.createElement('div');
        el.style.cssText = `
            padding: 0.6rem 1rem;
            border-radius: 0.5rem;
            font-size: 0.82rem;
            font-family: inherit;
            color: #e4e4e7;
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.08);
            animation: fadeIn 0.2s ease;
        `;
        const colors = {
            success: 'rgba(16,185,129,0.15)',
            error: 'rgba(239,68,68,0.15)',
            info: 'rgba(180,167,214,0.15)'
        };
        el.style.background = colors[type] || colors.info;
        el.textContent = message;
        container.appendChild(el);

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.2s';
            setTimeout(() => el.remove(), 200);
        }, 3000);
    }

})();
