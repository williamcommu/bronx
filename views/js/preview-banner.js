/* ============================================================
   bronx · preview mode banner
   ============================================================ */
(function() {
    'use strict';

    async function checkPreviewMode() {
        try {
            const res = await fetch('/api/version');
            const data = await res.json();

            if (data.isPreview) {
                renderBanner();
            }
        } catch (e) {
            // Silently fail, we don't want to break the site if the API is down
        }
    }

    function renderBanner() {
        if (document.getElementById('preview-mode-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'preview-mode-banner';
        banner.className = 'preview-banner';
        banner.innerHTML = `
            <div class="preview-banner-content">
                <div class="preview-banner-left">
                    <span class="preview-tag">PREVIEW MODE</span>
                    <span class="preview-message">This is an ephemeral deployment for testing changes. Data may not be persistent.</span>
                </div>
                <div class="preview-banner-right">
                    <button class="preview-close" onclick="this.parentElement.parentElement.remove()" title="Dismiss">&times;</button>
                </div>
            </div>
        `;

        document.body.prepend(banner);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkPreviewMode);
    } else {
        checkPreviewMode();
    }
})();
