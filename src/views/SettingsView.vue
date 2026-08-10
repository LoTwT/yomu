<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'

import { usePlatformInitialization } from '@/app/platformInitialization'
import { usePlatformServices } from '@/app/platformServices'
import { useThemePreference } from '@/app/themePreference'
import ReadExpansionSettingsPanel from '@/components/ReadExpansionSettingsPanel.vue'
import ReaderDisplaySettings from '@/components/reader/ReaderDisplaySettings.vue'
import TtsSettingsPanel from '@/components/TtsSettingsPanel.vue'
import { useReaderDisplayPreferences } from '@/features/preferences/useReaderDisplayPreferences'
import { useProviderSettings } from '@/features/settings/useProviderSettings'
import { platformInitializationPreferenceKeys } from '@/platform/initialization'

import { usePageHeadingFocus } from './usePageHeadingFocus'

const themeOptions = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: 'Paper' },
  { value: 'dark', label: 'Ink' },
] as const
const { state: themeState, setPreference } = useThemePreference()
const initialization = usePlatformInitialization()
const platformServices = usePlatformServices()
const {
  defaultExpandTranslation,
  fontScale,
  persistence: readerPreferencePersistence,
  persistenceStatus: readerPreferencePersistenceStatus,
  setDefaultExpandTranslation,
  setFontScale,
} = useReaderDisplayPreferences()
const {
  ttsSettings,
  readExpansionSettings,
  rememberMimoKey,
  rememberOpenAiKey,
  loadStatus,
  persistenceStatus: providerPersistenceStatus,
  canRememberOnDevice,
  clearAllProviderSecrets,
} = useProviderSettings()
const secretClearStatus = shallowRef<'idle' | 'clearing' | 'cleared' | 'failed'>('idle')
const keyReentryAcknowledgementStatus = shallowRef<'idle' | 'saving' | 'failed'>('idle')
const legacyKeyReentryNoticeVisible = shallowRef(
  initialization.legacyProviderKeyReentryRequired
  || initialization.legacyProviderKeysCleared
  || initialization.legacyProviderSecretsCleared > 0,
)
const hasInitializationNotice = computed(() =>
  legacyKeyReentryNoticeVisible.value
  || initialization.providerPreferencesMigrated > 0
  || initialization.migrationDiagnosticCount > 0
  || initialization.initializationIssueCount > 0,
)

async function acknowledgeLegacyKeyReentryNotice() {
  keyReentryAcknowledgementStatus.value = 'saving'
  try {
    await platformServices.preferences.remove(
      platformInitializationPreferenceKeys.legacyProviderKeyReentryRequired,
    )
    legacyKeyReentryNoticeVisible.value = false
    keyReentryAcknowledgementStatus.value = 'idle'
  }
  catch {
    keyReentryAcknowledgementStatus.value = 'failed'
  }
}

async function clearStoredSecrets() {
  secretClearStatus.value = 'clearing'
  try {
    await clearAllProviderSecrets()
    secretClearStatus.value = 'cleared'
  }
  catch {
    secretClearStatus.value = 'failed'
  }
}

usePageHeadingFocus()
</script>

