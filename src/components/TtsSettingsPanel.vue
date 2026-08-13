<script setup lang="ts">
import { computed } from 'vue'

import { clearMimoApiKey, defaultMimoBaseUrl, isMimoConfigured, type TtsSettings } from '@/features/tts/settings'

const props = withDefaults(defineProps<{
  canRememberOnDevice?: boolean
}>(), {
  canRememberOnDevice: true,
})
const model = defineModel<TtsSettings>({ required: true })
const rememberOnDevice = defineModel<boolean>('rememberOnDevice', { default: false })

const hasMimoKey = computed(() => isMimoConfigured(model.value))
const maskedMimoKey = computed(() => {
  if (!hasMimoKey.value) {
    return ''
  }

  return model.value.mimo.apiKey.trim().slice(-4)
})

function updateProvider(provider: TtsSettings['provider']) {
  const nextSettings = {
    ...model.value,
    provider,
  }
  if (provider === 'webspeech') {
    rememberOnDevice.value = false
    model.value = clearMimoApiKey(nextSettings)
    return
  }
  model.value = nextSettings
}

function updateMimoField<Key extends keyof TtsSettings['mimo']>(key: Key, value: TtsSettings['mimo'][Key]) {
  model.value = {
    ...model.value,
    mimo: {
      ...model.value.mimo,
      [key]: value,
    },
  }
}

function clearKey() {
  rememberOnDevice.value = false
  model.value = clearMimoApiKey(model.value)
}
</script>

<template>
  <section class="tts-settings" aria-labelledby="tts-settings-title">
    <div class="tts-settings__header">
      <p id="tts-settings-title" class="tts-settings__eyebrow">
        朗读
      </p>
      <p class="tts-settings__summary">
        Web Speech 是默认朗读方式；MiMo 是使用你自己的 Key 的神经语音增强。
      </p>
    </div>

    <fieldset class="tts-settings__providers">
      <legend>朗读方式</legend>
      <label>
        <input
          type="radio"
          name="tts-provider"
          value="webspeech"
          :checked="model.provider === 'webspeech'"
          @change="updateProvider('webspeech')"
        >
        <span>
          <strong>Web Speech</strong>
          <small>无需 Key，由你的浏览器或系统朗读。</small>
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="tts-provider"
          value="mimo"
          :checked="model.provider === 'mimo'"
          @change="updateProvider('mimo')"
        >
        <span>
          <strong>MiMo 自备 Key</strong>
          <small>神经语音增强，使用你自己的 MiMo Key。</small>
        </span>
      </label>
    </fieldset>

    <div v-if="model.provider === 'mimo'" class="tts-settings__mimo">
      <p
        v-if="hasMimoKey"
        class="tts-settings__connected"
      >
        已连接 · MiMo(····{{ maskedMimoKey }})
      </p>
      <p
        v-else
        class="tts-settings__notice"
      >
        填入 Key 后解锁神经语音；未配置时仍使用 Web Speech 朗读。
      </p>
      <label class="tts-settings__field">
        <span>密钥（API Key）</span>
        <input
          type="password"
          autocomplete="off"
          spellcheck="false"
          :value="model.mimo.apiKey"
          placeholder="sk-..."
          @input="updateMimoField('apiKey', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <div class="tts-settings__grid">
        <label class="tts-settings__field">
          <span>接口地址</span>
          <input
            type="url"
            :value="model.mimo.baseUrl"
            :placeholder="defaultMimoBaseUrl"
            readonly
          >
        </label>
        <label class="tts-settings__field">
          <span>音色</span>
          <input
            type="text"
            :value="model.mimo.voice"
            @input="updateMimoField('voice', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="tts-settings__field">
          <span>模型</span>
          <input
            type="text"
            :value="model.mimo.model"
            @input="updateMimoField('model', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="tts-settings__field">
          <span>格式</span>
          <select
            :value="model.mimo.format"
            @change="updateMimoField('format', (($event.target as HTMLSelectElement).value === 'wav' ? 'wav' : 'mp3'))"
          >
            <option value="mp3">
              MP3
            </option>
            <option value="wav">
              WAV
            </option>
          </select>
        </label>
      </div>
      <p class="tts-settings__privacy">
        默认只在当前会话内存中保留。仅在按下播放时发送给 Yomu；Yomu 只转发到 MiMo，不在本站保存这个 Key。
      </p>
      <p class="tts-settings__privacy">
        浏览器、扩展或页面脚本不可信时，本地 Key 仍有暴露风险。请在小米/MiMo 控制台创建按量付费 API Key；MiMo 语音当前可能限时免费，费用与额度以服务商页面为准。
      </p>
      <label class="tts-settings__remember">
        <input
          v-model="rememberOnDevice"
          type="checkbox"
          :disabled="!hasMimoKey || !props.canRememberOnDevice"
        >
        <span>
          <strong>记住在此设备</strong>
          <small v-if="props.canRememberOnDevice">默认关闭。开启后会把 Key 写入此设备；不会同步到其他设备。</small>
          <small v-else>当前运行环境不提供设备级 Key 存储，只会保留到本次会话结束。</small>
        </span>
      </label>
      <button
        type="button"
        class="tts-settings__clear"
        :disabled="!hasMimoKey"
        @click="clearKey"
      >
        清除 MiMo Key
      </button>
    </div>
  </section>
