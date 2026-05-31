<script setup lang="ts">
defineProps<{
  providerLabel: string
}>()

const emit = defineEmits<{
  accept: []
  decline: []
}>()
</script>

<template>
  <div
    class="read-expansion-consent"
    role="dialog"
    aria-labelledby="read-expansion-consent-title"
  >
    <h4 id="read-expansion-consent-title">
      开启 AI 增强?
    </h4>
    <p>
      拓展会把当前词和最小原句上下文发送给你配置的 {{ providerLabel }} 模型。key 只存本机,yomu 不保存;你也可以继续只用本地释义。
    </p>
    <div class="read-expansion-consent__actions">
      <button type="button" @click="emit('accept')">
        开启 AI 增强
      </button>
      <button type="button" @click="emit('decline')">
        继续只用本地
      </button>
    </div>
  </div>
</template>

<style scoped>
.read-expansion-consent {
  display: grid;
  gap: 0.65rem;
  max-inline-size: min(100% - 2rem, 42rem);
  border: 1px solid color-mix(in srgb, var(--yomu-accent) 45%, var(--yomu-rule));
  border-radius: 0.9rem;
  margin: 0 auto 1rem;
  padding: 0.9rem;
  background: color-mix(in srgb, var(--yomu-active) 55%, var(--yomu-paper));
}

.read-expansion-consent h4,
.read-expansion-consent p {
  margin: 0;
}

.read-expansion-consent p {
  color: var(--yomu-ink-soft);
  line-height: 1.65;
}

.read-expansion-consent__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.read-expansion-consent__actions button {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.85rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.read-expansion-consent__actions button:first-child {
  border-color: var(--yomu-accent);
  color: var(--yomu-accent);
  font-weight: 700;
}

.read-expansion-consent__actions button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
