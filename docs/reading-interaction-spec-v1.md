# yomu · M1 Reading & Guided-Read Interaction Spec v1

> **Owner**: UX-Sunna. **Status**: canonical implementation contract for **task #26** (句级领读 UI); #23 (导入/分句) + #24 (TTS adapter) data output aligns to §6 / §7 here.
> **Failure-state authority**: the import failure-variant *enum* below mirrors **QA #25 gate taxonomy** (#yomu:bd744f45) — that gate is canonical; the hi-fi renders representative variants, not the full set.
> **Hi-fi reference**: `/tmp/yomu-hifi/mock.html` (core) + `mock2.html` (failure/privacy/degrade), rendered desktop + 375 mobile + dark.
> **Scope**: M1 — BYO import (paste/URL/txt·md) + English sentence split + sentence-level guided reading + **TTS provider layer: Web Speech (default, no key) + MiMo BYOK** (provider registry; OpenAI/etc reserved M2+) + 1 bundled public-domain sample. IPA = English V1; furigana = reserved slot (not rendered V1). Bilingual/prefetch fidelity completes in M2.
> **v1.1 update (provider model)**: §5.4 rewritten to the Web Speech floor + BYOK upgrade model (guided-read never dead-ends; only MiMo-selected-without-key disables the *neural* tier). §4.5 cue is provider-aware. §4.3 adds `ttsUnavailable`.

---

## 1. Product frame
yomu = personal English **reader + sentence-level guided-read** tool. Primary path = bring-your-own article → split into sentences → read sentence-by-sentence (highlight + neural TTS + IPA + bilingual). When the user has no material, a public-domain fallback applies (full pool = M3; M1 ships **one** bundled sample only).

Locked decisions: Q1=A (home = 「我的阅读」, push demoted to an entry), Q2=A (public-domain direction now, land M3), Q3=A (on-demand fallback, no daily pre-gen), milestones M1→M2→M3.

---

## 2. Surface: 首屏「我的阅读」(home / library)

### 2.1 Populated state
- Article list. Each row: cover initial, **title**, source meta, progress bar + %.
- **Source tag** (required, drives M3 rights gate + user trust): `BYO` | `公共领域` | `公共领域示例` (see §2.3). Visually distinct chips.
- Meta: import method (粘贴/URL/文件) + length (词数) + est. minutes; for public-domain: source + difficulty band (A2–B1 / B1–B2).
- Sort/filter segmented control: 全部 / 在读 / 读完 / 公共领域. Tapping a row opens the reading surface (§4) at the saved sentence.
- Top bar: yomu wordmark · 导入 (primary) · settings.

### 2.2 Empty-state guard (first run / empty library) — REQUIRED
Rationale: home is BYO-first (Q1A) + fallback is on-demand (Q3A) → a new user would otherwise open to an empty void. The empty state MUST NOT dead-end.
- **Primary action**: 「导入一篇」→ opens import (§3).
- **Secondary entry**: 「先读一篇示例(公共领域)」→ opens the **M1 bundled sample** (§2.3). This is why the sample must exist in M1.
- Affordance row: the three import methods (粘贴 / URL / txt·md) as quiet hints.
- Copy: warm, low-pressure ("从一篇你想读的开始").

