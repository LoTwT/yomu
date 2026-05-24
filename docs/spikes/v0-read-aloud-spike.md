# Yomu V0 TL Spike — One Article

Status: implementation spike for task #2.

## Scope

Validate the V0 technical core with one local article fixture:

1. Sentence-first article schema with stable sentence ids, auditable metadata, rights metadata, translations, IPA word annotations, and sentence audio refs.
2. In-page read-aloud player with active sentence state, soft highlight, previous / next / repeat, and 0.85 / 1.0 / 1.15 playback-rate control.
3. Assistive display toggles for sentence translation and word-level IPA, both off by default; translation toggle enables on-demand sentence translation reveal, and IPA renders as ruby with `<rt aria-hidden="true">`.
4. Local storage for display preferences and explicit completion records.

Recorder / ASR / pronunciation feedback are intentionally out of V0 and belong to a V1 spike.

## Component Map

- `App.vue`: composition surface for fixture article, display preferences, read-aloud session, and completion storage.
- `TodayCard.vue`: today's article entry card and completed-state affordance.
- `ArticleReader.vue`: sentence-node renderer, active sentence visual state, translation reveal, and explicit completion action.
- `SentenceText.vue`: token renderer and IPA ruby display; no HTML string assembly.
- `AssistiveDisplayControls.vue`: two independent scaffold toggles grouped as assistive display.
- `ReadAloudControls.vue`: in-page player controls and calm live status.
- `CompletionPanel.vue`: local completion summary and lightweight vocabulary recap.
- `useReadAloudSession.ts`: player state machine and sentence queue abstraction.
- `practiceStorage.ts`: localStorage boundary for preferences and completion records.

## Acceptance Criteria

- **AC-TL-1 Schema**: `DailyArticle` fixture has stable sentence ids, structured `tokens[].ipa`, sentence `audioRef`, rights metadata, fact sources, and QA status. No sentence body or annotation is stored as HTML.
- **AC-TL-2 Player**: clicking Play activates the first sentence without changing screens; sentence end advances to the next sentence; previous / next / repeat keep state deterministic; playback rate is configurable.
- **AC-TL-3 Highlight**: the active sentence is represented in the DOM with `aria-current="true"` and a soft visual state.
- **AC-TL-4 Scaffolds**: translation and IPA are off by default; each can be toggled independently; translation mode reveals only tapped sentences rather than the whole article; IPA is rendered through Vue templates as ruby with screen-reader-hidden `<rt>`.
- **AC-TL-5 Storage**: preferences and explicit completion records persist in localStorage; invalid preference storage falls back to defaults.
- **AC-TL-6 V0 boundary**: no microphone permission, recorder object, ASR upload, analytics, or remote content generation is introduced by this spike.

## Verification

Run:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
CI=1 pnpm test:e2e
git diff --check origin/main...HEAD
```
