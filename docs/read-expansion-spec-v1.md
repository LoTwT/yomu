# yomu · 读后拓展 (Read Expansion) — UX Spec v1

> Owner: UX-Sunna. Spec for task #34. TL implements task #35, QA verifies task #36.
> Model C: local extraction floor + optional AI-BYOK enhancement. This mirrors yomu's TTS tiers: default local and zero external calls; upgrade with your own key; label external surfaces honestly.

## 1. Two Tiers

- **Tier 0 — local extraction floor (default, zero external calls, no key)**: extract candidate words from the article by high-frequency, key, and above-level signals; provide a basic local gloss through article glossary, local dictionary, or rules. This works for everyone.
- **Tier 1 — AI enhancement (opt-in, BYOK)**: user enables AI enhancement and enters their own LLM key. The key stays in browser-local settings; yomu's same-origin Worker forwards a word plus minimal sentence context with `no-store` responses and no backend key vault. AI blocks are lazy and only requested after explicit user action.

## 2. Surfaces

- **Tap-a-word**: tapping a word in the reading view opens a quiet word card anchored near the word. The card always shows local gloss first. If AI is enabled and configured, it also offers AI enhancement.
- **Read-expansion panel**: after completion, a quiet "读后拓展" panel lists extracted terms sorted by rank: above-level, key, then frequent. It uses the same word card component.

## 3. Word Card

```text
[word]             serif term
/IPA/              reuse read-aloud IPA if present
基础释义            local gloss, always available

✨ AI · {provider}  only after AI enhancement is requested
更地道释义 / 例句 / 背景
```

- Tier 0 card is local and calm: word, IPA, gloss, rank, and local/zero-external marker.
- Tier 1 card keeps local content visible, then adds a clearly marked AI block.
- Long AI content is bounded and scrollable. AI failure is local to the card and does not block reading.

## 4. Settings

- Toggle: `AI 增强(用你自己的 key)`, off by default.
- Provider scope for this slice: OpenAI-compatible official endpoint only. The shape is registry-extensible, but no additional provider is in scope.
- Settings follow the TTS BYOK pattern: password key field, base URL, model, local-only storage copy, clear action, and XSS/browser-extension risk line.

## 5. First-Use Consent

Before the first AI-enhanced request, show a prompt that says yomu will send the current word and minimal original sentence context to the configured model. Actions:

- `开启 AI 增强`
- `继续只用本地`

Do not claim provider retention/training behavior unless backed by provider terms.

## 6. Required States

- **Default**: no key and AI off. Every card remains usable through local extraction.
- **AI on + configured**: cards offer `AI 增强`; request is lazy per word.
- **AI failure**: show a quiet local failure message; local gloss remains.
- **No extracted words**: show `这篇没抽到生词`; not an error.
- **Long context**: send only the term and minimal sentence context, not the whole article.

## 7. Privacy Gate

- Tier 0 must make zero `/api/extensions/ai` calls.
- AI fires only when all are true: AI toggle on, BYOK configured, first-use consent accepted, and user requests AI for a card.
- Browser calls yomu same-origin Worker, not the AI provider directly.
- Worker has no global AI key, rejects unsupported proxy hosts, returns `Cache-Control: no-store` and `Pragma: no-cache`, and never echoes user keys.
- Cache keys must not contain user keys or key hashes. This slice does not persist AI responses.

## 8. Accessibility

Word cards are keyboard reachable, focus-visible, and AA contrast-compliant. The AI marker is textual (`✨ AI · {provider}`), not color-only. Reduced-motion users must not depend on animation for state changes.

## 9. Out of Scope

- Personal vocabulary book and SRS review.
- Cross-article vocabulary aggregation.
- Full multi-provider AI registry beyond the single OpenAI-compatible BYOK path.
