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

// Intersection Observer for fade-in animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

document.querySelectorAll('.feature-card, .category, .stat-item').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
});
