# Yomu

Daily read-aloud language practice app.

Yomu is a miru-adjacent PWA for one daily target-language article with sentence-level lead voice, soft active-sentence highlighting, optional bilingual support, and pronunciation annotations.

## V0 Spike

This repo currently contains the first technical spike for the V0 core:

- sentence-first article schema with rights/source metadata;
- in-page read-aloud state machine and active sentence highlighting;
- assistive display toggles for on-demand translation and IPA ruby;
- local completion/preference storage.

Recorder / ASR / pronunciation scoring are intentionally out of V0.

## Commands

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
CI=1 pnpm test:e2e
```
