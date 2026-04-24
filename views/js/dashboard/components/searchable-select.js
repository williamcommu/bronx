// ============================================================
//  dashboard/components/searchable-select.js
//  Reusable filterable dropdown component for channels, roles, members
// ============================================================

/**
 * SearchableSelect — A filterable dropdown component
 * 
 * Features:
 * - Type to filter items
 * - Keyboard navigation (↑↓ Enter Escape)
 * - Icon support (# for channels, colored dot for roles, avatar for users)
 * - Stores display name + ID
 * 
 * @example
 * const select = new SearchableSelect({
 *     type: 'channel', // 'channel' | 'role' | 'member'
 *     placeholder: 'Select channel...',
 *     onSelect: (item) => console.log('Selected:', item)
 * });
 * select.attach(document.getElementById('my-input'));
 */
export class SearchableSelect {
    constructor(options = {}) {
        this.type = options.type || 'channel'; // channel, role, member
        this.placeholder = options.placeholder || 'Select...';
        this.onSelect = options.onSelect || (() => {});
        this.items = [];
        this.filteredItems = [];
        this.selectedIndex = -1;
        this.isOpen = false;
        this.container = null;
        this.input = null;
        this.hiddenInput = null;
        this.dropdown = null;
        this.debounceTimer = null;
    }

