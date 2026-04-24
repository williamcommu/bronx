/**
 * Version Check — silently polls /api/version via WebSocket-style ping
 * Shows an update banner (consent-banner style) when a new version is detected.
 */
(function() {
    const POLL_INTERVAL = 60000;  // Check every 60 seconds
    const DISMISSED_KEY = 'bronx-update-dismissed';

    let knownVersion = null;
    let pollTimer = null;

    async function checkVersion() {
        try {
            const res = await fetch('/api/version', {
                cache: 'no-store',
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) return;

            const data = await res.json();
            if (!data.version) return;

            // First check — store as baseline
            if (knownVersion === null) {
                knownVersion = data.version;
                return;
            }

            // Version changed!
            if (data.version !== knownVersion) {
                const dismissed = sessionStorage.getItem(DISMISSED_KEY);
                if (dismissed === data.version) return; // User already dismissed this version

                showUpdateBanner(knownVersion, data.version);
                knownVersion = data.version;
            }
        } catch (e) {
            // Silently fail — don't disrupt the user
        }
    }

    function showUpdateBanner(oldVer, newVer) {
        // Don't show duplicate banners
        const existing = document.getElementById('update-banner');
        if (existing && existing.classList.contains('visible')) return;

        let banner = existing;
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'update-banner';
            banner.className = 'update-banner';
            banner.innerHTML = `
                <div class="update-content">
                    <h3><i class="fas fa-arrow-up"></i> Update Available</h3>
                    <p>A new version of bronx is available. Refresh to get the latest features and fixes.</p>
                    <p style="margin-top:0.25rem;"><span class="update-version" id="update-version-tag"></span></p>
                </div>
                <div class="update-buttons">
                    <button id="update-refresh" class="btn btn-primary">Refresh</button>
                    <button id="update-dismiss" class="btn btn-secondary">Later</button>
                </div>
            `;
            document.body.appendChild(banner);

            document.getElementById('update-refresh').addEventListener('click', () => {
                window.location.reload(true);
            });

            document.getElementById('update-dismiss').addEventListener('click', () => {
                sessionStorage.setItem(DISMISSED_KEY, newVer);
                banner.classList.remove('visible');
            });
        }

        // Update version tag text
        const tag = document.getElementById('update-version-tag');
        if (tag) tag.textContent = `v${oldVer} → v${newVer}`;

        // Slide in after a short delay
        setTimeout(() => banner.classList.add('visible'), 300);
    }

    // Start polling once the page loads
    document.addEventListener('DOMContentLoaded', () => {
        // Initial silent check after 3 seconds (let page settle first)
        setTimeout(checkVersion, 3000);

        // Then poll periodically
        pollTimer = setInterval(checkVersion, POLL_INTERVAL);
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (pollTimer) clearInterval(pollTimer);
    });
})();
