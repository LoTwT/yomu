# yomu · M1 Reading & Guided-Read Interaction Spec v1

> **Owner**: UX-Sunna. **Status**: canonical implementation contract for **task #26** (句级领读 UI); #23 (导入/分句) + #24 (TTS adapter) data output aligns to §6 / §7 here.
> **Failure-state authority**: the import failure-variant *enum* below mirrors **QA #25 gate taxonomy** (#yomu:bd744f45) — that gate is canonical; the hi-fi renders representative variants, not the full set.
> **Scope**: M1 — BYO import (paste/URL/txt·md) + English sentence split + sentence-level guided reading + MiMo adapter + 1 bundled public-domain sample. IPA = English V1; furigana = reserved slot (not rendered V1). Bilingual/prefetch fidelity completes in M2.

## 1. Product Frame

yomu = personal English **reader + sentence-level guided-read** tool. Primary path = bring-your-own article -> split into sentences -> read sentence-by-sentence (highlight + neural TTS + IPA + bilingual). When the user has no material, a public-domain fallback applies (full pool = M3; M1 ships **one** bundled sample only).

Locked decisions: Q1=A (home = 「我的阅读」, push demoted to an entry), Q2=A (public-domain direction now, land M3), Q3=A (on-demand fallback, no daily pre-gen), milestones M1 -> M2 -> M3.

## 2. Surface: 首屏「我的阅读」

### 2.1 Populated State

- Article list. Each row: cover initial, **title**, source meta, progress bar + %.
- **Source tag**: `BYO` | `公共领域` | `公共领域示例`. Visually distinct chips.
- Meta: import method (粘贴/URL/文件) + length (词数) + estimated minutes; for public-domain: source + difficulty band.
- Sort/filter segmented control: 全部 / 在读 / 读完 / 公共领域.
- Top bar: yomu wordmark · 导入 (primary) · settings.

### 2.2 Empty-State Guard

The empty state must not dead-end.

- Primary action: 「导入一篇」 -> opens import.
- Secondary entry: 「先读一篇示例(公共领域)」 -> opens the M1 bundled sample.
- Affordance row: 粘贴 / URL / txt·md as quiet hints.

### 2.3 M1 Bundled Public-Domain Sample

- M1 ships exactly **one** bundled public-domain sample so the empty-state secondary entry can land.
- Source tag must be **「公共领域示例」**, distinct from regular `公共领域` and `BYO`.
- Rights metadata hard gate: `title / author / year(or publication date) / source URL / source archive date / public-domain basis / region posture / allowed uses(TTS/cache/translation) / excerpt range(if excerpt) / provider+cache policy(if prebuilt audio)`.

## 3. Surface: Import

### 3.1 Modes

Tabs: 粘贴 / URL / 文件.

- 粘贴: textarea -> on submit, split into sentences and open reading surface.
- URL: input -> server-side fetch + readability extraction. Only `http(s)`; block `localhost` / private IP / `file:` / `data:`; enforce timeout + size limit + content-type allowlist.
- 文件: accept `.txt` / `.md` only; size cap; UTF-8 decode.
- Privacy line: text is used only for this reading; on playback the current sentence is sent to cloud TTS.

### 3.2 Import Failure Variants

The failure UI is one reusable component keyed by `variant`. The hi-fi shows representative variants; the complete branch set is canonical in QA #25. Every failure has a clear human message + recovery action, and must never persist a half-baked reading record.

| variant | trigger | recovery |
|---|---|---|
| `paste.empty` | empty submit | continue editing |
| `paste.tooShort` | below minimum readable content | continue editing |
| `paste.tooLong` | over max size | split article |
| `paste.htmlDetected` | HTML/script in text | sanitize or reject; never execute |
| `url.scheme` | non-http(s), localhost, private IP | change link or paste text |
| `url.notFound` | 404 | change link or paste text |
| `url.timeout` | timeout/unreachable | retry or paste text |
| `url.extractFailed` | readability empty | retry or paste text |
| `file.unsupported` | non-txt/md | convert or paste text |
| `file.empty` | empty file | choose another file |
| `file.tooLarge` | over size cap | choose another file |
| `file.encoding` | decode failure / not text | choose UTF-8 text |
| `content.lowEnglish` | English ratio too low / too few valid sentences | open read-only |

`content.lowEnglish` degrades to **read-only** rather than blocking.

## 4. Surface: 句级领读

### 4.1 Layout

- Top: back · title · `句 N / total · {sourceTag}` · settings.
- Body: serif reading column. Sentences flow inline within paragraphs. Paragraph order preserved.
- Bottom: pinned control bar + thin progress line.

### 4.2 Sentence States

- `done`: already read, muted.
- `cur`: current sentence, soft amber highlight + left accent edge.
- default: upcoming, normal ink.

Exactly one `cur` at a time. Advancing turns current -> done and next -> current. The view keeps the current sentence comfortably in viewport.

