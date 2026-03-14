// ============================================================
//  dashboard/features/giveaways.js — Giveaway management
// ============================================================

import { timeAgo } from '../utils.js';

/**
 * Giveaways feature mixin
 */
export const GiveawaysMixin = {
    // ── Event Listeners ────────────────────────────────────────
    setupGiveawayListeners() {
        document.getElementById('create-giveaway')?.addEventListener('click', () => this.createGiveaway());
        document.getElementById('load-giveaway-history')?.addEventListener('click', () => this.loadGiveawayHistory());
    },

    // ── Populate Create Form Channel Select ────────────────────
    async populateGiveawayChannelSelect() {
        const select = document.getElementById('giveaway-channel');
        if (!select || !this.selectManager) return;
        const channels = await this.selectManager.fetchChannels();
        // Keep the first placeholder option, replace the rest
        select.innerHTML = '<option value="">select channel...</option>';
        (channels || []).forEach(ch => {
            const opt = document.createElement('option');
            opt.value = ch.id;
            opt.textContent = `#${ch.name}`;
            select.appendChild(opt);
        });
    },

    // ── Data Loading ───────────────────────────────────────────
    async loadGiveawaysData() {
        // Populate the create form channel dropdown with real channels
        await this.populateGiveawayChannelSelect();

        const data = await this.apiCall('/giveaways/active');
        const list = document.getElementById('active-giveaways');
        if (!list) return;
        if (!data || !data.length) {
            list.innerHTML = '<p style="color:var(--fg-dim);">No active giveaways</p>';
            return;
        }
        list.innerHTML = data.map(g => {
            const channelDisplay = g.channel_name || (g.channel_id ? `#${g.channel_id}` : '');
            const creatorDisplay = g.created_by_name || '';
            return `
            <div class="item-row" style="cursor:pointer;flex-wrap:wrap;gap:0.5rem;" onclick="dashboard.editGiveaway(${g.id}, ${g.prize}, ${g.winner_count || 1}, '${g.ends_at}', '${g.channel_id || ''}')">
                <div style="display:flex;align-items:center;gap:0.75rem;flex:1;">
                    <strong style="color:var(--accent);">$${Number(g.prize).toLocaleString()}</strong>
                    <span style="color:var(--fg-dim);font-size:0.78rem;">${g.winner_count || 1} winner(s)</span>
                    ${channelDisplay ? `<span style="font-size:0.72rem;padding:2px 6px;border-radius:100px;background:rgba(180,167,214,0.1);color:var(--fg-dim);">${channelDisplay}</span>` : ''}
                    ${creatorDisplay ? `<span style="font-size:0.68rem;color:var(--fg-dim);">by ${creatorDisplay}</span>` : ''}
                    <span style="color:var(--fg-dim);font-size:0.72rem;">Ends: ${new Date(g.ends_at).toLocaleString()}</span>
                </div>
                <div style="display:flex;gap:0.4rem;">
                    <span style="font-size:0.68rem;padding:2px 6px;border-radius:100px;background:var(--accent-glow);color:var(--accent);">${g.participants || 0} entries</span>
                    <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();dashboard.endGiveaway(${g.id})" title="End Early"><i class="fas fa-stop"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();dashboard.cancelGiveaway(${g.id})" title="Cancel"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `}).join('');
    },

    // ── Edit Giveaway ──────────────────────────────────────────
    async editGiveaway(id, prize, winnerCount, endsAt, channelId) {
        const endDate = new Date(endsAt);
        const endDateStr = endDate.toISOString().slice(0, 16);

        // Fetch channels for dropdown
        const channels = this.selectManager ? await this.selectManager.fetchChannels() : [];
        const channelOptions = (channels || []).map(ch =>
            `<option value="${ch.id}" ${ch.id === channelId ? 'selected' : ''}>#${ch.name}</option>`
        ).join('');

        this.showModal('Edit Giveaway', `
            <div class="form-field"><label>Prize Amount</label><input type="number" id="modal-giveaway-prize" min="1" value="${prize}" class="input"></div>
            <div class="form-field"><label>Number of Winners</label><input type="number" id="modal-giveaway-winners" min="1" value="${winnerCount}" class="input"></div>
            <div class="form-field"><label>End Date & Time</label><input type="datetime-local" id="modal-giveaway-ends" value="${endDateStr}" class="input"></div>
            <div class="form-field"><label>Channel</label><select id="modal-giveaway-channel" class="input"><option value="">select channel...</option>${channelOptions}</select></div>
        `, async () => {
            const newPrize = parseInt(document.getElementById('modal-giveaway-prize')?.value);
            const newWinners = parseInt(document.getElementById('modal-giveaway-winners')?.value) || 1;
            const newEndsAt = document.getElementById('modal-giveaway-ends')?.value;
            const newChannelId = document.getElementById('modal-giveaway-channel')?.value.trim();
            if (!newPrize || !newEndsAt) { this.toast('Prize and end date required', 'warning'); return; }
            await this.apiCall(`/giveaways/${id}`, {
                method: 'PUT', body: JSON.stringify({ prize: newPrize, max_winners: newWinners, ends_at: new Date(newEndsAt).toISOString(), channel_id: newChannelId })
            });
            this.closeModal();
            this.loadGiveawaysData();
        });
    },

    // ── End Giveaway Early ─────────────────────────────────────
    async endGiveaway(id) {
        if (!confirm('End this giveaway early and pick winners now?')) return;
        await this.apiCall(`/giveaways/${id}/end`, { method: 'POST' });
        this.toast('Giveaway ended!', 'success');
        this.loadGiveawaysData();
    },

    // ── Cancel Giveaway ────────────────────────────────────────
    async cancelGiveaway(id) {
        if (!confirm('Cancel this giveaway? This cannot be undone.')) return;
        await this.apiCall(`/giveaways/${id}`, { method: 'DELETE' });
        this.toast('Giveaway cancelled', 'info');
        this.loadGiveawaysData();
    },

    // ── Create Giveaway ────────────────────────────────────────
    createGiveaway() {
        const prize = parseInt(document.getElementById('giveaway-prize')?.value);
        const winners = parseInt(document.getElementById('giveaway-winners')?.value) || 1;
        const duration = parseInt(document.getElementById('giveaway-duration')?.value) || 24;
        const channel = document.getElementById('giveaway-channel')?.value;
        if (!prize || !channel) { this.toast('Prize amount and channel required', 'warning'); return; }
        this.apiCall('/giveaways', {
            method: 'POST', body: JSON.stringify({ prize, max_winners: winners, duration_hours: duration, channel_id: channel })
        }).then(res => {
            if (res) { this.toast('Giveaway created!', 'success'); this.loadGiveawaysData(); }
        });
    },

    // ── Giveaway History ───────────────────────────────────────
    loadGiveawayHistory() {
        this.apiCall('/giveaways/history').then(data => {
            const list = document.getElementById('giveaway-history-list');
            if (!list || !data) return;
            if (!data.length) { list.innerHTML = '<p style="color:var(--fg-dim);">No history yet</p>'; return; }
            list.innerHTML = data.map(g => {
                const channelDisplay = g.channel_name || '';
                return `
                <div class="item-row">
                    <span>Prize: <strong style="color:var(--accent);">$${Number(g.prize).toLocaleString()}</strong> · Winners: ${g.winner_count || 0}${channelDisplay ? ` · ${channelDisplay}` : ''}</span>
                    <span style="color:var(--fg-dim);font-size:0.72rem;">${timeAgo(g.ended_at)}</span>
                </div>
            `}).join('');
        });
    }
};
