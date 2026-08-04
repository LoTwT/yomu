import { computed, shallowReadonly, shallowRef } from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import type { ImportedTextFile } from '@/platform/contracts'
import {
  importArticleFromPaste,
  importArticleFromTextFile,
  reparseImportedArticleDraft,
  type ImportedArticleDraft,
  type ImportArticleResult,
  type ImportSourceType,
} from './importArticle'
import { saveImportedArticle } from './saveImportedArticle'

export type ImportInputSource = 'paste' | 'file'

type ImportFlowInputState =
  | {
      phase: 'idle'
      source: ImportInputSource
      text: string
      fileName: string
    }
  | {
      phase: 'parsing'
      source: ImportInputSource
      text: string
      fileName: string
    }
  | {
      phase: 'error'
      source: ImportInputSource
      text: string
      fileName: string
      message: string
    }

export type ImportFlowState =
  | ImportFlowInputState
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
  let pasteText = ''
  let selectedFile: ImportedTextFile | null = null
  const state = shallowRef<ImportFlowState>(createInputState('idle', 'paste'))
  const resolved = shallowRef(false)
  let analysisVersion = 0

  const canPersist = services.repositories.persistence === 'persistent'
    && services.capabilities.localPersistence.availability === 'available'
  const fileImportAvailable = services.capabilities.fileImport.availability !== 'unavailable'
    && services.files.isAvailable()
  const fileImportReason = services.capabilities.fileImport.reason
    ?? '当前平台尚未接入文件选择。'
  const fileDropAvailable = fileImportAvailable && services.files.supportsDrop()
  const inputSource = computed<ImportInputSource>(() => {
    const current = state.value
    if (isInputState(current)) {
      return current.source
    }
    return current.draft.source.kind === 'file' ? 'file' : 'paste'
  })
  const isDirty = computed(() => {
    if (resolved.value) {
      return false
    }
    const current = state.value
    if (isInputState(current)) {
      return pasteText.trim().length > 0 || selectedFile !== null
    }
    return true
  })

  function createInputState(
    phase: 'idle' | 'parsing',
    source: ImportInputSource,
  ): ImportFlowInputState {
    return {
      phase,
      source,
      text: pasteText,
      fileName: selectedFile?.name ?? '',
    }
  }

  function setInputSource(source: ImportInputSource): void {
    const current = state.value
    if (!isInputState(current) || current.phase === 'parsing') {
      return
    }
    if (source === 'file' && !fileImportAvailable) {
      showInputError('file', fileImportReason)
      return
    }
    resolved.value = false
    state.value = createInputState('idle', source)
  }

  function setSourceText(text: string): void {
    pasteText = text
    const current = state.value
    if (isInputState(current) && current.source === 'paste' && current.phase !== 'parsing') {
      resolved.value = false
      state.value = createInputState('idle', 'paste')
    }
  }

  async function parsePaste(): Promise<void> {
    state.value = createInputState('parsing', 'paste')
    resolved.value = false
    const result = await importArticleFromPaste({ text: pasteText })
    presentImportResult(result, 'paste')
  }

  async function chooseFile(): Promise<void> {
    if (!fileImportAvailable) {
      showInputError('file', fileImportReason)
      return
    }

    state.value = createInputState('parsing', 'file')
    resolved.value = false
    let files: ImportedTextFile[]
    try {
      files = await services.files.pickTextFiles({
        multiple: false,
        acceptedExtensions: ['.txt', '.md'],
      })
    }
    catch {
      showInputError('file', '无法打开文件选择器，请重试或改用粘贴文本。')
      return
    }

    if (files.length === 0) {
      state.value = createInputState('idle', 'file')
      return
    }
    if (files.length > 1) {
      showInputError('file', '一次只能导入一个文件，请重新选择。')
      return
    }

    selectedFile = files[0] ?? null
    await parseSelectedFile()
  }

  async function importDroppedFiles(payload: unknown): Promise<void> {
    if (!fileDropAvailable) {
      showInputError('file', fileImportReason)
      return
    }

    let files: ImportedTextFile[]
    try {
      files = services.files.getDroppedTextFiles(payload)
    }
    catch {
      showInputError('file', '无法读取拖放的文件，请改用文件选择器。')
      return
    }

    if (files.length === 0) {
      showInputError('file', '没有检测到可导入的文件，请选择 .txt 或 .md。')
      return
    }
    if (files.length > 1) {
      showInputError('file', '一次只能导入一个文件，请重新拖放。')
      return
    }

    selectedFile = files[0] ?? null
    await parseSelectedFile()
  }

  async function parseSelectedFile(): Promise<void> {
    if (!selectedFile) {
      await chooseFile()
      return
    }

    const file = selectedFile
    state.value = createInputState('parsing', 'file')
    resolved.value = false
    const result = await importArticleFromTextFile({
      file: {
        name: file.name,
        size: file.size,
        type: file.mediaType,
        text: () => file.text(),
      },
    })
    presentImportResult(result, 'file')
  }

  function presentImportResult(
    result: ImportArticleResult,
    source: ImportInputSource,
  ): void {
    if (!result.ok) {
      showInputError(source, toImportMessage(result.code, source))
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

  function showInputError(source: ImportInputSource, message: string): void {
    state.value = {
      phase: 'error',
      source,
      text: pasteText,
      fileName: selectedFile?.name ?? '',
      message,
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
          validationMessage: toImportMessage(result.code, current.draft.source.kind),
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
        validationMessage: toImportMessage(reparsed.code, current.draft.source.kind),
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
    if (current.phase === 'duplicate') {
      analysisVersion += 1
      resolved.value = false
      state.value = {
        phase: 'preview',
        draft: current.draft,
        title: current.title,
        body: current.body,
        validationMessage: '',
      }
      return
    }
    if (current.phase === 'preview' || current.phase === 'saving') {
      analysisVersion += 1
      resolved.value = false
      const source = current.draft.source.kind === 'file' ? 'file' : 'paste'
      if (source === 'paste') {
        pasteText = current.body
      }
      state.value = createInputState('idle', source)
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
    inputSource,
    canPersist,
    fileImportAvailable,
    fileImportReason,
    fileDropAvailable,
    isDirty,
    setInputSource,
    setSourceText,
    parsePaste,
    chooseFile,
    importDroppedFiles,
    parseSelectedFile,
    updateTitle,
    updateSourceLabel,
    updateBody,
    save,
    cancelPreview,
    acceptDuplicate,
  }
}

function isInputState(state: ImportFlowState): state is ImportFlowInputState {
  return state.phase === 'idle' || state.phase === 'parsing' || state.phase === 'error'
}

function toImportMessage(code: string, source: ImportSourceType): string {
  if (source === 'file') {
    const fileMessages: Record<string, string> = {
      'empty-input': '这个文件没有可阅读的正文，请选择其他文件。',
      'unsupported-file-type': '目前只支持 .txt 和 .md 文件。PDF、Word 与富文本尚未支持。',
      'file-too-large': '文件过大；单个文件请控制在 250 KB 以内。',
      'file-read-failed': '无法按 UTF-8 读取这个文件，请转换编码后重试。',
    }
    if (fileMessages[code]) {
      return fileMessages[code]
    }
  }

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
