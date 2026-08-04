# Yomu v2 Stage 1 Design QA

**Findings**

- No actionable P0, P1, or P2 differences remain in the approved Stage 1 scope.
- [P3] The approved board only provides the Paper state. Ink therefore has no direct dark-source equivalent; it was checked for token consistency, contrast, hierarchy, and responsive parity instead of pixel fidelity.
- [P3] The approved responsive board compresses its three labeled device captures into presentation panels. The implementation keeps accessible type and touch targets, so the mobile capture shows fewer article rows above the fold than the compressed board while preserving the same information order and interaction model.

**Comparison Target**

- Source visual truth: `yomu-ui-approved-responsive.png`
- Source pixels: `1487 × 1058`; the board labels its embedded targets as Desktop `1440 × 1024`, Tablet `834 × 1194`, and Mobile `390 × 844`.
- Implementation route: `http://127.0.0.1:4174/`
- Implementation captures:
  - Paper: `design-qa-evidence/final-paper-1440x1024.jpg`, `design-qa-evidence/final-paper-834x1194.jpg`, `design-qa-evidence/final-paper-390x844.jpg`
  - Ink: `design-qa-evidence/final-ink-1440x1024.jpg`, `design-qa-evidence/final-ink-834x1194.jpg`, `design-qa-evidence/final-ink-390x844.jpg`
- CSS viewport / screenshot pixels / density: each implementation capture is `1 CSS px = 1 image px` at device scale factor 1; screenshot pixel dimensions exactly match the named viewport.
- Normalization: the source is a packed presentation board rather than three raw viewport exports. Full-view comparisons keep the complete board visible, while focused comparisons crop the relevant source panel and implementation region and preserve each crop's aspect ratio. No pixel-delta claim is made across the board's presentation scaling.
- States: signed-out local library, stable fixture data, scroll position 0; Paper and Ink checked independently.

**Full-view Comparison Evidence**

- Paper responsive comparison: `design-qa-evidence/comparison-responsive-paper.jpg`
- Ink responsive comparison: `design-qa-evidence/comparison-responsive-ink.jpg`
- Desktop source/implementation comparison: `design-qa-evidence/comparison-wide-desktop.jpg`
- Result: desktop keeps the approved wide continue card and two-column article grid; tablet keeps the compact top navigation and one-column rows; mobile keeps the compact header, list rows, and fixed bottom navigation. No horizontal overflow was present at `320`, `390`, `834`, `1199`, `1200`, or `1440` CSS pixels.

**Focused Region Comparison Evidence**

- Continue-reading hierarchy and typography: `design-qa-evidence/comparison-focus-continue-paper-v2.jpg`
- Desktop article grid, metadata, progress, and density: `design-qa-evidence/comparison-focus-articles-paper-v2.jpg`
- Mobile header, continue card, rows, and bottom navigation: `design-qa-evidence/comparison-focus-mobile-paper-final.jpg`
- Result: section order, serif/sans hierarchy, card boundaries, metadata, semantic progress, action prominence, line icons, and navigation placement match the approved direction. The implementation deliberately uses larger readable mobile text and touch targets than the compressed source panel.

**Required Fidelity Surfaces**

- Fonts and typography: display titles use the theme's editorial serif stack; navigation, metadata, and controls use the theme UI stack. Weight, wrapping, line height, hierarchy, and truncation were checked at all three target widths.
- Spacing and layout rhythm: containers, section gaps, card padding, radii, grid tracks, fixed mobile navigation, and safe-area padding remain stable. At `1199px` articles are one column; at `1200px` they become exactly two columns.
- Colors and tokens: Paper uses the approved warm paper, ink, rule, and violet accent direction through `@ayingott/theme`; Ink maps the same semantic roles to dark surfaces with readable contrast and visible focus rings.
- Image and asset fidelity: this screen has no photographic or illustrative assets. All visible UI icons use the Phosphor icon package; no emoji, text-glyph substitutes, handcrafted SVG, or placeholder assets remain.
- Copy and content: titles, summaries, levels, sources, durations, progress, recency, and recommendation content match the approved board. Unsupported fixtures are explicitly labeled `尚未接入` and never open the Today article by mistake.
- Accessibility and interaction: semantic headings/regions/progress bars, skip link, keyboard focus, `aria-pressed`, route-heading focus, touch targets, safe-area handling, and overflow guards were verified.

**Comparison History**

