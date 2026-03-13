// ============================================================
//  bronx dashboard — modular ES6 entry point
//  
//  This file has been modularized the code is now split into:
//  - dashboard/core.js        — Main class with authentication & initialization
//  - dashboard/api.js         — API communication layer
//  - dashboard/ui.js          — Toast, command palette, sidebar, modal
//  - dashboard/realtime.js    — Socket.io / WebSocket handling
//  - dashboard/utils.js       — Utility functions
//  - dashboard/features/*.js  — Individual feature modules
//
//  For backwards compatibility with non-module script loading,
//  this file re-exports everything as a global.
// ============================================================

import { BronxBotDashboard } from './dashboard/core.js';
import { formatCurrency, formatNumber, timeAgo } from './dashboard/utils.js';

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new BronxBotDashboard();
});

// Export utilities globally for inline onclick handlers
window.formatCurrency = formatCurrency;
window.formatNumber = formatNumber;
window.timeAgo = timeAgo;