</template>

<style scoped>
.tts-settings {
  display: grid;
  gap: 1rem;
  max-inline-size: min(100% - 2rem, 42rem);
  border: 1px solid var(--yomu-rule);
  border-radius: 1rem;
  margin: 0 auto 1rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--yomu-paper) 92%, white);
}

.tts-settings__header {
  display: grid;
  gap: 0.3rem;
}

.tts-settings__eyebrow,
.tts-settings__summary,
.tts-settings__privacy,
.tts-settings__notice,
.tts-settings__providers small {
  margin: 0;
  color: var(--yomu-muted);
}

.tts-settings__eyebrow {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tts-settings__summary,
.tts-settings__privacy,
.tts-settings__notice,
.tts-settings__connected {
  line-height: 1.65;
}

.tts-settings__connected {
  margin: 0;
  color: var(--yomu-accent);
  font-weight: 700;
}

.tts-settings__providers {
  display: grid;
  gap: 0.6rem;
  border: 0;
  margin: 0;
  padding: 0;
}

.tts-settings__providers legend {
  margin-block-end: 0.45rem;
  color: var(--yomu-ink);
  font-weight: 700;
}

.tts-settings__providers label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.85rem;
  padding: 0.75rem;
}

.tts-settings__providers input {
  margin-block-start: 0.2rem;
  accent-color: var(--yomu-accent);
}

.tts-settings__providers span {
  display: grid;
  gap: 0.2rem;
}

.tts-settings__mimo {
  display: grid;
  gap: 0.8rem;
}

.tts-settings__remember {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.85rem;
  padding: 0.75rem;
  color: var(--yomu-ink-soft);
}

.tts-settings__remember input {
  margin-block-start: 0.2rem;
  accent-color: var(--yomu-accent);
}

.tts-settings__remember span {
  display: grid;
  gap: 0.2rem;
}

.tts-settings__remember small {
  color: var(--yomu-muted);
  line-height: 1.5;
}

.tts-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.tts-settings__field {
  display: grid;
  gap: 0.35rem;
  color: var(--yomu-ink-soft);
  font-size: 0.9rem;
}

.tts-settings__field input,
.tts-settings__field select {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.75rem;
  padding-inline: 0.75rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink);
  font: inherit;
}

.tts-settings__clear {
  justify-self: start;
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 1rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.tts-settings__clear:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.tts-settings :is(input, select, button):focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}

@media (max-width: 640px) {
  .tts-settings__grid {
    grid-template-columns: 1fr;
  }
}
</style>
