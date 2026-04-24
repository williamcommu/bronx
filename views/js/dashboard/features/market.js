// ============================================================
//  dashboard/features/market.js — Shop & Marketplace management
// ============================================================

import { formatNumber } from '../utils.js';

/**
 * Market/Shop feature mixin
 */
export const MarketMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupShopListeners() {
        document.getElementById('add-market-item')?.addEventListener('click', () => this.showAddMarketItemModal());
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadMarketData() {
        const items = await this.apiCall('/market/items');
        if (items) {
            this.updateMarketItemsTable(items);
        }
    },

    // ── Market Items Table ─────────────────────────────────────
    updateMarketItemsTable(items) {
        const table = document.getElementById('market-items-tbody');
        const empty = document.getElementById('market-empty');
        if (!table) return;
        if (!items || items.length === 0) {
            table.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        table.innerHTML = items.map(item => {
            let meta = {};
            try { meta = item.metadata ? JSON.parse(item.metadata) : {}; } catch {}
            const typeLabel = item.category === 'role' ? 'Role' : item.category === 'channel' ? 'Channel' : item.category;
            const stockLabel = item.max_quantity != null ? item.max_quantity : '∞';
            return `
            <tr data-market-id="${item.item_id}">
                <td style="font-family:monospace;font-size:0.78rem;">${item.item_id}</td>
                <td class="mkt-name">${item.name}</td>
                <td class="mkt-category">${typeLabel}</td>
                <td class="mkt-price">$${Number(item.price).toLocaleString()}</td>
                <td class="mkt-stock">${stockLabel}</td>
                <td class="mkt-desc" style="display:none;">${item.description || ''}</td>
                <td class="mkt-meta" style="display:none;">${JSON.stringify(meta)}</td>
                <td class="text-right">
                    <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();dashboard.editMarketItem('${item.item_id}')"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();dashboard.deleteMarketItem('${item.item_id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
    },

    // ── Add Market Item ────────────────────────────────────────
    showAddMarketItemModal() {
        this.showModal('Add Market Item', `
            <div class="form-field"><label>Item ID</label><input type="text" id="modal-mkt-id" placeholder="e.g. vip_role" class="input"></div>
            <div class="form-field"><label>Name</label><input type="text" id="modal-mkt-name" placeholder="Display Name" class="input"></div>
            <div class="form-field"><label>Description</label><textarea id="modal-mkt-desc" rows="2" placeholder="Item description..." class="input" style="resize:vertical;"></textarea></div>
            <div class="form-row">
                <div class="form-field"><label>Type</label><select id="modal-mkt-category" class="input"><option value="role">Role</option><option value="channel">Channel</option></select></div>
                <div class="form-field"><label>Price</label><input type="number" id="modal-mkt-price" min="1" class="input"></div>
            </div>
            <div class="form-row">
                <div class="form-field"><label>Target ID</label><input type="text" id="modal-mkt-target" placeholder="Role or Channel ID" class="input"></div>
                <div class="form-field"><label>Stock (blank = unlimited)</label><input type="number" id="modal-mkt-stock" min="1" class="input"></div>
            </div>
        `, () => this.submitMarketItem());
    },

    submitMarketItem() {
        const category = document.getElementById('modal-mkt-category').value;
        const targetId = document.getElementById('modal-mkt-target')?.value.trim();
        const stockVal = document.getElementById('modal-mkt-stock')?.value;
        const itemData = {
            item_id: document.getElementById('modal-mkt-id').value.trim(),
            name: document.getElementById('modal-mkt-name').value.trim(),
            description: document.getElementById('modal-mkt-desc').value.trim(),
            category,
            price: parseInt(document.getElementById('modal-mkt-price').value),
            max_quantity: stockVal ? parseInt(stockVal) : null,
            metadata: targetId ? { type: category, target_id: targetId } : null
        };
        if (!itemData.item_id || !itemData.name || !itemData.price) {
            this.toast('Item ID, Name, and Price are required', 'warning');
            return;
        }
        this.apiCall('/market/items', { method: 'POST', body: JSON.stringify(itemData) })
            .then(r => { if (r) { this.loadMarketData(); this.closeModal(); } });
    },

    // ── Edit Market Item ───────────────────────────────────────
    editMarketItem(itemId) {
        const row = document.querySelector(`tr[data-market-id="${itemId}"]`);
        if (!row) return;
        const name = row.querySelector('.mkt-name')?.textContent || '';
        const category = row.querySelector('.mkt-category')?.textContent?.toLowerCase() || 'role';
        const priceText = row.querySelector('.mkt-price')?.textContent || '0';
        const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
        const stock = row.querySelector('.mkt-stock')?.textContent;
        const stockVal = stock === '∞' ? '' : stock;
        const description = row.querySelector('.mkt-desc')?.textContent || '';
        let meta = {};
        try { meta = JSON.parse(row.querySelector('.mkt-meta')?.textContent || '{}'); } catch {}

        this.showModal(`Edit: ${itemId}`, `
            <div class="form-field"><label>Item ID</label><input type="text" value="${itemId}" disabled class="input" style="opacity:0.6;"></div>
            <div class="form-field"><label>Name</label><input type="text" id="modal-mkt-name" value="${name}" class="input"></div>
            <div class="form-field"><label>Description</label><textarea id="modal-mkt-desc" rows="2" class="input" style="resize:vertical;">${description}</textarea></div>
            <div class="form-row">
                <div class="form-field"><label>Type</label><select id="modal-mkt-category" class="input"><option value="role" ${category === 'role' ? 'selected' : ''}>Role</option><option value="channel" ${category === 'channel' ? 'selected' : ''}>Channel</option></select></div>
                <div class="form-field"><label>Price</label><input type="number" id="modal-mkt-price" min="1" value="${price}" class="input"></div>
            </div>
            <div class="form-row">
                <div class="form-field"><label>Target ID</label><input type="text" id="modal-mkt-target" value="${meta.target_id || ''}" class="input"></div>
                <div class="form-field"><label>Stock (blank = unlimited)</label><input type="number" id="modal-mkt-stock" min="1" value="${stockVal}" class="input"></div>
            </div>
        `, async () => {
            const newCategory = document.getElementById('modal-mkt-category')?.value;
            const newTarget = document.getElementById('modal-mkt-target')?.value.trim();
            const newStockVal = document.getElementById('modal-mkt-stock')?.value;
            const body = {
                name: document.getElementById('modal-mkt-name')?.value.trim(),
                description: document.getElementById('modal-mkt-desc')?.value.trim(),
                category: newCategory,
                price: parseInt(document.getElementById('modal-mkt-price')?.value),
                max_quantity: newStockVal ? parseInt(newStockVal) : null,
                metadata: newTarget ? { type: newCategory, target_id: newTarget } : null
            };
            if (!body.name || !body.price) { this.toast('Name and Price required', 'warning'); return; }
            await this.apiCall(`/market/items/${encodeURIComponent(itemId)}`, {
                method: 'PUT', body: JSON.stringify(body)
            });
            this.closeModal();
            this.loadMarketData();
        });
    },

    // ── Delete Market Item ─────────────────────────────────────
    async deleteMarketItem(itemId) {
        if (!confirm(`Delete market item "${itemId}"?`)) return;
        await this.apiCall(`/market/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        this.loadMarketData();
    }
};
