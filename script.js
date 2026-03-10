// Command data with detailed information
const commandData = {
    // Economy
    'balance': {
        aliases: ['bal', 'money'],
        description: 'view your current balance including wallet and bank amounts, along with your total net worth.',
        usage: 'b.balance [@user]',
        examples: ['b.balance', 'b.bal', 'b.balance @username'],
        note: 'mention another user to see their balance.'
    },
    'daily': {
        description: 'claim your daily reward. resets every 24 hours.',
        usage: 'b.daily',
        examples: ['b.daily'],
        note: 'cooldown: 24 hours. consecutive daily claims may grant bonuses.'
    },
    'work': {
        description: 'work to earn money. different jobs pay different amounts.',
        usage: 'b.work',
        examples: ['b.work'],
        note: 'cooldown applies. higher level = better pay.'
    },
    'deposit': {
        aliases: ['dep', 'd'],
        description: 'deposit money from your wallet into your bank for safe keeping.',
        usage: 'b.deposit <amount>',
        examples: ['b.deposit 1000', 'b.dep all', 'b.d 50%'],
        note: 'supports: exact amounts, "all", or percentages like "50%".'
    },
    'withdraw': {
        aliases: ['w', 'with'],
        description: 'withdraw money from your bank to your wallet.',
        usage: 'b.withdraw <amount>',
        examples: ['b.withdraw 500', 'b.w all', 'b.with 25%'],
        note: 'supports: exact amounts, "all", or percentages like "25%".'
    },
    'pay': {
        aliases: ['give'],
        description: 'transfer money from your wallet to another user.',
        usage: 'b.pay <@user> <amount>',
        examples: ['b.pay @username 1000', 'b.give @friend 500'],
        note: 'must have enough in wallet. cannot send to yourself.'
    },
    
    // Gambling
    'blackjack': {
        aliases: ['bj', '21'],
        description: 'play blackjack against the dealer. get as close to 21 as possible without going over.',
        usage: 'b.blackjack <bet>',
        examples: ['b.blackjack 100', 'b.bj 500'],
        note: 'interactive game with hit, stand, and double down options.'
    },
    'slots': {
        aliases: ['slot'],
        description: 'spin the slot machine. match symbols to win multipliers.',
        usage: 'b.slots <bet>',
        examples: ['b.slots 100', 'b.slot 250'],
        note: 'higher bets, higher potential rewards. instant results.'
    },
    'coinflip': {
        aliases: ['cf', 'flip'],
        description: 'flip a coin and bet on heads or tails. 50/50 chance.',
        usage: 'b.coinflip <bet> <heads|tails>',
        examples: ['b.coinflip 100 heads', 'b.cf 200 tails', 'b.flip 50 h'],
        note: 'win 2x your bet. accepts h/t shortcuts.'
    },
    'dice': {
        aliases: ['roll'],
        description: 'roll two dice and bet on the outcome.',
        usage: 'b.dice <bet> <prediction>',
        examples: ['b.dice 100 7', 'b.roll 50 doubles'],
        note: 'bet on specific numbers, ranges, or special conditions like doubles.'
    },
    'roulette': {
        description: 'spin the roulette wheel. bet on colors, numbers, or ranges.',
        usage: 'b.roulette <bet> <option>',
        examples: ['b.roulette 100 red', 'b.roulette 50 17'],
        note: 'multiple bet types with different payouts.'
    },
    'frogger': {
        aliases: ['frog'],
        description: 'hop across logs without falling in the water. interactive minigame.',
        usage: 'b.frogger <bet>',
        examples: ['b.frogger 100', 'b.frog 200'],
        note: 'use buttons to hop. cash out anytime or push for higher multipliers.'
    },
    
    // Fishing
    'fish': {
        description: 'cast your fishing line and catch fish of various rarities.',
        usage: 'b.fish',
        examples: ['b.fish'],
        note: 'cooldown applies. rarer fish are worth more.'
    },
    'finv': {
        description: 'view your fishing inventory with all caught fish.',
        usage: 'b.finv [@user]',
        examples: ['b.finv', 'b.finv @username'],
        note: 'shows fish sorted by rarity and lock status.'
    },
    'sellfish': {
        description: 'sell fish from your inventory for money.',
        usage: 'b.sellfish <amount|all|rarity>',
        examples: ['b.sellfish 5', 'b.sellfish all', 'b.sellfish common'],
        note: 'locked fish cannot be sold.'
    },
    'lockfish': {
        description: 'lock or unlock fish to protect them from being sold.',
        usage: 'b.lockfish <fish_id>',
        examples: ['b.lockfish 1', 'b.lockfish 5'],
        note: 'use finv to see fish IDs.'
    },
    'finfo': {
        description: 'view detailed information about a specific fish.',
        usage: 'b.finfo <fish_name>',
        examples: ['b.finfo salmon', 'b.finfo tuna'],
        note: 'shows rarity, value, and description.'
    },
    
    // Shop
    'shop': {
        aliases: ['store'],
        description: 'browse items available for purchase in the shop.',
        usage: 'b.shop',
        examples: ['b.shop', 'b.store'],
        note: 'items may have different effects and values.'
    },
    'buy': {
        aliases: ['purchase'],
        description: 'purchase an item from the shop.',
        usage: 'b.buy <item_name> [amount]',
        examples: ['b.buy fishing_rod', 'b.buy bait 5'],
        note: 'must have enough money in wallet.'
    },
    'trade': {
        description: 'initiate a trade with another user.',
        usage: 'b.trade <@user>',
        examples: ['b.trade @username'],
        note: 'interactive trade window. both parties must accept.'
    },
    'bazaar': {
        description: 'access the community marketplace to buy and sell items.',
        usage: 'b.bazaar',
        examples: ['b.bazaar'],
        note: 'player-driven economy with dynamic prices.'
    },
    
    // Utility
    'help': {
        aliases: ['h', 'cmds'],
        description: 'display list of all available commands organized by category.',
        usage: 'b.help [command]',
        examples: ['b.help', 'b.h balance', 'b.cmds'],
        note: 'specify a command name for detailed help.'
    },
    'ping': {
        aliases: ['pong', 'ms'],
        description: 'check the bot\'s response time and API latency.',
        usage: 'b.ping',
        examples: ['b.ping', 'b.pong'],
        note: 'shows bot latency and Discord API latency.'
    },
    'userinfo': {
        aliases: ['ui', 'whois'],
        description: 'display detailed information about a user including account creation date, roles, and status.',
        usage: 'b.userinfo [@user]',
        examples: ['b.userinfo', 'b.ui @username', 'b.whois @user'],
        note: 'defaults to yourself if no user mentioned.'
    },
    'serverinfo': {
        aliases: ['si', 'guildinfo'],
        description: 'display detailed information about the current server.',
        usage: 'b.serverinfo',
        examples: ['b.serverinfo', 'b.si'],
        note: 'shows member count, creation date, boosts, and more.'
    },
    'avatar': {
        aliases: ['av', 'pfp'],
        description: 'display a user\'s avatar in full resolution. shows server-specific avatar if available.',
        usage: 'b.avatar [@user]',
        examples: ['b.avatar', 'b.av @username', 'b.pfp @user'],
        note: 'prioritizes server avatar, falls back to global. uses user accent color.'
    },
    'banner': {
        aliases: ['bn', 'banana'],
        description: 'display a user\'s profile banner. shows server banner if available, otherwise global banner.',
        usage: 'b.banner [@user]',
        examples: ['b.banner', 'b.bn @username', 'b.banana @user'],
        note: 'only users with Nitro can set banners. uses user accent color.'
    },
    'serveravatar': {
        aliases: ['svav', 'servericon', 'svicon'],
        description: 'display the server\'s icon/avatar in full resolution.',
        usage: 'b.serveravatar',
        examples: ['b.serveravatar', 'b.svav', 'b.servericon'],
        note: 'shows the current server icon at maximum quality.'
    },
    'serverbanner': {
        aliases: ['svbn', 'svbanner', 'svbanana'],
        description: 'display the server\'s banner if one is set.',
        usage: 'b.serverbanner',
        examples: ['b.serverbanner', 'b.svbn', 'b.svbanner'],
        note: 'server must have banner feature (level 2+ boost).'
    },
    'poll': {
        description: 'create an interactive poll with multiple options.',
        usage: 'b.poll <question> | <option1> | <option2> ...',
        examples: ['b.poll what for dinner? | pizza | sushi | tacos'],
        note: 'supports up to 10 options. uses reactions for voting.'
    },
    'cleanup': {
        description: 'bulk delete messages from the channel.',
        usage: 'b.cleanup <amount>',
        examples: ['b.cleanup 10', 'b.cleanup 50'],
        note: 'requires manage messages permission. max 100 messages.'
    },
    
    // Social
    'hug': {
        description: 'hug someone with an animated gif.',
        usage: 'b.hug <@user>',
        examples: ['b.hug @username'],
        note: 'spread positivity in your server.'
    },
    'kiss': {
        description: 'kiss someone with an animated gif.',
        usage: 'b.kiss <@user>',
        examples: ['b.kiss @username'],
        note: 'random gif from curated collection.'
    },
    'pat': {
        description: 'pat someone on the head with an animated gif.',
        usage: 'b.pat <@user>',
        examples: ['b.pat @username'],
        note: 'wholesome headpats for everyone.'
    },
    
    // Leaderboard
    'leaderboard': {
        aliases: ['lb', 'top'],
        description: 'view rankings across different stats and categories.',
        usage: 'b.leaderboard [category]',
        examples: ['b.leaderboard', 'b.lb money', 'b.top fish'],
        note: 'interactive pagination. multiple leaderboard types available.'
    }
};

