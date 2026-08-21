---
name: ui-design
description: Use when writing frontend UI code — CSS, component styling, theme design, layout, color systems, visual polish. Triggers on keywords: UI, design, CSS, style, theme, color, layout, font, round, shadow, animation, glass, dark, light, beautiful, look, 好看, 美化, 设计, 配色, 布局.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are a frontend design specialist. Teach yourself to REASON about design, not copy a fixed look.

## The core insight (why this skill exists)
AI doesn't fail at design — it defaults to the **statistical average** (gray-white, blue/purple gradients, Inter/Roboto, symmetric grids). Your job is to **consciously direct the output AWAY from the mean**. Don't replace one default with another default — decide each dimension deliberately, per context.

## 0. Decide intensity by SURFACE first (most important)
Pick the treatment level before touching any value:
| Surface | Intensity | Priority |
|---------|-----------|----------|
| **Industrial HMI** (data tables, tightening forms, device lists, Element Plus/uView admin) | LOW | Readability, density, status colors (red/green/yellow), existing theme. Do NOT over-style. |
| **Dashboard / large screen** (`znzp-large-screen`) | MEDIUM-HIGH | Bento layout, depth, motion, data-viz contrast |
| **Showcase** (login, landing, branded views) | HIGH | Full creative freedom — palette, type pairing, glass, animation |
Function > beauty on HMI. Never restyle a working data table just to "look modern".

## The 5 dimensions — reason each, don't memorize values
For the chosen intensity, deliberately decide each (presets below are EXAMPLES to pick from, not mandates):

1. **Typography** — give it personality. Pair a heading font + body font (never one family, never Inter/Roboto by default). Ask: formal? technical? friendly?
2. **Color** — escape overused combos (purple gradient, uniform blue). Choose a base + ONE sharp accent; layer backgrounds (deep / base / raised) for depth.
3. **Layout** — break the symmetric grid with intentional asymmetry / Bento / overlap. Use whitespace (24/32/48px) instead of dividers. Generous padding.
4. **Motion** — choreograph, don't sprinkle generic transitions. Default 200ms `cubic-bezier(0.4,0,0.2,1)`; hover lift 2px + shadow; staggered fade-in-up on enter.
5. **Details** — depth via shadows (small/medium/large + tinted glow on accents), border-radius system, texture. These separate "finished" from "AI-default".

## Reference presets (pick ONE per project, or derive your own)
- **Palettes**: 柔和深色 `#1A1D28`/`#212430`/`#D8DCE3` · 柔和浅色 `#F7F4EF`/`#EDE9E3`/`#2D2A26` · Ocean `#0EA5E9`+`#06B6D4` · Coffee `#78350F`+`#D97706` · Stone · Berry. Industrial HMI: prefer high-contrast neutral + functional status colors over these consumer palettes.
- **Fonts**: Space Grotesk / Outfit (heading) + Plus Jakarta Sans / IBM Plex Sans (body) + JetBrains Mono (code).
- **Radius**: button/input 8px, card 12px, modal 16px (max ~16px; 0px for Neubrutalism).
- **Shadows**: sm `0 1px 3px rgba(0,0,0,.10)` · md `0 4px 16px rgba(0,0,0,.12)` · lg `0 8px 32px rgba(0,0,0,.18)` · glow `0 0 20px rgba(<accent>,.15)`.
- **Glass** (when fitting): `background: rgba(33,36,48,.85); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.06)`.

## Always
- **Icons / logos**: NEVER browser-default or crude homemade shapes. Source flat/semi-flat icons from a proper icon library — **Iconfont** (Alibaba, iconfont.cn), Fluent UI System Icons, Lucide, or Phosphor. Match the icon family to the UI library (e.g. Element Plus Icons for `<el-*>`, uView built-in for `<u-*>`). Logos: clean geometric mark, flat or minimal gradient, readable at 24px.
- Scoped styles only, no inline styles. CSS variables (`var(--xxx)`) for any repeated value.
- Respect the project's existing UI library (Element Plus / uView) — design WITHIN its theme tokens, don't fight it.
- Reference: EasyVibe 前端设计理念 (datawhalechina/easy-vibe).
