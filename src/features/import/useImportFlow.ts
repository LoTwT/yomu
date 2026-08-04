import { computed, shallowReadonly, shallowRef } from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import {
  importArticleFromPaste,
  reparseImportedArticleDraft,
  type ImportedArticleDraft,
} from './importArticle'
import { saveImportedArticle } from './saveImportedArticle'

export type ImportFlowState =
  | { phase: 'idle', text: string }
  | { phase: 'parsing', text: string }
  | { phase: 'error', text: string, message: string }
  | {
      phase: 'preview'
      draft: ImportedArticleDraft
      title: string
      body: string
      validationMessage: string
    }
  | {
      phase: 'saving'
      draft: ImportedArticleDraft
      title: string
      body: string
    }
  | {
      phase: 'duplicate'
      draft: ImportedArticleDraft
      title: string
      body: string
      articleId: string
      articleTitle: string
    }

export type ImportSaveOutcome =
  | { kind: 'created', articleId: string }
  | { kind: 'duplicate', articleId: string }
  | null

export function useImportFlow() {
  const services = usePlatformServices()
  const state = shallowRef<ImportFlowState>({ phase: 'idle', text: '' })
  const resolved = shallowRef(false)
  let analysisVersion = 0

  const canPersist = services.repositories.persistence === 'persistent'
    && services.capabilities.localPersistence.availability === 'available'
  const isDirty = computed(() => {
    if (resolved.value) {
      return false
    }
    const current = state.value
    if (current.phase === 'idle' || current.phase === 'parsing' || current.phase === 'error') {
      return current.text.trim().length > 0
    }
    return true
  })

  function setSourceText(text: string): void {
    if (state.value.phase === 'idle'
      || state.value.phase === 'parsing'
      || state.value.phase === 'error') {
      resolved.value = false
      state.value = { phase: 'idle', text }
    }
  }

  async function parsePaste(): Promise<void> {
    const text = state.value.phase === 'idle' || state.value.phase === 'error'
      ? state.value.text
      : ''
    state.value = { phase: 'parsing', text }
    resolved.value = false
    const result = await importArticleFromPaste({ text })
    if (!result.ok) {
      state.value = {
        phase: 'error',
        text,
        message: toImportMessage(result.code),
      }
      return
    }
    state.value = {
      phase: 'preview',
      draft: result.draft,
      title: result.draft.title,
      body: result.draft.body,
      validationMessage: '',
    }
  }

  function updateTitle(title: string): void {
    const current = state.value
    if (current.phase !== 'preview') {
      return
    }
    resolved.value = false
    state.value = { ...current, title }
  }

  function updateSourceLabel(sourceLabel: string): void {
    const current = state.value
    if (current.phase !== 'preview') {
      return
    }
    resolved.value = false
    state.value = {
      ...current,
      draft: {
        ...current.draft,
        source: { ...current.draft.source, label: sourceLabel },
      },
    }
  }

  function updateBody(body: string): void {
    const current = state.value
    if (current.phase !== 'preview') {
      return
    }
    const version = ++analysisVersion
    resolved.value = false
    state.value = { ...current, body, validationMessage: '' }
    void reparseImportedArticleDraft(
      { ...current.draft, title: current.title },
      body,
    ).then((result) => {
      if (version !== analysisVersion
        || state.value.phase !== 'preview'
        || state.value.body !== body) {
        return
      }
      if (!result.ok) {
        state.value = {
          ...state.value,
          validationMessage: toImportMessage(result.code),
        }
        return
      }
      state.value = {
        ...state.value,
        draft: {
          ...result.draft,
          title: state.value.title,
          source: state.value.draft.source,
        },
        validationMessage: '',
      }
    })
  }

  async function save(): Promise<ImportSaveOutcome> {
    const current = state.value
    if (current.phase !== 'preview') {
      return null
    }
    if (!canPersist) {
      state.value = {
        ...current,
        validationMessage: '此安装当前无法持久保存内容。请启用浏览器站点存储后重试。',
      }
      return null
    }
    if (!current.title.trim()) {
      state.value = { ...current, validationMessage: '请输入文章标题。' }
      return null
    }
    if (!current.draft.source.label.trim()) {
      state.value = { ...current, validationMessage: '请输入内容来源。' }
      return null
    }

    const reparsed = await reparseImportedArticleDraft(
      { ...current.draft, title: current.title },
      current.body,
    )
    if (!reparsed.ok) {
      state.value = {
        ...current,
        validationMessage: toImportMessage(reparsed.code),
      }
      return null
    }

    const finalDraft = { ...reparsed.draft, title: current.title }
    state.value = {
      phase: 'saving',
      draft: finalDraft,
      title: current.title,
      body: current.body,
    }

    try {
      const result = await saveImportedArticle(services.repositories, finalDraft)
      if (result.kind === 'duplicate') {
        state.value = {
          phase: 'duplicate',
          draft: finalDraft,
          title: current.title,
          body: current.body,
          articleId: result.article.id,
          articleTitle: result.article.title,
        }
        return { kind: 'duplicate', articleId: result.article.id }
      }
      resolved.value = true
      return { kind: 'created', articleId: result.article.id }
    }
    catch {
      state.value = {
        phase: 'preview',
        draft: finalDraft,
        title: current.title,
        body: current.body,
        validationMessage: '保存失败，未写入任何内容。请检查存储空间后重试。',
      }
      return null
    }
  }

  function cancelPreview(): void {
    const current = state.value
    if (current.phase === 'preview'
      || current.phase === 'saving'
      || current.phase === 'duplicate') {
      analysisVersion += 1
      resolved.value = false
      state.value = { phase: 'idle', text: current.body }
    }
  }

  function acceptDuplicate(): string | null {
    if (state.value.phase !== 'duplicate') {
      return null
    }
    resolved.value = true
    return state.value.articleId
  }

  return {
    state: shallowReadonly(state),
    canPersist,
    isDirty,
    setSourceText,
    parsePaste,
    updateTitle,
    updateSourceLabel,
    updateBody,
    save,
    cancelPreview,
    acceptDuplicate,
  }
}

function toImportMessage(code: string): string {
  const messages: Record<string, string> = {
    'empty-input': '请先粘贴一段英文正文。',
    'too-short': '正文太短，请至少提供约 120 个字符。',
    'too-long': '正文过长，请拆分后再导入。',
    'unsafe-html': '检测到脚本或嵌入内容，请只粘贴纯文本。',
    'not-english': '这段内容不像英文文章。',
    'not-enough-sentences': '正文至少需要两句可阅读的英文。',
    'overlong-sentence': '正文中有过长句子，请先拆分。',
    'fragment-sentences': '正文中短碎片过多，请整理后重试。',
  }
  return messages[code] ?? '无法解析这段内容，请检查后重试。'
}
