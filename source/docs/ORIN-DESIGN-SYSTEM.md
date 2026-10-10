# ORIN design system

## Preserve the approved Light appearance

`LightThemeTokens` and `DarkThemeTokens` are separate exports in `lib/theme-tokens.ts`. Existing Light CSS and the original in-app mark remain unchanged. Never tune Light variables to improve Dark Mode. `app/orin-identity.css` adds dark-only overrides and styles for new pages; the main home, market, trade and account compositions retain their original Light styles.

`tests/light-baseline.json` records SHA-256 hashes from the original local checkout before this work. Run `node --experimental-strip-types tests/theme.test.mjs` to protect these files and check dark text contrast. This guard does not replace screenshot regression testing. Full screenshot comparison with the original layout is still pending: the browser policy blocked the baseline capture. Do not call that check passed.

## Dark colors

| Token | Color | Use |
|---|---|---|
| Background | `#06111F` | Outer canvas |
| Surface | `#0B192A` | Cards and pages |
| Elevated | `#102238` | Controls and raised surfaces |
| ORIN Blue | `#0788FF` | Identity, focus and active indicators |
| Electric Cyan | `#19B8FF` | Limited selected accents |
| Primary text | `#F5F9FF` | Financial values and headings |
| Secondary text | `#A8B6C8` | Descriptions, labels, placeholders |
| Muted | `#718198` | Decorative information only; avoid small essential text |
| Positive | `#16C79A` | Profit with a sign or label |
| Negative | `#FF4D5E` | Loss with a sign or label |
| Warning | `#F5B942` | Important caution |
| Border | `rgba(168,182,200,.16)` | Subtle separators |

The dark primary button uses a darker blue gradient (`#065CA8` → `#066AC4`) so white normal-size text clears 4.5:1. Branding still uses the requested primary blue. Tested primary/secondary/status colors clear 4.5:1 on the three dark surfaces. Decorative muted color is not an accessible substitute for secondary text.

## Type, spacing and components

- Keep the existing IBM Plex Sans Arabic font, weights, Light spacing and number layout. Its license remains in `public/fonts/OFL.txt`.
- New page headings: 25px, weight 600; body/controls: 14–15px; explanatory text: 13–14px with generous line height. Font size preferences scale the new settings content. Preserve readable numbers with explicit signs and labels.
- New page padding: 22px, 14px on very narrow screens. Content max width: 560px. Rows have a 74px minimum height; back buttons are 44×44px.
- Inputs/buttons use 10–12px corners; notification cards use 16px. Borders are subtle and glow is limited to active navigation, primary actions and the brand mark.
- Icons use Lucide with visible labels or accessible names. Android status-bar notification icons are monochrome; app icons are full-color.
- New pages have an explicit heading, visible back control, keyboard focus, and an inert background. Errors use a clear message and retry; important successes have a dedicated page. Empty states use a simple category icon and an explanation.

## Navigation and links

`OrinNavigation` owns browser history and `popstate`. Major sections use stable URLs; settings subsections render full-screen pages. A catch-all page supports direct entry and refresh. The back control uses history with a section fallback. Login URLs retain the allowlisted destination through `return_to`.

Examples: `/settings/appearance`, `/settings/security`, `/settings/two-factor`, `/settings/authenticator`, `/notifications`, `/admin/notifications`, `/contracts/:id`, `/transactions/:id`, `/referral`, `/agent`, `/support`.

Use `safeDestination` for notification/admin destinations. It rejects foreign origins, protocol-relative URLs, traversal and unknown paths. Destination records still require backend ownership and eligibility checks. Native Android Back and iOS swipe behavior require device testing in an actual native shell.

## Notifications

Categories: opportunity, financial, security, announcement, reminder, referral, support. Each item shows icon, title, message, timestamp and read state. Color is not the only unread signal. The backend owns visibility, expiry and unread totals; per-user read records synchronize across devices. Polling refreshes while visible and on focus. Individual notification details resolve by ID, including notices beyond the first page.

The bell shows the backend count. Browser App Badging is best-effort where supported. It is not evidence of native badge support. Marketing consent defaults off. Required security notices remain available independently of marketing and general notification preferences. Disabling security sound does not suppress security messages.

Admin campaigns require an administrator, a saved draft, recipient preview and explicit confirmation. Supported targeting: country, eligibility tier, language and selected user IDs. Delivery currently creates in-app announcements only. Start/expiration fields are validated. An unattended scheduler, agent/verified targeting and external push delivery are not implemented in this revision; the UI states these limits.

## Chart

Use the supported TradingView embed options, dark navy background, restrained grid and clear price/time axes. Keep the provider's required attribution. Legend/OHLC/volume/top toolbar are hidden through supported configuration only. ORIN controls symbol, timeframe, type and allowed studies. Never inspect or rewrite a provider iframe to remove licensing elements. No synthetic market data is generated.

## Motion, loading, sound and haptics

New full-page entry is 160ms. Ring loading is lightweight. Installed standalone mode may show a 650ms brand transition; it does not wait on data or play sound. `prefers-reduced-motion` and the saved preference disable new animation.

Original synthesized assets are in `public/audio`: Standard (0.78s), Opportunity (0.95s), Security (1.1s), Sonic Logo (1.85s). They share one restrained tonal family. The sonic logo is reserved for branding, never button presses. WAV, OGG and CAF exports are included with the generation source.

Web previews play only after explicit user input. Automatic browser sound is intentionally inactive because the site cannot reliably inspect system silent/DND status. Native integration must use system notification channels/categories, honor system permissions, respect user mute/DND, and avoid critical-alert bypasses. Vibration is opt-in, feature-detected, skipped while hidden or under reduced motion, and used sparingly for selection/success/warning.

## Assets and delivery gates

See `public/brand/README.md` and `public/audio/README.md`. These assets and preferences do not constitute Android/iOS apps. Before release: complete screenshot regression at matching viewports and data, test keyboard/screen reader/large text on the final pages, and test native notification delivery, channels, badges, audio and back gestures on real devices after the native/Firebase/APNs integrations exist.