// Modal functions
function openModal(commandName) {
    const data = commandData[commandName];
    if (!data) return;

    document.getElementById('modalCommandName').textContent = commandName;
    
    const aliasesEl = document.getElementById('modalAliases');
    if (data.aliases && data.aliases.length > 0) {
        aliasesEl.textContent = 'aliases: ' + data.aliases.join(', ');
        aliasesEl.style.display = 'block';
    } else {
        aliasesEl.style.display = 'none';
    }

    document.getElementById('modalDescription').textContent = data.description;

    const usageSection = document.getElementById('modalUsageSection');
    if (data.usage) {
        document.getElementById('modalUsage').textContent = data.usage;
        usageSection.style.display = 'block';
    } else {
        usageSection.style.display = 'none';
    }

    const examplesSection = document.getElementById('modalExamplesSection');
    if (data.examples && data.examples.length > 0) {
        const examplesEl = document.getElementById('modalExamples');
        examplesEl.innerHTML = data.examples
            .map(ex => `<div class="modal-example">${ex}</div>`)
            .join('');
        examplesSection.style.display = 'block';
    } else {
        examplesSection.style.display = 'none';
    }

    const noteSection = document.getElementById('modalNoteSection');
    if (data.note) {
        document.getElementById('modalNote').textContent = data.note;
        noteSection.style.display = 'block';
    } else {
        noteSection.style.display = 'none';
    }

    document.getElementById('commandModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('commandModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

// Close modal on outside click
document.getElementById('commandModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeModal();
    }
});

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// Add click handlers to all command items
document.addEventListener('DOMContentLoaded', function() {
    // Add indicator icons to all command items
    document.querySelectorAll('.command-item').forEach(item => {
        const indicator = document.createElement('i');
        indicator.className = 'fas fa-info-circle command-item-indicator';
        item.appendChild(indicator);
        
        const commandName = item.querySelector('.command-name').textContent.trim();
        item.addEventListener('click', () => openModal(commandName));
    });

    // Add click handlers to feature cards to scroll to commands
    document.querySelectorAll('.feature-card').forEach(card => {
        card.addEventListener('click', () => {
            document.getElementById('commands').scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        });
    });

    // Scroll indicator click handler
    document.getElementById('scrollIndicator').addEventListener('click', () => {
        document.getElementById('features').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });
});

