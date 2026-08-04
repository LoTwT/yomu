<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'

defineProps<{
  message: string
}>()

const summary = useTemplateRef<HTMLElement>('summary')

onMounted(() => summary.value?.focus())
</script>

<template>
  <section class="import-error" role="alert" aria-labelledby="import-error-heading">
    <h2 id="import-error-heading" ref="summary" class="import-error__title" tabindex="-1">
      无法生成预览
    </h2>
    <p class="import-error__message">
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.import-error {
  border: 1px solid var(--status-danger-border);
  border-radius: 0.65rem;
  padding: 1rem;
  background: var(--status-danger-bg);
}

.import-error__title,
.import-error__message {
  margin: 0;
}

.import-error__title {
  font-size: 1rem;
}

.import-error__title:focus {
  outline: 0;
}

.import-error__message {
  margin-block-start: 0.35rem;
  color: var(--text-secondary);
  line-height: 1.55;
}
</style>
