<script setup lang="ts">
import { computed } from 'vue'

import {
  clearAiApiKey,
  defaultOpenAiBaseUrl,
  isAiExpansionConfigured,
  type ReadExpansionSettings,
} from '@/features/extension/settings'

const model = defineModel<ReadExpansionSettings>({ required: true })

const hasAiKey = computed(() => isAiExpansionConfigured(model.value))
const maskedAiKey = computed(() => hasAiKey.value ? model.value.ai.openai.apiKey.trim().slice(-4) : '')

function updateAiEnabled(enabled: boolean) {
  model.value = {
    ...model.value,
    ai: {
      ...model.value.ai,
      enabled,
      consentAccepted: enabled ? model.value.ai.consentAccepted : false,
    },
  }
}

function updateOpenAiField<Key extends keyof ReadExpansionSettings['ai']['openai']>(
  key: Key,
  value: ReadExpansionSettings['ai']['openai'][Key],
) {
  model.value = {
    ...model.value,
    ai: {
      ...model.value.ai,
      consentAccepted: false,
      openai: {
        ...model.value.ai.openai,
        [key]: value,
      },
    },
  }
}

function clearKey() {
  model.value = clearAiApiKey(model.value)
}
</script>

<template>
  <section class="extension-settings" aria-labelledby="extension-settings-title">
    <div class="extension-settings__header">
      <p id="extension-settings-title" class="extension-settings__eyebrow">
        拓展
      </p>
      <p class="extension-settings__summary">
        默认只用本地抽词;AI 增强需要你自己的 key,并且只在你点开 AI 释义时发送当前词和最小上下文。
      </p>
    </div>

    <label class="extension-settings__toggle">
      <input
        type="checkbox"
        :checked="model.ai.enabled"
        @change="updateAiEnabled(($event.target as HTMLInputElement).checked)"
      >
      <span>
        <strong>AI 增强(用你自己的 key)</strong>
        <small>关闭时拓展完全本地,不会外发。</small>
      </span>
    </label>

    <div v-if="model.ai.enabled" class="extension-settings__provider">
      <p v-if="hasAiKey" class="extension-settings__connected">
        已连接 · OpenAI(····{{ maskedAiKey }})
      </p>
      <p v-else class="extension-settings__notice">
        填 key 后,生词卡会出现 AI 增强按钮;不填 key 仍可使用本地释义。
      </p>

      <label class="extension-settings__field">
        <span>密钥(API key)</span>
        <input
          type="password"
          autocomplete="off"
          spellcheck="false"
          :value="model.ai.openai.apiKey"
          placeholder="sk-..."
          @input="updateOpenAiField('apiKey', ($event.target as HTMLInputElement).value)"
        >
      </label>

      <div class="extension-settings__grid">
        <label class="extension-settings__field">
          <span>接口地址</span>
          <input
            type="url"
            :value="model.ai.openai.baseUrl"
            :placeholder="defaultOpenAiBaseUrl"
            @input="updateOpenAiField('baseUrl', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="extension-settings__field">
          <span>模型</span>
          <input
            type="text"
            :value="model.ai.openai.model"
            @input="updateOpenAiField('model', ($event.target as HTMLInputElement).value)"
          >
        </label>
      </div>

      <p class="extension-settings__privacy">
        key 只存你本机浏览器。yomu 的 Worker 只转发到 OpenAI,不在本站保存这个 key。
      </p>
      <p class="extension-settings__privacy">
        浏览器、扩展或页面脚本不可信时,本地 key 仍有暴露风险。当前只支持 OpenAI 兼容的官方接口地址。
      </p>
      <button
        type="button"
        class="extension-settings__clear"
        :disabled="!hasAiKey"
        @click="clearKey"
      >
        清除 AI key
      </button>
    </div>
  </section>
</template>

<style scoped>
.extension-settings {
  display: grid;
  gap: 1rem;
  max-inline-size: min(100% - 2rem, 42rem);
  border: 1px solid var(--yomu-rule);
  border-radius: 1rem;
  margin: 0 auto 1rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--yomu-paper) 92%, white);
}

.extension-settings__header,
.extension-settings__provider {
  display: grid;
  gap: 0.7rem;
}

.extension-settings__eyebrow,
.extension-settings__summary,
.extension-settings__privacy,
.extension-settings__notice,
.extension-settings__toggle small {
  margin: 0;
  color: var(--yomu-muted);
}

.extension-settings__eyebrow {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.extension-settings__summary,
.extension-settings__privacy,
.extension-settings__notice,
.extension-settings__connected {
  line-height: 1.65;
}

.extension-settings__connected {
  margin: 0;
  color: var(--yomu-accent);
  font-weight: 700;
}

.extension-settings__toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.85rem;
  padding: 0.75rem;
}

.extension-settings__toggle input {
  margin-block-start: 0.2rem;
  accent-color: var(--yomu-accent);
}

.extension-settings__toggle span {
  display: grid;
  gap: 0.2rem;
}

.extension-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.extension-settings__field {
  display: grid;
  gap: 0.35rem;
  color: var(--yomu-ink-soft);
  font-size: 0.9rem;
}

.extension-settings__field input {
  min-block-size: 2.75rem;
  inline-size: 100%;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.75rem;
  padding-inline: 0.8rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink);
  font: inherit;
}

.extension-settings__clear {
  justify-self: start;
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.85rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.extension-settings__clear:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.extension-settings__field input:focus-visible,
.extension-settings__clear:focus-visible,
.extension-settings__toggle:focus-within {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}

@media (max-width: 560px) {
  .extension-settings__grid {
    grid-template-columns: 1fr;
  }
}
</style>