<template>
  <div class="settings-view">
    <h1 ref="pageHeading" class="settings-view__title" data-page-heading tabindex="-1">
      设置
    </h1>
    <p class="settings-view__lead">
      阅读、语音、AI 和本机数据设置集中在这里管理。
    </p>
    <aside
      v-if="hasInitializationNotice"
      class="settings-view__migration-notice"
      role="status"
      aria-label="本机数据安全更新"
    >
      <h2>本机数据安全更新</h2>
      <template v-if="legacyKeyReentryNoticeVisible">
        <p>
          为保护隐私，Yomu 已清除旧版设置或旧存储格式中的 Provider Key。需要云服务时，请重新输入。
        </p>
        <div class="settings-view__migration-actions">
          <button
            class="settings-view__migration-confirm"
            type="button"
            :disabled="keyReentryAcknowledgementStatus === 'saving'"
            @click="void acknowledgeLegacyKeyReentryNotice()"
          >
            {{ keyReentryAcknowledgementStatus === 'saving' ? '正在确认…' : '确认并关闭提示' }}
          </button>
          <p
            v-if="keyReentryAcknowledgementStatus === 'failed'"
            class="settings-view__migration-error"
            role="alert"
          >
            暂时无法保存确认状态，请稍后重试。
          </p>
        </div>
      </template>
      <p v-if="initialization.providerPreferencesMigrated > 0">
        旧版语音与 AI 的非敏感配置已迁移到统一设置。
      </p>
      <p v-if="initialization.migrationDiagnosticCount > 0">
        旧数据迁移时有 {{ initialization.migrationDiagnosticCount }} 项无法安全还原，已跳过；相关内容未上传或显示。
      </p>
      <p v-if="initialization.initializationIssueCount > 0">
        有 {{ initialization.initializationIssueCount }} 项本机存储初始化未完成。你仍可继续阅读，并可稍后重试保存设置。
      </p>
    </aside>
    <div class="settings-view__groups">
      <section class="settings-view__group">
        <h2 class="settings-view__group-title">
          外观
        </h2>
        <p class="settings-view__group-copy">
          选择明亮的 Paper、深色的 Ink，或跟随此设备。
        </p>
        <div class="theme-options" role="group" aria-label="主题偏好">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            class="theme-options__button"
            :class="{ 'theme-options__button--active': themeState.preference === option.value }"
            type="button"
            :aria-pressed="themeState.preference === option.value"
            @click="void setPreference(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </section>
      <section class="settings-view__group">
        <h2 class="settings-view__group-title">
          阅读
        </h2>
        <p class="settings-view__group-copy">
          这里的字号与译文默认会同步用于新版阅读器；IPA 仍由每次阅读单独决定。
        </p>
        <ReaderDisplaySettings
          :default-expand-translation="defaultExpandTranslation"
          :font-scale="fontScale"
          :persistence="readerPreferencePersistence"
          :persistence-status="readerPreferencePersistenceStatus"
          :show-ipa="false"
          @update:default-expand-translation="setDefaultExpandTranslation"
          @update:font-scale="setFontScale"
        />
      </section>
      <p v-if="loadStatus === 'loading'" class="settings-view__loading" role="status">
        正在读取语音与 AI 设置…
      </p>
      <template v-else>
        <section class="settings-view__group settings-view__provider" aria-labelledby="settings-speech-title">
          <h2 id="settings-speech-title" class="settings-view__group-title">
            语音
          </h2>
          <TtsSettingsPanel
            v-model="ttsSettings"
            v-model:remember-on-device="rememberMimoKey"
            :can-remember-on-device="canRememberOnDevice"
          />
        </section>
        <section class="settings-view__group settings-view__provider" aria-labelledby="settings-ai-title">
          <h2 id="settings-ai-title" class="settings-view__group-title">
            AI
          </h2>
          <ReadExpansionSettingsPanel
            v-model="readExpansionSettings"
            v-model:remember-on-device="rememberOpenAiKey"
            :can-remember-on-device="canRememberOnDevice"
          />
        </section>
        <p class="settings-view__save-status" aria-live="polite">
          <template v-if="loadStatus === 'failed' || providerPersistenceStatus === 'failed'">
            暂时无法保存设置。Key 只保留在本次页面会话中，请检查设备存储权限后重试。
          </template>
          <template v-else-if="providerPersistenceStatus === 'saving'">
            正在保存设置…
          </template>
          <template v-else-if="providerPersistenceStatus === 'saved'">
            设置已保存。
          </template>
        </p>
      </template>
      <section class="settings-view__group">
        <h2 class="settings-view__group-title">
          数据与隐私
        </h2>
        <p class="settings-view__group-copy">
          阅读库只存储在此设备或此安装中，不会自动同步到其他设备。
        </p>
        <button
          class="settings-view__clear-secrets"
          type="button"
          :disabled="secretClearStatus === 'clearing'"
          @click="void clearStoredSecrets()"
        >
          {{ secretClearStatus === 'clearing' ? '正在清除…' : '清除所有 Provider Key' }}
        </button>
        <p class="settings-view__status" aria-live="polite">
          <template v-if="secretClearStatus === 'cleared'">
            已清除本次会话、此设备记住的 Provider Key，并重置相关云服务同意状态。
          </template>
          <template v-else-if="secretClearStatus === 'failed'">
            暂时无法清除，请检查设备存储权限后重试。
          </template>
        </p>
      </section>
    </div>
    <RouterLink class="settings-view__legacy-link" :to="{ name: 'legacy' }">
      打开 Today 阅读
    </RouterLink>
  </div>
</template>

<style scoped>
.settings-view {
  max-inline-size: 48rem;
  margin-inline: auto;
}

.settings-view__title {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.5rem);
}

.settings-view__title:focus {
  outline: 0;
}

.settings-view__lead {
  margin-block: 0.75rem 1.5rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.settings-view__groups {
  display: grid;
  gap: 0.75rem;
}

.settings-view__migration-notice {
  display: grid;
  gap: 0.45rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  margin-block-end: 1rem;
  padding: 1rem;
  background: var(--surface-panel);
}

.settings-view__migration-notice h2,
.settings-view__migration-notice p {
  margin: 0;
}

.settings-view__migration-notice h2 {
  font-size: 1rem;
}

.settings-view__migration-notice p {
  color: var(--text-secondary);
  line-height: 1.65;
}

.settings-view__migration-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.settings-view__migration-confirm {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding-inline: 0.9rem;
  background: var(--surface-panel);
  color: var(--text-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.settings-view__migration-confirm:disabled {
  cursor: wait;
  opacity: 0.65;
}

.settings-view__migration-confirm:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.settings-view__migration-notice .settings-view__migration-error {
  color: var(--text-danger, var(--text-primary));
}

.settings-view__group {
  border-block-end: 1px solid var(--border-subtle);
  padding-block: 1rem;
}

.settings-view__group-title,
.settings-view__group-copy {
  margin: 0;
}

.settings-view__provider :deep(.tts-settings),
.settings-view__provider :deep(.extension-settings) {
  max-inline-size: none;
  margin: 1rem 0 0;
}

.settings-view__loading,
.settings-view__save-status {
  margin: 0;
  color: var(--text-secondary);
}

.settings-view__save-status {
  min-block-size: 1.5em;
  font-size: 0.9rem;
}

.settings-view__group-title {
  font-size: 1.05rem;
}

.settings-view__group-copy {
  margin-block-start: 0.35rem;
  color: var(--text-secondary);
}

.theme-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block-start: 1rem;
}

.theme-options__button {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding-inline: 0.9rem;
  background: var(--surface-panel);
  color: var(--text-secondary);
  cursor: pointer;
}

.theme-options__button--active {
  border-color: var(--accent-primary-active);
  background: var(--accent-soft);
  color: var(--text-accent);
}

.theme-options__button:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.settings-view__clear-secrets {
  min-block-size: 2.75rem;
  margin-block-start: 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding-inline: 0.9rem;
  background: var(--surface-panel);
  color: var(--text-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.settings-view__clear-secrets:disabled {
  cursor: wait;
  opacity: 0.65;
}

.settings-view__clear-secrets:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.settings-view__status {
  min-block-size: 1.5em;
  margin-block: 0.65rem 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.settings-view__legacy-link {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  margin-block-start: 1.5rem;
  color: var(--text-accent);
  font-weight: 700;
}
</style>