### 2.3 M1 bundled public-domain sample (scoping requirement)
- M1 ships exactly **one** bundled public-domain sample so the empty-state secondary entry can land. The full public-domain pool + difficulty filtering remain **M3**.
- **Source tag MUST be「公共领域示例」** — distinct from regular `公共领域` and from `BYO` — so users do not believe the daily/public pool is already live.
- Rights metadata (hard gate, per QA #25 M1 addendum): `title / author / year(or publication date) / source URL / source archive date / public-domain basis / region posture / allowed uses (TTS/cache/translation) / excerpt range (if excerpt) / provider + cache policy (if prebuilt audio)`.

---

## 3. Surface: Import

### 3.1 Modes
Tabs: **粘贴** / **URL** / **文件**. English first (Japanese later — do not hard-code English in the pipeline; see §6 annotation slot).
- 粘贴: textarea → on submit, split into sentences (§6) and open reading surface.
- URL: input → server-side fetch + readability extraction. Only `http(s)`; block `localhost`/private-IP/`file:`/`data:` (SSRF); enforce timeout + size limit + content-type allowlist.
- 文件: accept `.txt` / `.md` only; size cap; UTF-8 decode.
- Privacy line under the field: text is used only for this reading; with a cloud provider, playback sends the current sentence and a small prefetch window of upcoming sentences to cloud TTS — see §5 / §7.

### 3.2 Import failure variants — `<ImportError variant>` (enum = QA #25 taxonomy)
The failure UI is **one reusable component** keyed by `variant`. The hi-fi shows 6 representative variants; the **complete branch set is canonical in QA #25**. Every failure: a clear human message + recovery action(s); **never persist a half-baked reading record**.

| variant | trigger (QA #25) | copy intent | recovery |
|---|---|---|---|
| `paste.empty` | empty submit | "粘贴点内容再开始" | 继续编辑 |
| `paste.tooShort` | < min sentences | "内容太短,先攒几句" | 继续编辑 |
| `paste.tooLong` | > max size | "这篇有点长,分两次导入" | 截断/分段 |
| `paste.htmlDetected` | HTML/script in text | silently sanitized; never executed (no `v-html`/`innerHTML`) | (cleaned, proceeds) |
| `url.scheme` | non-http(s) / localhost / private-IP | "出于安全,只读取公开 http(s) 网页,不支持本地/内网地址" | 换链接 / 改用粘贴 |
| `url.notFound` | 404 | "没找到这篇文章" | 换链接 / 改用粘贴 |
| `url.timeout` | timeout / unreachable | "链接没有响应" | 重试 / 改用粘贴 |
| `url.extractFailed` | readability empty (login/dynamic) | "取不到正文(可能需登录或是动态页面)" | 重试 / 改用粘贴 |
| `file.unsupported` | non-txt/md (PDF/Word…) | "PDF 暂不支持。先转成 txt/md,或粘贴正文" | 粘贴正文 / 重新选文件 |
| `file.empty` | empty file | "这个文件是空的" | 重新选文件 |
| `file.tooLarge` | > size cap | "文件超出大小上限" | 重新选文件 |
| `file.encoding` | decode fail / not text | "这段文本读不出来(换 UTF-8 的 txt/md)" | 重新选文件 / 改用粘贴 |
| `content.lowEnglish` | English ratio too low / too few valid sentences | "这篇英文太少,逐句领读可能不准" | **只读打开**(§5.3) / 换一篇 |

`content.lowEnglish` degrades to **read-only** (§5.3) rather than blocking — the user can still read.

---

## 4. Surface: 句级领读 (sentence-level guided reading)

### 4.1 Layout
- Top: back · title (ellipsis) · `句 N / total · {sourceTag}` · settings.
- Body: serif reading column. Sentences flow inline within paragraphs. Paragraph order preserved.
- Bottom: pinned **control bar** (§4.3) + thin progress line.

### 4.2 Sentence states
- `done` — already read (muted).
- `cur` — **current sentence**: soft amber highlight wash + left accent edge; ink text. The augment block (§4.4) renders directly under it.
- default (upcoming) — normal ink.
Exactly one `cur` at a time. Advancing = `cur`→`done`, next→`cur`. The view keeps `cur` comfortably in viewport (scroll-follow, not jump-to-top).

### 4.3 Control bar — state machine (axis = current sentence id)
Buttons: **◁ prev · ▶/⏸ play-pause · ▷ next · 🔁 repeat** + speed + 「云朗读」honest cloud cue.
- `prev` → cur = prev sentence id (clamp at 0); if playing, auto-play new cur.
- `next` → cur = next id (clamp at last); if playing, auto-play new cur.
- `play` → play cur audio; on end → **sentence-end pause** (default) OR auto-advance (a setting). Pause holds on cur.
- `repeat` → replay cur audio; a toggle mode = loop cur until pressed again.
- `speed` → 0.8 / 0.9 / 1.0 / 1.1 / 1.25× applied to playback.
- States: `idle | playing | paused | sentenceLoading(准备中) | sentenceFailed | ttsUnavailable`. `sentenceLoading` shows a quiet "准备中…" on the play control while the current sentence's audio resolves (§7). `ttsUnavailable` = TTS gated/disabled (§5.4) → the control bar collapses to a clear disabled affordance, never a play button that silently does nothing.

### 4.4 Per-sentence augment (under `cur`)
- **IPA** (English V1): current sentence only; non-current sentences keep the reading surface visually calm. Toggle. The implementation may reserve ruby space while hiding non-current IPA to avoid layout jumps.
- **Bilingual 中文** line: collapsible, **default collapsed**; lazy-loaded on per-sentence expand. Toggle.
- **查词**: tap a word in `cur` → lightweight gloss (M2 fidelity; M1 wires the affordance).
- Augment is a **slot** (§6) — IPA today, furigana reserved for Japanese; same structural slot, pluggable annotator.

### 4.5 Provider-aware audio cue
- The control-bar audio cue reflects the **active provider** (§5.4): **Web Speech → 「浏览器朗读」** (no cloud claim); **MiMo BYOK → 「云朗读 · MiMo」** (current + upcoming sentence audio synthesized in the cloud after consent). Non-intrusive; the full cloud disclosure is the first-play prompt (§5.1), which fires only for a cloud/neural provider. The label is meaningful (not decorative) → must be legible (a11y §8).

---

## 5. Privacy & read-only

### 5.1 First-play privacy prompt (before the first 朗读 in a session/article) — REQUIRED
Honest external-surface framing (yomu does NOT claim fully-local):
- States: playback sends **the current sentence and a small upcoming-sentence prefetch window** to MiMo cloud (EU/SG) to synthesize voice.
- Reassurance (per official terms): text **not used for training**, retained only as needed + deletable, generated audio belongs to the user.
- Sent **only when you press play / next / repeat after accepting cloud read-aloud**; "继续纯阅读(不朗读)" path always offered.
- User is responsible for the rights to imported content.

> **Terms-evidence rule (provider-agnostic; QA #24/#26 privacy gate).** The strong reassurance copy above is shown **only when the active provider's terms are cited + current in evidence**. For MiMo V1 the source is the official MiMo Privacy Policy (§3.1 "Xiaomi will not use the content you provide for model training") + retention §6 (bounded, deletable) + MiMo Service Agreement §4.1 (user is Data Controller; generated audio is the user's business data) — these must be linked in the PR/PRD evidence. If a provider's terms evidence is missing or stale (e.g. a future swapped provider), the user-facing copy **downgrades to the conservative form**: "按所选语音服务的条款处理 · 详见隐私说明" with a link to the terms — never assert "not trained / deletable / yours" without a cited source.
- Actions: **开始朗读** (primary) / **继续纯阅读(不朗读)** (secondary). "可在 设置·朗读 改 · 不再单独提示."

### 5.2 Hard privacy boundaries (UI-visible contract; QA verifies)
- yomu never ships or depends on a shared server `MIMO_API_KEY`; BYOK user keys stay browser-local until the user presses play. Browser network never hits `xiaomimimo.com` / `token-plan-cn.xiaomimimo.com` directly — TTS only via yomu server-side endpoint/Worker.
- No full BYO text / key / plaintext-recoverable cache key in logs/errors/evidence — only textHash / masked metadata.

### 5.3 Read-only degrade mode
Entered when: user chose 「继续纯阅读」, or `content.lowEnglish`, or user declined the prompt.
- Full reader retained: scroll, 查词, bilingual — all work; **no cloud requests**.
- A quiet banner: "只读模式 · 这篇没有逐句朗读…开启朗读 →" (re-entry to enable TTS).

### 5.4 TTS providers — Web Speech floor + BYOK upgrade (the abuse-free model)
**M1 decision (locked):** no shared server key on the public endpoint (that would be an anonymous paid-API proxy / abuse surface). Instead a **two-tier provider model** via a provider registry (`provider/baseUrl/apiKey/model/voice/format`; cache key = `provider/model/voice/style/textHash`, never the key/hash). M1 registers exactly **`webspeech` + `mimo`**; OpenAI/ElevenLabs/Google/Azure are reserved in the registry (M2+).

**Tier 0 — Web Speech (default, no key)** — the always-available floor:
- Browser/system speech. **No key, no yomu TTS Worker call.** Any visitor gets guided-read with zero setup → no friction, no abuse surface.
- Honest copy (per QA boundary): **「无需 key · 由你的浏览器 / 系统朗读」** — do **NOT** claim "完全本地 / 无外部处理" (some browsers' Web Speech voices are cloud-backed; we can't guarantee local).
- If Web Speech is unavailable (rare/old browser) → read-only (§5.3) with a clear line.

**Tier 1 — MiMo BYOK (your key, neural quality)** — the upgrade:
- Settings · 朗读 → enter **your** MiMo base URL + API key. Key is **stored browser-local only** (clearable any time), **never** sent to yomu storage. On play, the key goes to the same-origin Worker which **only forwards — no store / no log / not in cache key**.
- Trust copy (honest, not hidden): "key 只存你本机浏览器,朗读时经 yomu 转发到小米,yomu 不保存" + **risk line**: "浏览器 / 扩展 / XSS 不可信时,本地 key 有暴露风险." + 「如何获取」guidance (小米/MiMo 按量付费 API Key；Token Plan Key 不用于自定义应用). Voice selection per provider.
- Connected state: 「已连接 · MiMo(···· last4)」+ one-tap clear. Terms-evidence rule (§5.1) applies.

**Provider switch + disabled logic** (`ttsUnavailable` family, §4.3) — there is **never a dead-end**, because Web Speech is always there:
| condition | UI |
|---|---|
| default / nothing configured | **Web Speech plays** (Tier 0). 领读 works out of the box. |
| user selected MiMo but no key entered | the MiMo option is **disabled + 「填 key 解锁神经语音」** guidance; playback **falls back to / stays on Web Speech**, not broken. |
| Web Speech unavailable + no MiMo key | read-only (§5.3) with 「这个浏览器不支持朗读 · 填 MiMo key 可启用」. |
| MiMo request error (401/429/5xx) | masked error 「神经语音暂时不可用」+ offer Web Speech / read-only; never expose key state. |

Principle: **guided-read always works** (Web Speech floor); **BYOK is a quality upgrade, not an unlock gate.** The reader + Tier-0 read-aloud are always available; missing/invalid keys only gate the *neural* tier, never the core experience.

### 4.5↔5.4 control-bar cue is provider-aware
The control-bar audio cue reflects the active provider: **Web Speech → 「浏览器朗读」** (no "云朗读" claim, per the honest-local boundary); **MiMo BYOK → 「云朗读 · MiMo」**. The first-play privacy prompt (§5.1) fires only for a **cloud/neural** provider (MiMo), not for Web Speech.

---

## 6. Sentence-node data contract (canonical — #23/#24 output, #26 consumes)
```ts
type SentenceNode = {
  id: string;            // stable
  order: number;
  original: string;      // the sentence text
  paragraphIndex: number;
  textHash: string;      // for cache key + dedupe; never store plaintext in cache key
  annotations: {
    ipa?: string;        // English V1
    furigana?: FuriganaToken[];  // Japanese — RESERVED, not rendered V1
  };
  bilingual?: { zh?: string };   // lazy; collapsible
  audio?: {
    cacheKey: string;    // ⊇ provider/model/voice/style/textHash — NO plaintext sentence
    status: 'idle' | 'loading' | 'ready' | 'failed';
  };
};
```
- The annotation layer is a **pluggable slot**: same structure for IPA (en) and furigana (ja); do not hard-code English.
- **Per-sentence isolation**: one sentence's TTS failure marks only that node `audio.status='failed'` (retryable/skippable) and never poisons the whole article; visual reading stays usable.

---

## 7. Prefetch state machine (BYO on-demand) — the responsiveness contract
On-demand TTS is ~2–6s/sentence → naïve play would stall between sentences. **Prefetch ahead**:
- When `cur` = sentence N (or N starts playing), background-synthesize **N+1 and N+2** (`audio.status: idle→loading→ready`).
- Prefetch applies only after the user has accepted the cloud/neural provider prompt; Web Speech has no Worker prefetch path.
- `play` on a node whose audio is `loading` shows "准备中…" until `ready`, then plays.
- `next`/`prev` re-anchor the prefetch window to the new cur.
- Daily/bundled-sample audio MAY be server pre-generated (latency hidden); BYO is the prefetch path.
- **QA acceptance**: continuous play has no 2–6s inter-sentence dead-wait; single-sentence failure isolated + retryable, whole-article package not poisoned.

---

## 8. a11y (owner: UX; measured, not eyeballed — on checklist)
WCAG AA (≥4.5:1) verified for the signature elements, light + dark:

| element | light | dark |
|---|---|---|
| active-sentence text on amber highlight | **11.76** ✓ | **10.36** ✓ |
| IPA ruby text (`--yomu-ink-soft`) | **10.11 on paper / 8.14 on active wash** ✓ | dark token review required when dark theme lands |
| body / bilingual text | 8.81 ✓ | 10.26 ✓ |
| 「云朗读」cloud label (`--cloud`) | **5.56** ✓ (was #a59a89 2.72 FAIL → #6f6658) | **4.70** ✓ (#938979) |

Also: keyboard reachable controls (prev/play/next/repeat + speed); `prefers-reduced-motion` respected (no essential motion in highlight/advance); focus-visible on all controls; control buttons have aria-labels (上一句/播放/下一句/重复). a11y baseline may not be silently descoped — if delivery pressure threatens it, raise as a blocker.

---

## 9. Tokens (reference; canonical brand values live in design tokens)
paper `#f7f3ea` · card `#fffdf8` · ink `#2a2521` · accent (teal) `#2f6f66` · active-sentence highlight `rgba(214,154,52,.20)` + edge `#d69a34` · cloud label `#6f6658` (dark `#938979`). Dark: paper `#1c1a17` · accent `#5fb0a4`. Content serif = Newsreader; UI = Space Grotesk / system; IPA/meta = mono.

---

## 10. Out of scope for M1 (do not regress)
- Full public-domain pool + difficulty filtering → M3 (M1 = 1 bundled sample only).
- End-to-end delete-chain proof → M3 (M1: just don't write BYO plaintext to uncontrolled logs/analytics).
- IPA/bilingual/prefetch full fidelity + 查词 gloss → M2 (M1: sentence data structures must support them; annotation + audio slots present).
- Japanese furigana rendering → reserved slot only.
