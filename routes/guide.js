// Guide routes: serve guide page and guide API data
const express = require('express');
const path = require('path');
const router = express.Router();

// Serve guide page
router.get('/guide', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'html/guide.html'));
});

// Guide API - serves guide content as JSON (mirrors guide_data.h)
router.get('/api/guide', (req, res) => {
    const guideData = {
        sections: [
            {
                name: "getting started",
                emoji: "🚀",
                description: "bot basics — commands, economy, first steps",
                admin_only: false,
                pages: [
                    {
                        title: "welcome to bronx",
                        content: "bronx is a multipurpose discord bot focused on economy, progression systems, and community engagement — it combines idle/active income with skill trees, crafting, pets, and competitive leaderboards to create long-term engagement for your server.\n\nyou can use either **text commands** (`.command`) or **slash commands** (`/command`) — both work identically, so pick whichever feels natural.\n\nthe core loop is simple: earn coins → spend/invest → level up → unlock new systems → earn more efficiently. everything connects: fishing gives crafting materials, crafting boosts passive income, passive income funds gambling, gambling funds skill trees, skill trees boost everything."
                    },
                    {
                        title: "your first steps",
                        content: "1. run `.bal` or `/balance` — this creates your account and shows your starting coins\n2. run `.daily` — free daily coins, builds a streak for bonus rewards\n3. try `.fish` or `.mine` — basic activities that earn coins and materials\n4. check `.help` — browse all available commands by category\n5. run `.profile` — see your stats, level, and progression\n\nas you use commands you gain xp passively — leveling up unlocks new features and shows your dedication on leaderboards."
                    }
                ]
            },
            {
                name: "economy",
                emoji: "💰",
                description: "wallet, bank, transactions, earning",
                admin_only: false,
                pages: [
                    {
                        title: "the dual-balance system",
                        content: "your money exists in two places:\n\n**wallet** — liquid cash, used for purchases and gambling, but vulnerable to robbery if you're not careful\n**bank** — protected savings, earns interest over time, but has a capacity limit that grows as you level up\n\nuse `.dep <amount>` to deposit and `.with <amount>` to withdraw — keep a balance between risk and safety."
                    },
                    {
                        title: "earning methods overview",
                        content: "**active income:**\n- `.work` — guaranteed coins on cooldown\n- `.fish` / `.mine` — rng-based but can yield rare catches worth substantially more\n- `.daily` / `.weekly` — streak-based free claims\n- `.vote` — external voting rewards\n\n**passive income:**\n- bank interest (automatic over time)\n- investments (see passive income guide section)\n- pets generating coins while you're away\n- server events and world bosses\n\n**high-risk income:**\n- gambling games (coinflip, blackjack, slots, etc.)\n- trading rare items with other users"
                    }
                ]
            },
            {
                name: "fishing",
                emoji: "🎣",
                description: "catching fish, rods, bait, rare catches",
                admin_only: false,
                pages: [
                    {
                        title: "fishing basics",
                        content: "`.fish` casts your line and catches something — fish vary from common (low value) to legendary (extremely valuable and rare). your catch depends on your rod quality, bait type, and pure luck.\n\nfish can be:\n- **sold** for coins (`.sell fish <name>` or `.sellall fish`)\n- **used in crafting** recipes\n- **collected** for achievements\n\nrare fish like golden koi, ancient coelacanth, or the mythic leviathan are worth pursuing — they're both prestigious and valuable."
                    },
                    {
                        title: "rods and bait",
                        content: "**rods** — better rods increase catch quality and rare chance:\n- basic rod: starting equipment\n- fiberglass rod: slight quality boost\n- carbon rod: noticeable rare boost\n- titanium rod: high-tier, consistent good catches\n- quantum rod: top tier, designed for legendary hunting\n\n**bait** — consumable items that modify catches:\n- basic bait: no modifier\n- premium bait: +chance for uncommon+\n- exotic bait: +chance for rare+\n- legendary lure: significantly boosted legendary odds\n\nbuy gear from `.shop`, equip with `.equip <item>`."
                    },
                    {
                        title: "fishing strategy",
                        content: "efficient fishing means managing cooldowns and maximizing value:\n\n1. always use the best rod you can afford\n2. save legendary lures for when you can fish actively\n3. bulk sell common fish, keep rares for crafting checks\n4. watch for fishing events — they boost rare spawn rates temporarily\n5. track your catches in `.fishlog` for collection completion\n\nlegendary fish are rare but farmable with patience — don't burn out grinding for them."
                    }
                ]
            },
            {
                name: "mining",
                emoji: "⛏️",
                description: "ores, pickaxes, crafting materials",
                admin_only: false,
                pages: [
                    {
                        title: "mining overview",
                        content: "`.mine` extracts ores and gems from the depths — like fishing, quality varies from common stone to legendary gems. mining yields are used for crafting equipment, selling for coins, or collecting.\n\nore tiers: stone < coal < iron < gold < diamond < ancient < void\n\nmining uses pickaxe durability — better picks last longer and yield better finds. manage your tools or you'll be stuck with basic returns."
                    },
                    {
                        title: "pickaxes and upgrades",
                        content: "**pickaxes** — affect yield quality and durability:\n- wooden pick: breaks fast, low yields\n- stone pick: standard starting pick\n- iron pick: durable, moderate yields\n- diamond pick: long-lasting, good rare chance\n- void pick: top-tier, exceptional everything\n\npickaxes degrade with use — repair them at the shop or craft replacements. running a void pick into the ground is painful.\n\n**tip:** keep a backup pickaxe. being stuck mining with sticks is inefficient."
                    }
                ]
            },
            {
                name: "gambling",
                emoji: "🎰",
                description: "coinflip, blackjack, slots, risk/reward",
                admin_only: false,
                pages: [
                    {
                        title: "gambling games",
                        content: "gambling is high-risk, high-reward — you can double up or lose everything. games include:\n\n**coinflip** — 50/50, double or nothing\n**blackjack** — beat the dealer, 1.5x on blackjack\n**slots** — spin for multipliers, jackpots exist\n**dice** — roll against house, odds vary\n**roulette** — classic casino rules\n**crash** — multiplier rises until crash, cash out in time\n\neach game has slightly different odds and skill elements — blackjack rewards strategy while slots are pure rng."
                    },
                    {
                        title: "gambling responsibly",
                        content: "gambling can wipe your balance fast. smart strategies:\n\n1. **set a loss limit** — stop after losing X coins, no exceptions\n2. **bet small** — 1-5% of your total per bet unless going for yolo plays\n3. **understand odds** — coinflip is 50%, blackjack favors skill, slots favor the house\n4. **walk away on wins** — quit while ahead, don't chase round numbers\n5. **use gambling for fun** — reliable income comes from fishing/mining/passive\n\nthe casino always wins long-term. short-term variance can go either way."
                    }
                ]
            },
            {
                name: "crafting",
                emoji: "🔨",
                description: "recipes, materials, equipment creation",
                admin_only: false,
                pages: [
                    {
                        title: "crafting system",
                        content: "crafting turns raw materials (fish, ores, drops) into equipment, consumables, and valuable items. run `.craft` to see available recipes and `.craft <item>` to craft.\n\nrecipes require specific materials — check what you need with `.recipe <item>`. some recipes are locked behind level requirements or skill tree unlocks.\n\ncrafted gear is often better than shop gear and can be sold to other players for profit."
                    },
                    {
                        title: "crafting tips",
                        content: "efficient crafting:\n\n1. **hoard materials early** — don't sell everything, crafting needs stockpiles\n2. **check recipes before selling** — that rare fish might be worth more crafted\n3. **level up crafting** — higher crafting levels unlock better recipes\n4. **watch for events** — some events add limited-time recipes\n5. **trade for materials** — sometimes buying mats is cheaper than farming\n\ncrafting connects all systems — fishing and mining feed it, and outputs enhance everything else."
                    }
                ]
            },
            {
                name: "pets",
                emoji: "🐾",
                description: "pet collection, bonuses, passive benefits",
                admin_only: false,
                pages: [
                    {
                        title: "pet system",
                        content: "pets provide passive bonuses while you play. each pet has:\n\n**rarity** — common to legendary, affecting bonus strength\n**type** — determines what bonuses it gives (fishing, mining, luck, income, etc.)\n**level** — pets level up with use, increasing their effectiveness\n\nequip a pet with `.pet equip <name>` — you can have one active pet at a time. view your collection with `.pets`."
                    },
                    {
                        title: "getting and raising pets",
                        content: "obtain pets through:\n- egg drops from activities (fishing, mining, events)\n- shop purchases (basic eggs)\n- event rewards (exclusive pets)\n- crafting (some pets are craftable)\n- trading with other users\n\npets gain xp when you use related commands — a fishing pet levels up when you fish. max-level pets provide significant bonuses.\n\n**tip:** match your pet to your main activity. grinding fishing? use a fishing pet."
                    }
                ]
            },
            {
                name: "skill trees",
                emoji: "🌳",
                description: "permanent upgrades, specialization paths",
                admin_only: false,
                pages: [
                    {
                        title: "skill trees overview",
                        content: "skill trees are permanent progression — spend skill points to unlock passive bonuses that persist forever. skill points are earned through leveling and completing milestones.\n\ntrees include:\n- **economy tree** — better income, bank interest, shop discounts\n- **fishing tree** — rare catch chance, better yields\n- **mining tree** — ore quality, durability\n- **luck tree** — gambling odds, rng improvements\n- **combat tree** — event/boss damage and survival\n\neach tree branches — you can't get everything, so specialize based on your playstyle."
                    },
                    {
                        title: "spending skill points",
                        content: "use `.skills` to view trees and `.skill unlock <skill>` to spend points.\n\nstrategy considerations:\n1. **pick a main focus** — spreading thin gives weak bonuses everywhere\n2. **economy tree is safe** — income boosts help everyone\n3. **activity trees boost mains** — if you fish a lot, fish tree is high value\n4. **luck is gambling-only** — skip if you don't gamble\n5. **respec is expensive** — plan before spending, rerolls cost premium currency\n\nlate-game players often have 2 maxed trees and dabble in a third."
                    }
                ]
            },
            {
                name: "challenges",
                emoji: "📋",
                description: "daily/weekly tasks, bonus rewards",
                admin_only: false,
                pages: [
                    {
                        title: "daily challenges",
                        content: "daily challenges are rotating tasks that award bonus coins and xp. check them with `.challenges` and complete them through normal play.\n\nexamples:\n- catch 10 fish\n- win 3 gambling games\n- deposit 1000 coins\n- use .work 5 times\n\nchallenges reset daily at midnight utc — complete them consistently for steady bonus income. some challenges are harder but worth more."
                    },
                    {
                        title: "weekly and special challenges",
                        content: "**weekly challenges** are larger goals that take several days — bigger rewards but require dedication.\n\n**seasonal challenges** appear during events — limited-time cosmetics and exclusive rewards.\n\n**achievement challenges** are one-time completions — rare badges and permanent bonuses.\n\ntrack all active challenges with `.challenges all` — prioritize limited-time ones before they expire."
                    }
                ]
            },
            {
                name: "passive income",
                emoji: "📈",
                description: "investments, interest, idle earnings",
                admin_only: false,
                pages: [
                    {
                        title: "passive systems",
                        content: "passive income generates coins while you're offline or not actively playing:\n\n**bank interest** — deposited coins slowly grow over time\n**investments** — lock coins for returns after a period\n**pets** — some pets generate coins passively\n**businesses** (if enabled) — purchase generators that produce income\n\npassive income is slower than active grinding but adds up over days and weeks — set it and forget it."
                    },
                    {
                        title: "maximizing passive gains",
                        content: "optimize passive income:\n\n1. **max your bank capacity** — more banked = more interest\n2. **always have investments running** — downtime wastes potential\n3. **equip income pets** — even small bonuses compound\n4. **check in daily** — claim interest, restart investments\n5. **skill tree: economy** — passive income nodes boost all idle earnings\n\nlong-term players often earn more passively than actively — setup matters."
                    }
                ]
            },
            {
                name: "world events",
                emoji: "🌍",
                description: "server-wide bosses, cooperative challenges",
                admin_only: false,
                pages: [
                    {
                        title: "world events",
                        content: "world events are server-wide occurrences that affect everyone:\n\n**bosses** — massive enemies that require collective damage to defeat, rewards based on participation\n**modifiers** — temporary global bonuses (2x fish catch, bonus xp, etc.)\n**invasions** — defend against waves for rewards\n\nevents spawn on timers or randomly — check `.events` to see what's active. participation usually requires just using normal commands while the event is live."
                    },
                    {
                        title: "boss strategy",
                        content: "boss fights reward participation:\n\n- use `.attack` or `.boss hit` to deal damage\n- damage scales with level, gear, and combat skill tree\n- top damage dealers get bonus rewards\n- everyone who participates gets base rewards\n\n**tips:**\n1. always hit bosses when they spawn — free rewards\n2. stack combat skill tree for boss damage\n3. coordinate with server members for fast kills\n4. legendary bosses drop exclusive items"
                    }
                ]
            },
            {
                name: "leveling",
                emoji: "📊",
                description: "xp, levels, rank progression",
                admin_only: false,
                pages: [
                    {
                        title: "xp and leveling",
                        content: "everything you do earns xp — commands, activities, completions. xp fills your level bar; leveling up provides:\n\n- skill points (for skill trees)\n- bank capacity increases\n- unlocks for new features/commands\n- leaderboard ranking\n- cosmetic badges/titles\n\ncheck your progress with `.level` or `.profile`. higher levels require more xp but unlock more powerful systems."
                    },
                    {
                        title: "efficient leveling",
                        content: "maximize xp gain:\n\n1. **complete challenges** — bonus xp on top of normal gains\n2. **use all cooldowns** — work, fish, mine on cooldown = steady xp\n3. **participate in events** — event xp is often boosted\n4. **daily/weekly claims** — free xp for showing up\n5. **xp boost items** — some pets/items multiply xp temporarily\n\nleveling slows down at high levels — prestige systems may reset level for permanent bonuses if enabled."
                    }
                ]
            },
            {
                name: "achievements",
                emoji: "🏆",
                description: "collection, milestones, rare accomplishments",
                admin_only: false,
                pages: [
                    {
                        title: "achievement system",
                        content: "achievements are permanent accomplishments displayed on your profile. they range from easy (catch your first fish) to incredibly difficult (catch all legendary fish).\n\ncomplete achievements for:\n- coins/item rewards\n- exclusive titles\n- profile badges\n- bragging rights\n\nview achievements with `.achievements` — progress tracks automatically. some achievements are hidden until discovered."
                    },
                    {
                        title: "hunting achievements",
                        content: "achievement hunting tips:\n\n1. **check the list** — know what exists before you grind\n2. **focus on natural play** — most achievements complete through normal activity\n3. **save rare items** — some achievements require specific collections\n4. **event achievements** — limited-time, prioritize these\n5. **prestige achievements** — extremely rare, long-term goals\n\ncompletion percentage shows on profile — 100% is a flex."
                    }
                ]
            },
            {
                name: "server setup",
                emoji: "⚙️",
                description: "admin configuration, channels, permissions",
                admin_only: false,
                pages: [
                    {
                        title: "setting up bronx",
                        content: "server admins can configure bronx using `.setup`:\n\n**logging** — set channels for economy logs, moderation actions, level-ups\n**prefix** — change the text command prefix (default: `.`)\n**modules** — enable/disable entire categories (gambling, nsfw, etc.)\n**permissions** — restrict commands to specific roles/channels\n\nmost settings have sane defaults — only configure what you want to customize."
                    },
                    {
                        title: "common configurations",
                        content: "typical server setups:\n\n**casual server:** defaults, maybe restrict gambling to one channel\n**economy server:** logging enabled, leaderboards in dedicated channel\n**strict server:** command restrictions, limited gambling, moderation logging\n\nuse `.setup guide` for interactive configuration. most commands work in any channel unless restricted."
                    }
                ]
            },
            {
                name: "anticheat",
                emoji: "🛡️",
                description: "fair play systems, alt detection",
                admin_only: false,
                pages: [
                    {
                        title: "fair play",
                        content: "bronx includes systems to maintain fair economy:\n\n**alt detection** — accounts that look like alts get flagged and limited\n**transfer limits** — suspicious transfers trigger review\n**bot detection** — automated patterns are detected and actioned\n**leaderboard protection** — inflated stats get filtered\n\nmost users never encounter these — they exist to stop exploitation, not normal play."
                    }
                ]
            },
            {
                name: "advanced tips",
                emoji: "💡",
                description: "optimization, efficiency, meta strategies",
                admin_only: false,
                pages: [
                    {
                        title: "efficiency meta",
                        content: "optimize your bronx gameplay:\n\n**cooldown management** — use alarms/reminders for important cooldowns (daily, investments, etc.)\n**batch operations** — sell all at once instead of individually\n**market awareness** — item values change with events and patches\n**specialize first** — one maxed income source beats three mediocre ones\n**compound gains** — reinvest profits into income boosts, not cosmetics"
                    },
                    {
                        title: "long-term strategy",
                        content: "playing for months/years:\n\n1. **passive income is king** — active grinding burns out, passive scales\n2. **complete collections** — rare achievements take time, start tracking early\n3. **skill trees are permanent** — plan them, don't impulse spend\n4. **join events** — limited-time rewards don't come back\n5. **don't gamble savings** — house always wins long-term\n6. **help your server** — strong servers have better events and more trades\n\nconsistency beats intensity. 10 minutes daily beats 5 hours once a week."
                    }
                ]
            },
            // Admin-only sections
            {
                name: "command management",
                emoji: "🔧",
                description: "admin: module toggles, command restrictions",
                admin_only: true,
                pages: [
                    {
                        title: "module control",
                        content: "disable entire command categories for your server:\n\n`.module disable <module>` — turn off a category (gambling, economy, etc.)\n`.module enable <module>` — re-enable a disabled module\n`.module list` — see all modules and their status\n\navailable modules: economy, gambling, fishing, mining, crafting, leveling, social, utility, moderation\n\ndisabled modules hide all their commands from `.help` and block execution."
                    },
                    {
                        title: "per-command control",
                        content: "restrict individual commands:\n\n`.cmd disable <command>` — disable a single command\n`.cmd enable <command>` — re-enable\n`.cmd restrict <command> <role>` — only allow specified roles\n`.cmd channel <command> <#channel>` — restrict to specific channels\n\nuseful for keeping gambling in one channel or restricting admin commands to staff roles.\n\nall restrictions compound — a command can be both role-restricted and channel-restricted."
                    }
                ]
            },
            {
                name: "economy tuning",
                emoji: "📉",
                description: "admin: payouts, multipliers, inflation control",
                admin_only: true,
                pages: [
                    {
                        title: "economy balance",
                        content: "adjust your server's economy:\n\n`.economy multiplier <value>` — global income multiplier (0.5 = half, 2 = double)\n`.economy startbalance <amount>` — coins new users receive\n`.economy bankinterest <percent>` — bank interest rate\n`.economy dailybonus <amount>` — base daily claim reward\n\n**warning:** increasing multipliers causes inflation — more coins but they're worth less. reduce rewards if your economy feels too easy."
                    },
                    {
                        title: "economy reset tools",
                        content: "emergency economy controls:\n\n`.economy wipe <@user>` — reset a user's balance (useful for exploiters)\n`.economy inspect <@user>` — view detailed transaction history\n`.economy rollback <@user> <hours>` — revert recent transactions\n`.economy freeze <@user>` — temporarily block all economy commands\n\nthese are destructive — use carefully. all actions are logged."
                    }
                ]
            },
            {
                name: "moderation config",
                emoji: "🔐",
                description: "admin: logging, automod, punishment settings",
                admin_only: false,
                pages: [
                    {
                        title: "moderation logging",
                        content: "set up logging for mod actions:\n\n`.setlog moderation #channel` — log kicks, bans, mutes, warns\n`.setlog economy #channel` — log transactions, suspicious transfers\n`.setlog leveling #channel` — log level-ups, achievements\n`.setlog joins #channel` — log member joins/leaves\n\nlogs include timestamps, moderator responsible, and reasons. essential for audit trails."
                    },
                    {
                        title: "automod basics",
                        content: "configure automatic moderation:\n\n`.automod spam <threshold>` — messages before mute (0 = disabled)\n`.automod links <on/off>` — block non-whitelisted links\n`.automod invites <on/off>` — block discord invite links\n`.automod caps <percent>` — max caps percentage before warning\n\nautomod actions are logged. false positives can be whitelisted. pair with manual moderation for best results."
                    }
                ]
            }
        ]
    };

    res.json(guideData);
});

module.exports = router;