    /**
     * Attach to an existing input element, transforming it into a searchable select
     * @param {HTMLElement} element - The input element or wrapper div
     */
    attach(element) {
        // If it's already a wrapper, use it; otherwise create wrapper
        if (element.classList.contains('searchable-select')) {
            this.container = element;
            this.input = element.querySelector('.searchable-input');
            this.hiddenInput = element.querySelector('input[type="hidden"]');
            
            // Debug: Verify elements were found
            if (!this.input) {
                console.warn('SearchableSelect: .searchable-input not found in wrapper');
            }
            if (!this.hiddenInput) {
                console.warn('SearchableSelect: hidden input not found in wrapper');
            }
        } else {
            // Transform plain input into searchable select
            this.container = document.createElement('div');
            this.container.className = 'searchable-select';
            element.parentNode.insertBefore(this.container, element);
            
            this.hiddenInput = element;
            this.hiddenInput.type = 'hidden';
            this.container.appendChild(this.hiddenInput);
            
            this.input = document.createElement('input');
            this.input.type = 'text';
            this.input.className = 'input searchable-input';
            this.input.placeholder = this.placeholder;
            this.container.insertBefore(this.input, this.hiddenInput);
        }

        // Create dropdown
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'searchable-dropdown';
        this.dropdown.style.display = 'none';
        this.container.appendChild(this.dropdown);

        // Event listeners
        this.input.addEventListener('focus', () => this.open());
        this.input.addEventListener('input', (e) => this.onInput(e));
        this.input.addEventListener('keydown', (e) => this.onKeydown(e));
        
        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });
    }

    /**
     * Set available items for the dropdown
     * @param {Array} items - Array of items with id, name, and type-specific properties
     */
    setItems(items) {
        // Ensure items is always an array (API may return null, undefined, or error object)
        this.items = Array.isArray(items) ? items : [];
        this.filteredItems = [...this.items];
        this.render();
    }

    /**
     * Set the selected value
     * @param {string} id - The item ID to select
     * @param {string} displayName - Optional display name
     */
    setValue(id, displayName = '') {
        this.hiddenInput.value = id || '';
        if (displayName) {
            this.input.value = displayName;
        } else if (id) {
            const item = this.items.find(i => i.id === id);
            this.input.value = item ? item.name : id;
        } else {
            this.input.value = '';
        }
    }

    /**
     * Get the current selected value
     * @returns {string} The selected item ID
     */
    getValue() {
        return this.hiddenInput.value;
    }

    /**
     * Clear the selection
     */
    clear() {
        this.hiddenInput.value = '';
        this.input.value = '';
    }

    /**
     * Open the dropdown
     */
    open() {
        if (!this.input || !this.dropdown) {
            console.warn('SearchableSelect: Missing input or dropdown element');
            return;
        }
        if (this.items.length === 0) {
            // Still show dropdown with "No matches" message
            this.dropdown.style.display = '';
            this.isOpen = true;
            this.render();
            return;
        }
        this.isOpen = true;
        this.dropdown.style.display = '';
        this.selectedIndex = -1;
        this.filter(this.input.value);
    }

    /**
     * Close the dropdown
     */
    close() {
        this.isOpen = false;
        this.dropdown.style.display = 'none';
        this.selectedIndex = -1;
    }

    /**
     * Handle input changes
     */
    onInput(e) {
        // Debounce filtering
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.filter(e.target.value);
            if (!this.isOpen) this.open();
        }, 100);
    }

    /**
     * Handle keyboard navigation
     */
    onKeydown(e) {
        if (!this.isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                this.open();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1);
                this.highlightSelected();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.highlightSelected();
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedIndex >= 0 && this.filteredItems[this.selectedIndex]) {
                    this.selectItem(this.filteredItems[this.selectedIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.close();
                break;
            case 'Tab':
                this.close();
                break;
        }
    }

    /**
     * Filter items based on query
     */
    filter(query) {
        const q = (query || '').toLowerCase().trim();
        if (!q) {
            this.filteredItems = [...this.items];
        } else {
            this.filteredItems = this.items.filter(item => 
                item.name.toLowerCase().includes(q) ||
                item.id.includes(q)
            );
        }
        this.selectedIndex = -1;
        this.render();
    }

    /**
     * Render the dropdown items
     */
    render() {
        if (!this.dropdown) return;
        
        if (!this.filteredItems || this.filteredItems.length === 0) {
            this.dropdown.innerHTML = '<div class="searchable-empty">No items available</div>';
            return;
        }

        this.dropdown.innerHTML = this.filteredItems.map((item, idx) => {
            const icon = this.getIcon(item);
            const activeClass = idx === this.selectedIndex ? 'active' : '';
            return `
                <div class="searchable-item ${activeClass}" data-id="${item.id}" data-index="${idx}">
                    ${icon}
                    <span class="searchable-item-name">${this.escapeHtml(item.name)}</span>
                </div>
            `;
        }).join('');

        // Add click handlers
        this.dropdown.querySelectorAll('.searchable-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                const item = this.items.find(i => i.id === id);
                if (item) this.selectItem(item);
            });
            el.addEventListener('mouseenter', () => {
                this.selectedIndex = parseInt(el.dataset.index, 10);
                this.highlightSelected();
            });
        });
    }

    /**
     * Get icon HTML for an item based on type
     */
    getIcon(item) {
        switch (this.type) {
            case 'channel':
                const channelIcon = item.type === 5 ? 'fa-bullhorn' : 'fa-hashtag';
                return `<i class="fas ${channelIcon} searchable-icon channel-icon"></i>`;
            case 'role':
                const colorHex = item.color ? `#${item.color.toString(16).padStart(6, '0')}` : 'var(--fg-dim)';
                return `<span class="searchable-icon role-color" style="background:${colorHex}"></span>`;
            case 'member':
                if (item.avatar) {
                    const avatarUrl = `https://cdn.discordapp.com/avatars/${item.id}/${item.avatar}.png?size=32`;
                    return `<img class="searchable-icon member-avatar" src="${avatarUrl}" alt="">`;
                }
                return `<i class="fas fa-user searchable-icon member-icon"></i>`;
            default:
                return '';
        }
    }

    /**
     * Highlight the currently selected item
     */
    highlightSelected() {
        this.dropdown.querySelectorAll('.searchable-item').forEach((el, idx) => {
            el.classList.toggle('active', idx === this.selectedIndex);
        });
        
        const active = this.dropdown.querySelector('.searchable-item.active');
        if (active) {
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Select an item
     */
    selectItem(item) {
        this.hiddenInput.value = item.id;
        this.input.value = item.name;
        this.close();
        this.onSelect(item);
        
        // Trigger change event on hidden input
        this.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * Escape HTML characters
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

/**
 * SearchableSelectManager — Manages all searchable selects on the page
 * Provides data caching and easy initialization
 */
export class SearchableSelectManager {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.instances = new Map();
        this.channelsCache = null;
        this.rolesCache = null;
        this.membersCache = null;
    }

    /**
     * Fetch and cache channels for current guild
     */
    async fetchChannels() {
        if (Array.isArray(this.channelsCache)) return this.channelsCache;
        try {
            const result = await this.dashboard.apiCall('/discord/channels');
            console.log('SearchableSelect: /discord/channels response:', result);
            this.channelsCache = Array.isArray(result) ? result : [];
            if (!this.channelsCache.length) {
                this.dashboard.toast?.('Could not load channels — is the bot in this server?', 'warning');
            }
            return this.channelsCache;
        } catch (e) {
            console.error('Failed to fetch channels:', e);
            this.dashboard.toast?.('Failed to load channels', 'error');
            return [];
        }
    }

    /**
     * Fetch and cache roles for current guild
     */
    async fetchRoles() {
        if (Array.isArray(this.rolesCache)) return this.rolesCache;
        try {
            const result = await this.dashboard.apiCall('/discord/roles');
            console.log('SearchableSelect: /discord/roles response:', result);
            this.rolesCache = Array.isArray(result) ? result : [];
            if (!this.rolesCache.length) {
                this.dashboard.toast?.('Could not load roles — is the bot in this server?', 'warning');
            }
            return this.rolesCache;
        } catch (e) {
            console.error('Failed to fetch roles:', e);
            this.dashboard.toast?.('Failed to load roles', 'error');
            return [];
        }
    }

    /**
     * Fetch and cache members for current guild
     */
    async fetchMembers() {
        if (Array.isArray(this.membersCache)) return this.membersCache;
        try {
            const result = await this.dashboard.apiCall('/discord/members');
            console.log('SearchableSelect: /discord/members response:', result);
            this.membersCache = Array.isArray(result) ? result : [];
            return this.membersCache;
        } catch (e) {
            console.error('Failed to fetch members:', e);
            return [];
        }
    }

    /**
     * Clear all caches (call on guild change)
     */
    clearCache() {
        this.channelsCache = null;
        this.rolesCache = null;
        this.membersCache = null;
    }

    /**
     * Initialize a searchable select on an element
     * @param {string|HTMLElement} elementOrId - Element or element ID
     * @param {string} type - 'channel' | 'role' | 'member'
     * @param {Object} options - Additional options
     * @returns {SearchableSelect}
     */
    async init(elementOrId, type, options = {}) {
        const element = typeof elementOrId === 'string' 
            ? document.getElementById(elementOrId) 
            : elementOrId;
        
        if (!element) {
            console.warn(`SearchableSelect: Element not found: ${elementOrId}`);
            return null;
        }

        // Check if already initialized
        const existingKey = element.id || element.dataset.field;
        if (existingKey && this.instances.has(existingKey)) {
            return this.instances.get(existingKey);
        }

        const placeholders = {
            channel: 'Select channel...',
            role: 'Select role...',
            member: 'Select member...'
        };

        const select = new SearchableSelect({
            type,
            placeholder: options.placeholder || placeholders[type] || 'Select...',
            onSelect: options.onSelect || (() => {})
        });

        select.attach(element);

        // Fetch and set items
        let items = [];
        switch (type) {
            case 'channel':
                items = await this.fetchChannels();
                console.log('SearchableSelect: Fetched channels:', items?.length || 0, 'items');
                break;
            case 'role':
                items = await this.fetchRoles();
                console.log('SearchableSelect: Fetched roles:', items?.length || 0, 'items');
                break;
            case 'member':
                items = await this.fetchMembers();
                console.log('SearchableSelect: Fetched members:', items?.length || 0, 'items');
                break;
        }
        
        // Ensure items is an array before processing
        if (!Array.isArray(items)) {
            items = [];
        }
        
        // Normalize member data if needed
        if (type === 'member' && items.length > 0) {
            items = items.map(m => ({
                id: m.id,
                name: m.display_name || m.username,
                avatar: m.avatar,
                bot: m.bot
            }));
        }

        select.setItems(items);

        // Store instance
        if (existingKey) {
            this.instances.set(existingKey, select);
        }

        return select;
    }

    /**
     * Get an existing searchable select instance
     * @param {string} id - Element ID
     * @returns {SearchableSelect|null}
     */
    get(id) {
        return this.instances.get(id) || null;
    }

    /**
     * Destroy all instances
     */
    destroyAll() {
        this.instances.clear();
        this.clearCache();
    }
}
