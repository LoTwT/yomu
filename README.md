# Yomu

Local-first English reading library.

Yomu lets readers bring English content into a private library on the current device, read sentence by sentence, use local read-aloud when available, and resume from the saved sentence without an account.

## Current scope

The v2 implementation currently includes:

- responsive Paper / Ink application shell built with `@ayingott/theme`;
- IndexedDB-backed `ArticleRecord`, `ReadingAttempt`, and vocabulary repositories;
- pasted-text and UTF-8 TXT / Markdown file parsing, editable preview, atomic save, body-hash deduplication, and a real local library;
- canonical reader routing with sentence position and active-time persistence;
- Web/PWA, desktop-shell, and mobile-shell target builds behind `PlatformServices` boundaries;
- explicit `/legacy` access to the Today compatibility reader while Reader v2 is developed.

URL Beta is the next Stage 2 slice. Accounts, cloud sync, SRS, PDF / Word import, recorder / ASR, and pronunciation scoring are outside the v2 scope.

The library is isolated per browser profile or app installation. It does not automatically appear on another device.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm check:boundaries
pnpm check:build-targets
CI=1 pnpm test:e2e
pnpm verify
```

## Deploy

Yomu deploys as a Cloudflare Workers Static Assets app.

```bash
pnpm build
pnpm deploy
```

Production route: `yomu.ayingott.me`.
