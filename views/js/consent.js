/**
 * Privacy Consent Management for bronx
 * Handles Google Analytics consent mode and the UI banner.
 */

(function() {
    const STORAGE_KEY = 'bronx-consent-choice';

    // Initialize Consent Mode defaults
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }

    const initConsent = () => {
        const choice = localStorage.getItem(STORAGE_KEY);
        
        if (choice === 'granted') {
            updateConsent(true);
        } else if (choice === 'denied') {
            updateConsent(false);
        } else {
            // Default to denied until user makes a choice
            updateConsent(false);
            showBanner();
        }
    };

    const updateConsent = (granted) => {
        gtag('consent', 'update', {
            'analytics_storage': granted ? 'granted' : 'denied'
        });
    };

    const showBanner = () => {
        // Wait a small delay for better "wow" effect
        setTimeout(() => {
            const banner = document.getElementById('consent-banner');
            if (banner) banner.classList.add('visible');
        }, 1200);
    };

    const hideBanner = () => {
        const banner = document.getElementById('consent-banner');
        if (banner) banner.classList.remove('visible');
    };

    const handleChoice = (granted) => {
        localStorage.setItem(STORAGE_KEY, granted ? 'granted' : 'denied');
        updateConsent(granted);
        hideBanner();
    };

    // Attach listeners once DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        const okayBtn = document.getElementById('consent-okay');
        const noBtn = document.getElementById('consent-no');

        if (okayBtn) {
            okayBtn.addEventListener('click', () => handleChoice(true));
        }
        if (noBtn) {
            noBtn.addEventListener('click', () => handleChoice(false));
        }

        initConsent();
    });
})();