### 4.3 Control Bar

State axis = current sentence id.

- Controls: prev / play-pause / next / repeat + speed + 「云朗读」 cue.
- `prev`: current = previous sentence id; clamp at first.
- `next`: current = next sentence id; clamp at last.
- `play`: play current audio; on end, pause or auto-advance by setting.
- `repeat`: replay current audio; optional loop mode.
- `speed`: 0.8 / 0.9 / 1.0 / 1.1 / 1.25x.
- States: `idle | playing | paused | sentenceLoading | sentenceFailed`.

### 4.4 Per-Sentence Augment

- IPA line (English V1): monospace accent color, toggleable.
- Bilingual Chinese line: collapsible, default collapsed, lazy-loaded on expand.
- Word lookup: tap a word in the current sentence -> lightweight gloss.
- Augment is a slot: IPA today, furigana reserved for Japanese.

### 4.5 Honest Cloud Cue

「云朗读」 in the control bar means the current sentence is synthesized in the cloud. It is not decorative and must remain legible.

## 5. Privacy & Read-Only

### 5.1 First-Play Privacy Prompt

Before the first read-aloud in a session/article:

- Tell the user playback sends the **current sentence** to MiMo cloud to synthesize voice.
- State text is sent only when pressing play.
- Offer **开始朗读** and **继续纯阅读(不朗读)**.
- User remains responsible for imported content rights.

Terms-evidence rule, provider-agnostic: strong user-facing claims such as "not used for training", "retained only as needed + deletable", or "generated audio belongs to you" may appear only when the current provider's official terms are cited and still current. For MiMo V1, implementation PRs must link the official privacy policy / user agreement evidence that supports those claims. If a provider's evidence is missing, stale, or weaker, copy must degrade to the conservative form: "按所选语音服务的条款处理 · 详见隐私说明" plus the terms link. Do not carry MiMo-specific promises to a future provider by default.

### 5.2 Hard Privacy Boundaries

- The front end never holds `MIMO_API_KEY`.
- Browser network never hits `xiaomimimo.com` or `token-plan-cn.xiaomimimo.com` directly.
- TTS only goes through the yomu server-side endpoint/Worker.
- Logs/errors/evidence must not include full BYO text, provider key, or plaintext-recoverable cache keys.

### 5.3 Read-Only Degrade Mode

Entered when the user chooses pure reading, declines TTS, or content is not suitable for guided read-aloud.

- Full reader remains usable.
- No cloud requests.
- A quiet banner offers re-entry to enable TTS.

## 6. Sentence-Node Data Contract

```ts
type SentenceNode = {
  id: string
  order: number
  original: string
  paragraphIndex: number
  textHash: string
  annotations: {
    ipa?: string
    furigana?: FuriganaToken[]
  }
  bilingual?: { zh?: string }
  audio?: {
    cacheKey: string
    status: 'idle' | 'loading' | 'ready' | 'failed'
  }
}
```

- Annotation is a pluggable slot: IPA for English V1, furigana reserved for Japanese.
- One sentence's TTS failure marks only that node as `audio.status='failed'`; it never poisons the whole article.

## 7. Prefetch State Machine

On-demand TTS may be slow enough to create dead wait between sentences. Prefetch ahead:

- When current sentence = N, background-synthesize N+1 and N+2 (`idle -> loading -> ready`).
- Playing a loading node shows 「准备中…」 until ready.
- Next/previous re-anchors the prefetch window.
- Daily/bundled-sample audio may be server pre-generated; BYO uses prefetch.

QA acceptance: continuous play has no 2-6s inter-sentence dead wait; single-sentence failure is isolated and retryable.

## 8. A11y

WCAG AA verified for signature elements in light + dark:

| element | light | dark |
|---|---:|---:|
| active-sentence text on amber highlight | 11.76 | 10.36 |
| IPA teal on augment wash | 4.98 | 5.39 |
| body / bilingual text | 8.81 | 10.26 |
| 「云朗读」 cloud label | 5.56 | 4.70 |

Controls must be keyboard reachable, respect `prefers-reduced-motion`, expose visible focus, and carry meaningful aria labels.

## 9. Tokens

Reference values from the hi-fi:

- light: paper `#f7f3ea`, card `#fffdf8`, ink `#2a2521`, accent teal `#2f6f66`, active highlight `rgba(214,154,52,.20)`, active edge `#d69a34`, cloud `#6f6658`.
- dark: paper `#1c1a17`, accent `#5fb0a4`, cloud `#938979`.
- typography: content serif = Newsreader; UI = Space Grotesk/system; IPA/meta = mono.

## 10. Out of Scope for M1

- Full public-domain pool + difficulty filtering -> M3.
- End-to-end delete-chain proof -> M3.
- IPA/bilingual/prefetch full fidelity + word gloss -> M2.
- Japanese furigana rendering -> reserved slot only.