// Dynamic invite link generation
document.getElementById('invite-btn').addEventListener('click', function(e) {
    e.preventDefault();
    const permissions = '7610260541407217';
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=828380019406929962&permissions=${permissions}&integration_type=0&scope=bot+applications.commands`;
    window.open(inviteUrl, '_blank');
});

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════
//  PROFESSIONAL SCROLL ANIMATION SYSTEM
// ═══════════════════════════════════════════════════════════════════

(function initScrollAnimations() {
    // ── 1. Hero parallax fade-out on scroll ──────────────────────────
    const hero = document.querySelector('.hero');
    if (hero) {
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    const rect = hero.getBoundingClientRect();
                    const progress = Math.min(Math.max(-rect.top / (rect.height * 0.6), 0), 1);
                    hero.style.setProperty('--scroll-progress', progress.toFixed(3));
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    // ── 2. Auto-tag animatable elements with data-reveal ─────────────
    //    Adds attributes if not manually set in HTML
    document.querySelectorAll('.feature-card').forEach((el, i) => {
        if (!el.hasAttribute('data-reveal')) {
            el.setAttribute('data-reveal', 'up');
            el.style.setProperty('--reveal-delay', `${i * 0.08}s`);
        }
    });

    document.querySelectorAll('.category').forEach((el, i) => {
        if (!el.hasAttribute('data-reveal')) {
            el.setAttribute('data-reveal', i % 2 === 0 ? 'left' : 'right');
            el.style.setProperty('--reveal-delay', `${i * 0.1}s`);
        }
    });

    document.querySelectorAll('.stat-item').forEach((el, i) => {
        if (!el.hasAttribute('data-reveal')) {
            el.setAttribute('data-reveal', 'scale');
            el.style.setProperty('--reveal-delay', `${i * 0.12}s`);
        }
    });

    // Footer — use a separate observer with threshold:0 so it fires
    // even at the very bottom of the page
    const footerContent = document.querySelector('.footer-content');
    if (footerContent) {
        const footerObserver = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    obs.unobserve(entry.target);
                }
            });
        }, { threshold: 0, rootMargin: '0px 0px 0px 0px' });
        footerObserver.observe(footerContent);
    }

    // ── 3. Stagger delays for command items inside each category ─────
    document.querySelectorAll('.category').forEach(cat => {
        cat.querySelectorAll('.command-item').forEach((item, i) => {
            item.style.animationDelay = `${0.15 + i * 0.04}s`;
        });
    });

    // Tag footer links stagger
    document.querySelectorAll('.footer-link').forEach((link, i) => {
        link.style.animationDelay = `${i * 0.08}s`;
    });

    // ── 4. IntersectionObserver — reveal elements on scroll ──────────
    const revealObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                // Don't unobserve — one-time reveal
                obs.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.12,
        rootMargin: '0px 0px -60px 0px'
    });

    document.querySelectorAll('[data-reveal]').forEach(el => {
        revealObserver.observe(el);
    });

    // ── 5. Section line + title observer ─────────────────────────────
    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('section-visible');
            }
        });
    }, {
        threshold: 0.05,
        rootMargin: '0px 0px -40px 0px'
    });

    document.querySelectorAll('.features, .commands, .stats').forEach(section => {
        sectionObserver.observe(section);
    });

    // ── 6. Animated stat counters ────────────────────────────────────
    function animateCounter(el, endText) {
        // Parse numeric part — supports "50+", "24/7", "C++17", "8"
        const match = endText.match(/^(\d+)/);
        if (!match) {
            el.textContent = endText;
            return;
        }
        const endNum = parseInt(match[1], 10);
        const suffix = endText.slice(match[0].length); // e.g. "+", "/7", ""
        const duration = 1200;
        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(eased * endNum);
            el.textContent = current + suffix;
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    const statValues = document.querySelectorAll('.stat-value');
    const originalTexts = new Map();
    statValues.forEach(el => originalTexts.set(el, el.textContent.trim()));

    const counterObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const text = originalTexts.get(el);
                if (text) animateCounter(el, text);
                obs.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    statValues.forEach(el => counterObserver.observe(el));
})();

// Check authentication status and update login button
async function checkAuthAndUpdateButton() {
    try {
        const response = await fetch('/api/auth/user', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const loginBtn = document.getElementById('login-btn');
            
            if (data.authenticated && loginBtn) {
                // User is logged in, change button to dashboard
                loginBtn.textContent = 'dashboard';
                loginBtn.href = '/dashboard.html';
                loginBtn.classList.remove('btn-secondary');
                loginBtn.classList.add('btn-primary');
            }
        }
    } catch (error) {
        // Authentication check failed, keep default "log in" button
        console.log('Auth check failed, keeping default button');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    checkAuthAndUpdateButton();
});
