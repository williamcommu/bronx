// ============================================================
//  dashboard/api.js — API communication layer
// ============================================================

/**
 * API communication mixin for BronxBotDashboard
 * Provides standardized fetch wrapper with error handling
 */
export const ApiMixin = {
    apiEndpoint: '/api',
    csrfToken: null,

    /**
     * Fetch CSRF token from server
     */
    async fetchCsrfToken() {
        try {
            const res = await fetch('/api/csrf-token', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                this.csrfToken = data.csrfToken;
            }
        } catch (e) {
            console.error('Failed to fetch CSRF token:', e);
        }
    },

    /**
     * Make an API call with standardized error handling
     * @param {string} endpoint - API endpoint (will be prefixed with apiEndpoint)
     * @param {RequestInit} options - Fetch options
     * @returns {Promise<any|null>}
     */
    async apiCall(endpoint, options = {}) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            
            if (this.currentGuild) {
                headers['X-Guild-ID'] = this.currentGuild;
            }

            // Add CSRF token for state-changing requests
            const method = options.method || 'GET';
            if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
                if (!this.csrfToken) {
                    await this.fetchCsrfToken();
                }
                if (this.csrfToken) {
                    headers['X-CSRF-Token'] = this.csrfToken;
                }
            }

            const response = await fetch(`${this.apiEndpoint}${endpoint}`, {
                credentials: 'include',
                headers,
                ...options
            });

            if (!response.ok) {
                const isUserAction = options.method && options.method !== 'GET';
                if (isUserAction) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                console.warn(`API ${endpoint}: ${response.status}`);
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('API call failed:', error);
            const isUserAction = options.method && options.method !== 'GET';
            if (isUserAction) {
                this.toast(`API Error: ${error.message}`, 'error');
            }
            return null;
        }
    },

    /**
     * GET helper
     * @param {string} endpoint
     * @returns {Promise<any|null>}
     */
    async apiGet(endpoint) {
        return this.apiCall(endpoint);
    },

    /**
     * POST helper
     * @param {string} endpoint
     * @param {any} data
     * @returns {Promise<any|null>}
     */
    async apiPost(endpoint, data) {
        return this.apiCall(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    /**
     * PUT helper
     * @param {string} endpoint
     * @param {any} data
     * @returns {Promise<any|null>}
     */
    async apiPut(endpoint, data) {
        return this.apiCall(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    /**
     * DELETE helper
     * @param {string} endpoint
     * @param {any} data
     * @returns {Promise<any|null>}
     */
    async apiDelete(endpoint, data = null) {
        const options = { method: 'DELETE' };
        if (data) options.body = JSON.stringify(data);
        return this.apiCall(endpoint, options);
    }
};
