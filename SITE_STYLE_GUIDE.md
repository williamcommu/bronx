# bronx site style guide

the web dashboard follows the same principles as the bot: modern, minimal, soft. this documents the unified design system shared across dashboard, servers, and owner pages.

the landing page (`index.html` / `style.css`) is independent — it has its own vibe and doesn't share these tokens.

---

## philosophy

- **dark-first, always.** `#0a0a0a` base, elevated surfaces just barely lighter. no light mode.
- **tokens over hardcoding.** every color, radius, shadow, and transition lives in `:root`. if you're typing a raw hex in a rule, stop and make a variable.
- **system fonts.** no external font loads, no CDN calls, no FOUT. the system stack handles it.
- **glassmorphism where it earns it.** cards and overlays get blur + translucency. don't slap `backdrop-filter` on everything.
- **consistency across pages.** dashboard, servers, and owner share the same `:root` tokens. if you change one, change all three.

---

## font stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
```

set on `:root` in dashboard.css, on `body` in servers.css and owner.css. no `'Inter'`, no google fonts, no `@font-face`. the system handles it.

---

## color tokens

### surfaces

| token | value | use |
|---|---|---|
| `--bg` | `#0a0a0a` | page background, the void |
| `--bg-raised` | `#111113` | cards, sidebar, topnav |
| `--bg-raised-2` | `#18181b` | nested surfaces, inputs, hover states |
| `--bg-raised-3` | `#1c1c1f` | tertiary elevation, deeper nesting |

### text

| token | value | use |
|---|---|---|
| `--fg` | `#e4e4e7` | primary text — zinc-200, slightly dimmer than pure white |
| `--fg-muted` | `#a1a1aa` | secondary text, descriptions |
| `--fg-dim` | `#71717a` | tertiary text, placeholders, hints |

### accent

| token | value | use |
|---|---|---|
| `--accent` | `#b4a7d6` | primary accent — the lavender. buttons, links, active states |
| `--accent-hover` | `#c9bfe0` | lighter lavender for hover states |
| `--accent-muted` | `rgba(160,153,190,0.78)` | translucent accent for subtle highlights |
| `--accent-glow` | `rgba(180,167,214,0.15)` | focus rings, glow effects, badges |

### borders

| token | value | use |
|---|---|---|
| `--border` | `rgba(255,255,255,0.06)` | default borders — alpha-based, not hex |
| `--border-hover` | `rgba(255,255,255,0.12)` | hover state borders |
| `--border-accent` | `rgba(180,167,214,0.25)` | accent-tinted borders for active/focused elements |

alpha-based borders are intentional. they adapt to whatever surface they sit on — no weird edge lines when backgrounds shift.

### semantics

| token | value | use |
|---|---|---|
| `--success` | `#22c55e` | green-500 — confirmations, online status |
| `--danger` | `#ef4444` | red-500 — errors, destructive actions |
| `--warning` | `#f59e0b` | amber-500 — cautions |
| `--info` | `#3b82f6` | blue-500 — informational |

---

## spacing & radii

### radii

| token | value | use |
|---|---|---|
| `--radius-sm` | `0.5rem` | small chips, badges, tags |
| `--radius` | `0.75rem` | buttons, inputs, cards — the default |
| `--radius-lg` | `1rem` | large cards, modals |
| `--radius-xl` | `1.25rem` | hero sections, prominent containers |

all rem-based. no px radii.

### shadows

| token | value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` |
| `--shadow` | `0 4px 12px rgba(0,0,0,0.3)` |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,0.4)` |

shadows are subtle on dark backgrounds. they mostly show up on elevated overlays and dropdowns.

---

## transitions

| token | value | use |
|---|---|---|
| `--transition` | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` | default for hover, focus, color changes |
| `--transition-slow` | `0.35s cubic-bezier(0.4, 0, 0.2, 1)` | sidebar collapse, panel slides |

always use the cubic-bezier easing. no `ease`, no `linear`, no bare `0.15s`. the curve gives everything a slight deceleration that feels intentional.

---

## components

### buttons

```css
.btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition);
    border: 1px solid transparent;
    white-space: nowrap;
}
```

rules:
- `font-weight: 600` always. not 500, not 700.
- `font-family: inherit` always. buttons must not reset the font.
- `transition: all var(--transition)` — use the token.
- primary buttons use `--accent` background with `#0a0a0a` text.
- outline buttons use transparent background with `--border` and lighten on hover.
- destructive buttons use translucent red: `rgba(239,68,68,0.15)` bg, `--danger` text.

### inputs

```css
.input {
    padding: 0.55rem 0.75rem;
    background: var(--bg-raised-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    font-size: 0.82rem;
    font-family: inherit;
    outline: none;
    transition: border-color var(--transition);
}

.input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
}
```

the focus ring (`box-shadow: 0 0 0 3px var(--accent-glow)`) is mandatory on all pages. it's the only way users know an input is focused in a dark UI.

### cards

cards use glassmorphism on dashboard, simpler solid backgrounds on servers/owner:

```css
/* dashboard style */
background: var(--card-bg);        /* rgba(17,17,19,0.6) */
backdrop-filter: var(--glass-blur); /* blur(20px) */
border: 1px solid var(--card-border);

/* simpler style */
background: var(--bg-raised);
border: 1px solid var(--border);
```

both are acceptable. use glassmorphism when there's a gradient or image behind the card. use solid when the background is flat.

### toasts

```css
.toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
```

toasts always appear **bottom-right**. `bottom: 1.5rem; right: 1.5rem;`. not top, not center. consistent across all pages.

### scrollbars

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 100px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
```

thin, dark, unobtrusive. every page includes these.

---

## layout patterns

### topnav

- sticky, `z-index: 100`, `backdrop-filter: blur(12px)`.
- brand on the left, user chip on the right.
- `0.75rem 2rem` padding, collapses to `0.75rem 1rem` on mobile.

### sidebar (dashboard only)

- `260px` expanded, `64px` collapsed.
- transitions use `--transition-slow`.
- collapsible via a toggle button.

### content areas

- max-width containers centered with auto margins.
- padding: `2rem` on desktop, `1rem` on mobile.
- consistent `gap` using multiples of `0.25rem`.

---

## responsive breakpoints

| breakpoint | target |
|---|---|
| `max-width: 900px` | tablet — grid columns collapse |
| `max-width: 768px` | sidebar collapses (dashboard) |
| `max-width: 640px` | mobile — single column, reduced padding |

---

## don'ts

- **don't load external fonts.** no google fonts, no CDN, no `@font-face`.
- **don't use hex borders.** use `rgba(255,255,255,0.06)` — alpha adapts to any surface.
- **don't use px for radii.** everything is rem.
- **don't hardcode transitions.** use `var(--transition)` or `var(--transition-slow)`.
- **don't use `ease` or `linear` easing.** the cubic-bezier curve is the standard.
- **don't put toasts at the top.** bottom-right, always.
- **don't mix design systems.** if a page uses `:root` tokens, every value comes from those tokens.
- **don't forget `font-family: inherit` on buttons and inputs.** they reset otherwise.
- **don't use `--fg` for muted text.** that's what `--fg-muted` and `--fg-dim` are for.