| Iteration | Earlier finding | Fix made | Post-fix evidence |
| --- | --- | --- | --- |
| P1 | Mobile bottom navigation was pinned near the top because backdrop filtering changed its containing behavior. | Limited blur/backdrop treatment to viewports at or above `768px`; retained the mobile nav as a true viewport-bottom control with safe-area padding. | `implementation-paper-390x844-iteration2.png`; final mobile focused comparison above. |
| P2 | Native green progress bars, missing line icons, action-order drift, and loose density diverged from the approved visual. | Added semantic custom progress styling, Phosphor icons, stable action order, and breakpoint-specific density/grid rules. | `implementation-paper-390x844-iteration3.png`; final Paper comparisons above. |
| P2 | Desktop vertical spacing pushed the recommendation region below the intended capture. | Tightened section gaps and card density without reducing control targets. | `final-paper-1440x1024.jpg`; the document scroll height is `1025px` for a `1024px` viewport (rounding only). |
| P1 | Every fixture article could route into the same Today reader, creating false content identity. | Routed only the stable Today ID to the reader and added a dedicated unavailable state for non-backed fixtures. | Browser route checks: `/unavailable/power-of-small-habits` contains `尚未接入` and no Today body; the stable `/read/daily-en-2026-05-25-why-the-brain-loves-sleep` route starts the real reader. |
| P1 | Provider Key controls and persistence behavior were split across legacy and new settings. | Unified controls in Settings, injected `SecretStore`, defaulted keys to session-only, required explicit device persistence, and cleared keys/consent/cache when disabled. | Browser lifecycle check passed for session, remembered-device reload, disable-and-clear, and clean default restoration. |
| P1 | A legacy serialized `yomu:v2:secret:*` value could be unwrapped and loaded, while the “please re-enter” notice existed for only one startup. | Legacy wrappers are now deleted without hydration; a non-sensitive pending notice marker persists until the user explicitly acknowledges it in Settings. | `platformServices.test.ts` and `providerSettingsView.test.ts`; migration restart and acknowledgement cases pass without exposing secret content. |
| P1 | Session-only Provider Keys could survive a background/suspended lifecycle event, including a pending-write race. | Added `SecretStore.clearSession()`, lifecycle redaction, ordered session cleanup, and device-only restoration gated by an explicit `remember === true`; AI consent never restores. | `providerSettingsLifecycle.test.ts`: orphan, pending-write, background/suspended, and remembered-device cases pass. |
| P1 | Desktop/mobile shell builds still emitted the browser-only Legacy reader and relative Provider API paths. | Compile-time route pruning removes Legacy/provider chunks from shell targets; URL import, MiMo, and AI now use `RemoteServicesAdapter`; static and output-level gates reject relative API leakage. | Three-target build smoke passes and asserts Web retains all three remote mappings while desktop/mobile contain no Legacy/provider modules or `/api/` strings. |

**Primary Interactions Tested**

- Navigation to My Reading, Saved Words, Import, and Settings; each destination focuses its level-one heading.
- Continue Reading opens the stable Today route; `Start reading` reveals the article, word controls, assistive display options, and sentence playback controls.
- Unsupported article links open a truthful unavailable state.
- Paper/Ink switching persists and updates the root theme before rendering.
- MiMo Key entry, explicit remember-on-device, reload restoration, provider disable, reload, and secret removal.
- Session-only Key removal on reload plus fake lifecycle coverage for background/suspended cleanup and explicit device-only restoration.
- Compact `320 × 568`, Mobile `390 × 844`, Tablet `834 × 1194`, boundary `1199/1200`, and Desktop `1440 × 1024` layouts.
- Browser console errors/warnings after the route, theme, and settings flows: none.

**Implementation Checklist**

- [x] Approved responsive structure implemented.
- [x] Paper and Ink theme states implemented with `@ayingott/theme`.
- [x] Core navigation, Continue Reading, reader start, settings, and key lifecycle functional.
- [x] P0/P1/P2 findings fixed and recaptured.
- [x] Typecheck, 125 unit tests across 18 files, platform-boundary check, and all three target build smokes passed.

**Open Questions**

- None blocking Stage 1. A dedicated Ink visual source could support a later color-fidelity pass, but the current dark state is production-usable and does not block this build.

**Follow-up Polish**

- If a raw, uncompressed device export becomes available, rerun pixel-level typography and vertical-density comparison against that artifact.

final result: passed
