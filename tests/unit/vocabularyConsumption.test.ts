/** @vitest-environment jsdom */

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  type Component,
} from 'vue'
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type RouteRecordRaw,
} from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import type { VocabularyContext, VocabularyTerm } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import { useVocabularyLibrary } from '@/features/vocabulary/useVocabularyLibrary'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import ReviewView from '@/views/ReviewView.vue'
import VocabularyView from '@/views/VocabularyView.vue'
import {
  createCompletedReviewAttempt,
  createReviewArticle,
} from './readingReviewTestFixtures'

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('vocabulary consumption surfaces', () => {
  it('maps only available contexts, reports unavailable ones, and searches normalized terms', async () => {
    const article = createReviewArticle('article-vocabulary', 'Vocabulary Article')
    const quiet = createTerm('term-quiet', 'quiet', 'Quiet', 1)
    const bright = createTerm('term-bright', 'bright', 'Bright')
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [quiet, bright],
      vocabularyContexts: [
        createContext(quiet, article.id, article.sentences[0]!.id, 'context-quiet'),
        createContext(quiet, 'deleted-article', 'deleted-sentence', 'context-unavailable'),
      ],
    })
    const library = mountVocabularyLibrary(repositories)

    await vi.waitFor(() => expect(library.status.value).toBe('ready'))
    expect(library.items.value).toHaveLength(2)
    const quietItem = library.items.value.find(item => item.id === quiet.id)
    expect(quietItem).toMatchObject({
      id: quiet.id,
      unavailableContextCount: 2,
    })
    expect(quietItem?.contexts.map(context => context.id))
      .toEqual(['context-quiet'])

    library.query.value = ' QUI '
    await nextTick()
    expect(library.visibleItems.value.map(item => item.id)).toEqual([quiet.id])
    expect(library.selectedItem.value?.id).toBe(quiet.id)

    library.query.value = 'bright'
    await nextTick()
    expect(library.visibleItems.value.map(item => item.id)).toEqual([bright.id])
    expect(library.selectedItem.value?.id).toBe(bright.id)
  })

  it('reloads Words from durable vocabulary when the app becomes active', async () => {
    const article = createReviewArticle('article-words-lifecycle', 'Words Lifecycle')
    const term = createTerm('term-words-lifecycle', 'return', 'Return')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-lifecycle',
    )
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const { host, platform } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain('还没有收藏词'))
    platform.lifecycle.emit('background')
    await storeVocabulary(repositories, term, context)
    expect(host.textContent).not.toContain(context.sentenceText)

    platform.lifecycle.emit('active')
    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    expect(host.textContent).toContain(term.meaning)
  })

  it('rechecks Words after an active event overlaps a stale loading snapshot', async () => {
    const article = createReviewArticle('article-words-stale-load', 'Words Stale Load')
    const term = createTerm('term-words-stale-load', 'fresh', 'Fresh')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-stale-load',
    )
    const durableRepositories = createMemoryLocalRepositories({ articles: [article] })
    const gatedRepositories = gateNextVocabularyReadResult(durableRepositories)
    const releaseStaleLoad = gatedRepositories.holdNextRead()
    const mounted = await mountRouteView('/words', gatedRepositories.repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(gatedRepositories.readCount()).toBe(1))
    mounted.platform.lifecycle.emit('background')
    await storeVocabulary(durableRepositories, term, context)
    mounted.platform.lifecycle.emit('active')
    releaseStaleLoad()

    await vi.waitFor(() => expect(mounted.host.textContent).toContain(context.sentenceText))
    expect(gatedRepositories.readCount()).toBe(2)
  })

  it('keeps the focused Words search node mounted during an active refresh', async () => {
    const selectedArticle = createReviewArticle(
      'article-words-focus-lifecycle',
      'Words Focus Lifecycle',
    )
    const addedArticle = createReviewArticle(
      'article-words-focus-added',
      'Words Focus Added',
    )
    const selectedTerm = createTerm('term-words-focus', 'focus', 'Focus')
    const selectedContext = createContext(
      selectedTerm,
      selectedArticle.id,
      selectedArticle.sentences[0]!.id,
      'context-words-focus',
    )
    const addedTerm = createTerm('term-words-added', 'added', 'Added')
    const addedContext = createContext(
      addedTerm,
      addedArticle.id,
      addedArticle.sentences[0]!.id,
      'context-words-added',
    )
    const durableRepositories = createMemoryLocalRepositories({
      articles: [selectedArticle, addedArticle],
      vocabularyTerms: [selectedTerm],
      vocabularyContexts: [selectedContext],
    })
    const gatedRepositories = gateNextVocabularyRead(durableRepositories)
    const { host, platform } = await mountRouteView('/words', gatedRepositories.repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(selectedContext.sentenceText))
    const search = host.querySelector<HTMLInputElement>('#vocabulary-search-input')!
    search.focus()
    expect(document.activeElement).toBe(search)
    platform.lifecycle.emit('background')
    await storeVocabulary(durableRepositories, addedTerm, addedContext)

    const releaseRefresh = gatedRepositories.holdNextRead()
    platform.lifecycle.emit('active')
    await nextTick()
    expect(host.querySelector('#vocabulary-search-input')).toBe(search)
    expect(document.activeElement).toBe(search)
    releaseRefresh()
    await vi.waitFor(() => expect(
      host.querySelector(`[data-term-id="${addedTerm.id}"]`),
    ).not.toBeNull())
    expect(host.querySelector('#vocabulary-search-input')).toBe(search)
    expect(document.activeElement).toBe(search)
  })

  it('does not supersede a Words action reload when the app becomes active', async () => {
    const article = createReviewArticle('article-words-action-active', 'Words Action Active')
    const term = createTerm('term-words-action-active', 'active', 'Active', 1)
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-action-active',
    )
    const durableRepositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const gatedRepositories = gateNextVocabularyRead(durableRepositories)
    const { host, platform } = await mountRouteView('/words', gatedRepositories.repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const releaseActionReload = gatedRepositories.holdNextRead()
    const removeButton = findButton(host, '删除此上下文')
    removeButton.focus()
    removeButton.click()
    await vi.waitFor(async () => {
      expect(await durableRepositories.vocabularyContexts.get(context.id)).toBeNull()
      expect(gatedRepositories.readCount()).toBe(2)
    })

    platform.lifecycle.emit('active')
    await settle()
    expect(gatedRepositories.readCount()).toBe(2)

    releaseActionReload()
    await vi.waitFor(() => expect(host.textContent).toContain('这个词目前没有可打开的原句'))
    await vi.waitFor(() => expect(document.activeElement)
      .toBe(host.querySelector('.vocabulary-details__title')))
  })

  it('moves Words focus when an active refresh removes the focused durable item', async () => {
    const article = createReviewArticle('article-words-external-remove', 'Words External Remove')
    const term = createTerm('term-words-external-remove', 'remove', 'Remove')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-external-remove',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const { host, platform } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const removeButton = findButton(host, '删除此上下文')
    removeButton.focus()
    platform.lifecycle.emit('background')
    await deleteStoredVocabulary(repositories, term.id, context.id)

    platform.lifecycle.emit('active')
    await vi.waitFor(() => expect(host.textContent).toContain('还没有收藏词'))
    await vi.waitFor(() => expect(document.activeElement).toBe(
      findHeading(host, '还没有收藏词'),
    ))
  })

  it('moves Words source focus when its Context disappears during an active refresh', async () => {
    const article = createReviewArticle('article-words-source-remove', 'Words Source Remove')
    const term = createTerm('term-words-source-remove', 'source', 'Source', 1)
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-source-remove',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const { host, platform } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const sourceButton = findButton(host, '回到原句')
    sourceButton.focus()
    platform.lifecycle.emit('background')
    await repositories.vocabularyContexts.delete(context.id)

    platform.lifecycle.emit('active')
    await vi.waitFor(() => expect(host.textContent).toContain('这个词目前没有可打开的原句'))
    await vi.waitFor(() => expect(document.activeElement).toBe(
      host.querySelector('.vocabulary-details__title'),
    ))
  })

  it('reloads Review vocabulary from durable state when the app becomes active', async () => {
    const article = createReviewArticle('article-review-lifecycle', 'Review Lifecycle')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-lifecycle')
    const term = createTerm('term-review-lifecycle', 'return', 'Return')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-lifecycle',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
    })
    const { host, platform } = await mountRouteView(
      `/review/${completed.id}`,
      repositories,
      [
        {
          ...route('/review/:attemptId', 'review', ReviewView),
          props: true,
        },
        route('/', 'library', stateView('Library')),
        route('/read/:articleId', 'reader', stateView('Reader')),
      ],
    )

    await vi.waitFor(() => expect(host.textContent).toContain('这篇文章还没有收藏词'))
    platform.lifecycle.emit('background')
    await storeVocabulary(repositories, term, context)
    expect(host.textContent).not.toContain(context.sentenceText)

    platform.lifecycle.emit('active')
    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    expect(host.textContent).toContain(term.meaning)
  })

  it('rechecks Review after an active event overlaps a stale loading snapshot', async () => {
    const article = createReviewArticle('article-review-stale-load', 'Review Stale Load')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-stale-load')
    const term = createTerm('term-review-stale-load', 'fresh', 'Fresh')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-stale-load',
    )
    const durableRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
    })
    const gatedRepositories = gateNextVocabularyReadResult(durableRepositories)
    const releaseStaleLoad = gatedRepositories.holdNextRead()
    const mounted = await mountRouteView(
      `/review/${completed.id}`,
      gatedRepositories.repositories,
      [
        {
          ...route('/review/:attemptId', 'review', ReviewView),
          props: true,
        },
        route('/', 'library', stateView('Library')),
        route('/read/:articleId', 'reader', stateView('Reader')),
      ],
    )

    await vi.waitFor(() => expect(gatedRepositories.readCount()).toBe(1))
    mounted.platform.lifecycle.emit('background')
    await storeVocabulary(durableRepositories, term, context)
    mounted.platform.lifecycle.emit('active')
    releaseStaleLoad()

    await vi.waitFor(() => expect(mounted.host.textContent).toContain(context.sentenceText))
    expect(gatedRepositories.readCount()).toBe(2)
  })

  it('keeps the focused Review undo node mounted during an active refresh', async () => {
    const article = createReviewArticle('article-review-focus-lifecycle', 'Review Focus Lifecycle')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-focus-lifecycle')
    const focusedTerm = createTerm('term-review-focus-lifecycle', 'focus', 'Focus')
    const focusedContext = createContext(
      focusedTerm,
      article.id,
      article.sentences[0]!.id,
      'context-review-focus-lifecycle',
    )
    const addedTerm = createTerm('term-review-focus-added', 'added', 'Added')
    const addedContext = createContext(
      addedTerm,
      article.id,
      article.sentences[0]!.id,
      'context-review-focus-added',
    )
    const durableRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [focusedTerm],
      vocabularyContexts: [focusedContext],
    })
    const gatedRepositories = gateNextVocabularyRead(durableRepositories)
    const { host, platform } = await mountRouteView(
      `/review/${completed.id}`,
      gatedRepositories.repositories,
      [
        {
          ...route('/review/:attemptId', 'review', ReviewView),
          props: true,
        },
        route('/', 'library', stateView('Library')),
        route('/read/:articleId', 'reader', stateView('Reader')),
      ],
    )

    await vi.waitFor(() => expect(host.textContent).toContain(focusedContext.sentenceText))
    const undoButton = host.querySelector<HTMLButtonElement>(
      `[data-context-id="${focusedContext.id}"]`,
    )!
    undoButton.focus()
    expect(document.activeElement).toBe(undoButton)
    platform.lifecycle.emit('background')
    await storeVocabulary(durableRepositories, addedTerm, addedContext)

    const releaseRefresh = gatedRepositories.holdNextRead()
    platform.lifecycle.emit('active')
    await nextTick()
    expect(host.querySelector(`[data-context-id="${focusedContext.id}"]`)).toBe(undoButton)
    expect(document.activeElement).toBe(undoButton)
    releaseRefresh()
    await vi.waitFor(() => expect(host.textContent).toContain(addedContext.sentenceText))
    expect(host.querySelector(`[data-context-id="${focusedContext.id}"]`)).toBe(undoButton)
    expect(document.activeElement).toBe(undoButton)
  })

  it('does not supersede a Review action reload when the app becomes active', async () => {
    const article = createReviewArticle('article-review-action-active', 'Review Action Active')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-action-active')
    const term = createTerm('term-review-action-active', 'active', 'Active')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-action-active',
    )
    const durableRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const gatedRepositories = gateNextVocabularyRead(durableRepositories)
    const { host, platform } = await mountRouteView(
      `/review/${completed.id}`,
      gatedRepositories.repositories,
      [
        {
          ...route('/review/:attemptId', 'review', ReviewView),
          props: true,
        },
        route('/', 'library', stateView('Library')),
        route('/read/:articleId', 'reader', stateView('Reader')),
      ],
    )

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const releaseActionReload = gatedRepositories.holdNextRead()
    const undoButton = findButton(host, '撤销收藏')
    undoButton.focus()
    undoButton.click()
    await vi.waitFor(async () => {
      expect(await durableRepositories.vocabularyContexts.get(context.id)).toBeNull()
      expect(gatedRepositories.readCount()).toBe(2)
    })

    platform.lifecycle.emit('active')
    await settle()
    expect(gatedRepositories.readCount()).toBe(2)

    releaseActionReload()
    await vi.waitFor(() => expect(host.textContent).toContain('这篇文章还没有收藏词'))
    await vi.waitFor(() => expect(document.activeElement).toBe(
      findHeading(host, '本文收藏词'),
    ))
  })

  it('moves Review focus when an active refresh removes the focused durable item', async () => {
    const article = createReviewArticle('article-review-external-remove', 'Review External Remove')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-external-remove')
    const term = createTerm('term-review-external-remove', 'remove', 'Remove')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-external-remove',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const { host, platform } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const undoButton = findButton(host, '撤销收藏')
    undoButton.focus()
    platform.lifecycle.emit('background')
    await deleteStoredVocabulary(repositories, term.id, context.id)

    platform.lifecycle.emit('active')
    await vi.waitFor(() => expect(host.textContent).toContain('这篇文章还没有收藏词'))
    await vi.waitFor(() => expect(document.activeElement).toBe(
      findHeading(host, '本文收藏词'),
    ))
  })

  it('moves Review source focus when its Context disappears during an active refresh', async () => {
    const article = createReviewArticle('article-review-source-remove', 'Review Source Remove')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-source-remove')
    const term = createTerm('term-review-source-remove', 'source', 'Source')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-source-remove',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const { host, platform } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const sourceButton = findButton(host, '回到原句')
    sourceButton.focus()
    platform.lifecycle.emit('background')
    await repositories.vocabularyContexts.delete(context.id)

    platform.lifecycle.emit('active')
    await vi.waitFor(() => expect(host.textContent).toContain('这篇文章还没有收藏词'))
    await vi.waitFor(() => expect(document.activeElement).toBe(
      findHeading(host, '本文收藏词'),
    ))
  })

  it('focuses the term heading and then the empty heading as Words content disappears', async () => {
    const article = createReviewArticle('article-words-actions', 'Words Actions')
    const term = createTerm('term-actions', 'actions', 'Actions', 1)
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-actions',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const { host } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const search = host.querySelector<HTMLInputElement>('#vocabulary-search-input')!
    search.value = 'missing'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(host.textContent).toContain('没有找到匹配的词'))
    search.value = ''
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))

    const removeContextButton = findButton(host, '删除此上下文')
    removeContextButton.focus()
    removeContextButton.click()
    await vi.waitFor(async () => {
      expect(await repositories.vocabularyContexts.get(context.id)).toBeNull()
      expect(host.textContent).toContain('这个词目前没有可打开的原句')
    })
    const termHeading = host.querySelector<HTMLHeadingElement>('.vocabulary-details__title')!
    await vi.waitFor(() => expect(document.activeElement).toBe(termHeading))

    const deleteTermButton = findButton(host, '取消收藏整个词条')
    deleteTermButton.focus()
    deleteTermButton.click()
    await vi.waitFor(async () => {
      expect(await repositories.vocabularyTerms.get(term.id)).toBeNull()
      expect(host.textContent).toContain('还没有收藏词')
    })
    const emptyHeading = findHeading(host, '还没有收藏词')
    await vi.waitFor(() => expect(document.activeElement).toBe(emptyHeading))
  })

  it('focuses the next Context action after deleting one of several Words sources', async () => {
    const firstArticle = createReviewArticle('article-context-first', 'First Context')
    const secondArticle = createReviewArticle('article-context-second', 'Second Context')
    const term = createTerm('term-context-focus', 'context', 'Context')
    const firstContext = createContext(
      term,
      firstArticle.id,
      firstArticle.sentences[0]!.id,
      'context-focus-a',
    )
    const secondContext = createContext(
      term,
      secondArticle.id,
      secondArticle.sentences[0]!.id,
      'context-focus-b',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [firstArticle, secondArticle],
      vocabularyTerms: [term],
      vocabularyContexts: [firstContext, secondContext],
    })
    const { host } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(findButtons(host, '删除此上下文')).toHaveLength(2))
    const firstRemoveButton = findButtons(host, '删除此上下文')[0]!
    firstRemoveButton.focus()
    firstRemoveButton.click()

    await vi.waitFor(async () => {
      expect(await repositories.vocabularyContexts.get(firstContext.id)).toBeNull()
      expect(findButtons(host, '删除此上下文')).toHaveLength(1)
    })
    const remainingRemoveButton = findButtons(host, '删除此上下文')[0]!
    expect(remainingRemoveButton.dataset.contextId).toBe(secondContext.id)
    await vi.waitFor(() => expect(document.activeElement).toBe(remainingRemoveButton))
  })

  it('focuses Words recovery across a successful delete, failed reload, and retry', async () => {
    const article = createReviewArticle('article-words-reload-focus', 'Words Reload Focus')
    const term = createTerm('term-words-reload-focus', 'steady', 'Steady', 1)
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-reload-focus',
    )
    const baseRepositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const repositories = failNextVocabularyReloadAfterWrite(baseRepositories)
    const { host } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const removeButton = findButton(host, '删除此上下文')
    removeButton.focus()
    removeButton.click()

    await vi.waitFor(async () => {
      expect(await baseRepositories.vocabularyContexts.get(context.id)).toBeNull()
      expect(host.textContent).toContain('收藏词暂时无法读取')
    })
    const retryButton = findButton(host, '重试')
    await vi.waitFor(() => expect(document.activeElement).toBe(retryButton))

    retryButton.click()
    await vi.waitFor(() => expect(host.textContent).toContain('这个词目前没有可打开的原句'))
    const selectedTermButton = host.querySelector<HTMLButtonElement>(
      `[data-term-id="${term.id}"]`,
    )!
    await vi.waitFor(() => expect(document.activeElement).toBe(selectedTermButton))
  })

  it('focuses the next term button after deleting a whole Words term', async () => {
    const article = createReviewArticle('article-next-term', 'Next Term')
    const firstTerm = createTerm('term id with spaces/#', 'alpha', 'Alpha')
    const secondTerm = createTerm('term-beta', 'beta', 'Beta')
    const thirdTerm = createTerm('term-gamma', 'gamma', 'Gamma')
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [firstTerm, secondTerm, thirdTerm],
    })
    const { host } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain('Alpha meaning'))
    const details = host.querySelector<HTMLElement>('.vocabulary-details')!
    const detailsHeading = host.querySelector<HTMLHeadingElement>('.vocabulary-details__title')!
    expect(details.getAttribute('aria-labelledby')).toBe(detailsHeading.id)
    expect(detailsHeading.id).not.toContain(firstTerm.id)
    host.querySelector<HTMLButtonElement>('[data-term-id="term-beta"]')!.click()
    await vi.waitFor(() => expect(host.textContent).toContain('Beta meaning'))
    const deleteButton = findButton(host, '取消收藏整个词条')
    deleteButton.focus()
    deleteButton.click()

    await vi.waitFor(async () => {
      expect(await repositories.vocabularyTerms.get(secondTerm.id)).toBeNull()
      expect(host.textContent).toContain('Gamma meaning')
    })
    const gammaButton = host.querySelector<HTMLButtonElement>('[data-term-id="term-gamma"]')!
    await vi.waitFor(() => expect(document.activeElement).toBe(gammaButton))
  })

  it('uses the sentence query for Words and Review source navigation', async () => {
    const article = createReviewArticle('article-source-navigation', 'Source Navigation')
    const completed = createCompletedReviewAttempt(article, 'attempt-source-navigation')
    const term = createTerm('term-source', 'source', 'Source')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-source',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const routes = [
      route('/words', 'words', VocabularyView),
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ]
    const words = await mountRouteView('/words', repositories, routes)

    await vi.waitFor(() => expect(words.host.textContent).toContain(context.sentenceText))
    findButton(words.host, '回到原句').click()
    await vi.waitFor(() => expect(words.router.currentRoute.value).toMatchObject({
      name: 'reader',
      params: { articleId: article.id },
      query: { sentence: context.sentenceId },
    }))

    const review = await mountRouteView(`/review/${completed.id}`, repositories, routes)
    await vi.waitFor(() => expect(review.host.textContent).toContain('本文收藏词'))
    await vi.waitFor(() => expect(review.host.textContent).toContain(context.sentenceText))
    findButton(review.host, '回到原句').click()
    await vi.waitFor(() => expect(review.router.currentRoute.value).toMatchObject({
      name: 'reader',
      params: { articleId: article.id },
      query: { sentence: context.sentenceId },
    }))
  })

  it('undoes a saved context from Review and focuses its vocabulary heading', async () => {
    const article = createReviewArticle('article-review-undo', 'Review Undo')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-undo')
    const term = createTerm('term-review-undo', 'undo', 'Undo')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-undo',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const { host } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const undoButton = findButton(host, '撤销收藏')
    undoButton.focus()
    undoButton.click()
    await vi.waitFor(async () => {
      expect(await repositories.vocabularyContexts.get(context.id)).toBeNull()
      expect(host.textContent).toContain('这篇文章还没有收藏词')
    })
    expect(host.textContent).toContain(article.title)
    const vocabularyHeading = findHeading(host, '本文收藏词')
    await vi.waitFor(() => expect(document.activeElement).toBe(vocabularyHeading))
  })

  it('focuses the next Review undo action before falling back to the section heading', async () => {
    const article = createReviewArticle('article-review-focus', 'Review Focus')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-focus')
    const firstTerm = createTerm('term-review-alpha', 'alpha', 'Alpha')
    const secondTerm = createTerm('term-review-beta', 'beta', 'Beta')
    const firstContext = createContext(
      firstTerm,
      article.id,
      article.sentences[0]!.id,
      'context-review-alpha',
    )
    const secondContext = createContext(
      secondTerm,
      article.id,
      article.sentences[0]!.id,
      'context-review-beta',
    )
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [firstTerm, secondTerm],
      vocabularyContexts: [firstContext, secondContext],
    })
    const { host } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(findButtons(host, '撤销收藏')).toHaveLength(2))
    const firstUndoButton = findButtons(host, '撤销收藏')[0]!
    firstUndoButton.focus()
    firstUndoButton.click()
    await vi.waitFor(async () => {
      expect(await repositories.vocabularyContexts.get(firstContext.id)).toBeNull()
      expect(findButtons(host, '撤销收藏')).toHaveLength(1)
    })
    const remainingUndoButton = findButtons(host, '撤销收藏')[0]!
    expect(remainingUndoButton.dataset.contextId).toBe(secondContext.id)
    await vi.waitFor(() => expect(document.activeElement).toBe(remainingUndoButton))

    remainingUndoButton.click()
    await vi.waitFor(async () => {
      expect(await repositories.vocabularyContexts.get(secondContext.id)).toBeNull()
      expect(host.textContent).toContain('这篇文章还没有收藏词')
    })
    await vi.waitFor(() => expect(document.activeElement).toBe(
      findHeading(host, '本文收藏词'),
    ))
  })

  it('focuses Review recovery across a successful undo, failed reload, and retry', async () => {
    const article = createReviewArticle('article-review-reload-focus', 'Review Reload Focus')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-reload-focus')
    const firstTerm = createTerm('term-review-reload-first', 'first', 'First')
    const secondTerm = createTerm('term-review-reload-second', 'second', 'Second')
    const firstContext = createContext(
      firstTerm,
      article.id,
      article.sentences[0]!.id,
      'context-review-reload-first',
    )
    const secondContext = createContext(
      secondTerm,
      article.id,
      article.sentences[0]!.id,
      'context-review-reload-second',
    )
    const baseRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [firstTerm, secondTerm],
      vocabularyContexts: [firstContext, secondContext],
    })
    const repositories = failNextVocabularyReloadAfterWrite(baseRepositories)
    const { host } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(findButtons(host, '撤销收藏')).toHaveLength(2))
    const firstUndoButton = findButtons(host, '撤销收藏')[0]!
    firstUndoButton.focus()
    firstUndoButton.click()

    await vi.waitFor(async () => {
      expect(await baseRepositories.vocabularyContexts.get(firstContext.id)).toBeNull()
      expect(host.textContent).toContain('本文收藏词暂时无法读取')
    })
    const retryButton = findButton(host, '重试收藏词')
    await vi.waitFor(() => expect(document.activeElement).toBe(retryButton))

    retryButton.click()
    await vi.waitFor(() => expect(findButtons(host, '撤销收藏')).toHaveLength(1))
    const remainingUndoButton = findButtons(host, '撤销收藏')[0]!
    expect(remainingUndoButton.dataset.contextId).toBe(secondContext.id)
    await vi.waitFor(() => expect(document.activeElement).toBe(remainingUndoButton))
  })

  it('keeps the saved context visible when a Words removal fails', async () => {
    const article = createReviewArticle('article-words-failure', 'Words Failure')
    const term = createTerm('term-words-failure', 'failure', 'Failure')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-words-failure',
    )
    const baseRepositories = createMemoryLocalRepositories({
      articles: [article],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const repositories = failReadwriteVocabularyTransactions(baseRepositories)
    const { host } = await mountRouteView('/words', repositories, [
      route('/words', 'words', VocabularyView),
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const removeButton = findButton(host, '删除此上下文')
    removeButton.focus()
    removeButton.click()
    await vi.waitFor(() => expect(host.textContent).toContain('暂时无法删除这条收藏上下文'))
    expect(await baseRepositories.vocabularyContexts.get(context.id)).toEqual(context)
    expect(host.textContent).toContain(context.sentenceText)
    await vi.waitFor(() => expect(document.activeElement).toBe(removeButton))

    const deleteButton = findButton(host, '取消收藏整个词条')
    deleteButton.focus()
    deleteButton.click()
    await vi.waitFor(() => expect(host.textContent).toContain('暂时无法取消收藏这个词条'))
    await vi.waitFor(() => expect(document.activeElement).toBe(deleteButton))
  })

  it('keeps the failed Review undo action focused', async () => {
    const article = createReviewArticle('article-review-focus-failure', 'Review Focus Failure')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-focus-failure')
    const term = createTerm('term-review-focus-failure', 'failure', 'Failure')
    const context = createContext(
      term,
      article.id,
      article.sentences[0]!.id,
      'context-review-focus-failure',
    )
    const baseRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const repositories = failReadwriteVocabularyTransactions(baseRepositories)
    const { host } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(context.sentenceText))
    const undoButton = findButton(host, '撤销收藏')
    undoButton.focus()
    undoButton.click()
    await vi.waitFor(() => expect(host.textContent).toContain('暂时无法撤销这条收藏'))
    expect(await baseRepositories.vocabularyContexts.get(context.id)).toEqual(context)
    await vi.waitFor(() => expect(document.activeElement).toBe(undoButton))
  })

  it('keeps Review usable when vocabulary loading fails', async () => {
    const article = createReviewArticle('article-review-vocabulary-error', 'Review survives')
    const completed = createCompletedReviewAttempt(article, 'attempt-review-vocabulary-error')
    const baseRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
    })
    const repositories = failReadonlyVocabularyTransactions(baseRepositories)
    const { host } = await mountRouteView(`/review/${completed.id}`, repositories, [
      {
        ...route('/review/:attemptId', 'review', ReviewView),
        props: true,
      },
      route('/', 'library', stateView('Library')),
      route('/read/:articleId', 'reader', stateView('Reader')),
    ])

    await vi.waitFor(() => expect(host.textContent).toContain(article.title))
    expect(host.textContent).toContain('阅读回顾仍可使用')
    expect(host.textContent).toContain('再读一次')
  })
})

function mountVocabularyLibrary(repositories: LocalRepositories) {
  let result!: ReturnType<typeof useVocabularyLibrary>
  const Root = defineComponent({
    setup() {
      result = useVocabularyLibrary()
      return () => h('div')
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Root)
  mountedApps.push(app)
  app.provide(platformServicesKey, createFakePlatformServices({ repositories }).services)
  app.mount(host)
  return result
}

async function mountRouteView(
  path: string,
  repositories: LocalRepositories,
  routes: RouteRecordRaw[],
) {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const app = createApp(defineComponent({
    setup: () => () => h(RouterView),
  }))
  const platform = createFakePlatformServices({ repositories })
  mountedApps.push(app)
  app.provide(platformServicesKey, platform.services)
  app.use(router)
  app.mount(host)
  await settle()
  return { app, host, platform, router }
}

function route(
  path: string,
  name: string,
  component: Component,
): RouteRecordRaw {
  return { path, name, component }
}

function stateView(label: string): Component {
  return defineComponent({
    setup: () => () => h('p', label),
  })
}

function createTerm(
  id: string,
  normalizedTerm: string,
  displayTerm: string,
  orphanedContextCount = 0,
): VocabularyTerm {
  return {
    id,
    normalizedTerm,
    displayTerm,
    meaning: `${displayTerm} meaning`,
    orphanedContextCount,
    savedAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
  }
}

function createContext(
  term: VocabularyTerm,
  articleId: string,
  sentenceId: string,
  id: string,
): VocabularyContext {
  return {
    id,
    termId: term.id,
    articleId,
    sentenceId,
    sentenceText: `A saved sentence for ${term.displayTerm}.`,
    displayTerm: term.displayTerm,
    savedAt: '2026-08-10T09:01:00.000Z',
  }
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = findButtons(host, label)[0]
  expect(button, `button containing ${label}`).toBeDefined()
  return button!
}

function findButtons(host: HTMLElement, label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button')]
    .filter(candidate => candidate.textContent?.includes(label))
}

function findHeading(host: HTMLElement, label: string): HTMLHeadingElement {
  const heading = [...host.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')]
    .find(candidate => candidate.textContent?.includes(label))
  expect(heading, `heading containing ${label}`).toBeDefined()
  return heading!
}

async function storeVocabulary(
  repositories: LocalRepositories,
  term: VocabularyTerm,
  context: VocabularyContext,
): Promise<void> {
  await repositories.transaction(
    ['vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      await scope.vocabularyTerms.put(term)
      await scope.vocabularyContexts.put(context)
    },
  )
}

async function deleteStoredVocabulary(
  repositories: LocalRepositories,
  termId: string,
  contextId: string,
): Promise<void> {
  await repositories.transaction(
    ['vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      await scope.vocabularyContexts.delete(contextId)
      await scope.vocabularyTerms.delete(termId)
    },
  )
}

function gateNextVocabularyRead(repositories: LocalRepositories): {
  repositories: LocalRepositories
  holdNextRead: () => () => void
  readCount: () => number
} {
  let heldRead: Promise<void> | null = null
  let readonlyReadCount = 0
  return {
    repositories: new Proxy(repositories, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: Parameters<LocalRepositories['transaction']>) => {
            const [stores, mode] = args
            const pendingRead = heldRead
            if (pendingRead
              && mode === 'readonly'
              && stores.includes('vocabularyTerms')) {
              readonlyReadCount += 1
              heldRead = null
              await pendingRead
            }
            else if (mode === 'readonly' && stores.includes('vocabularyTerms')) {
              readonlyReadCount += 1
            }
            return target.transaction(...args)
          }
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
    holdNextRead() {
      if (heldRead) {
        throw new Error('A vocabulary read is already held')
      }
      let release!: () => void
      heldRead = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    },
    readCount: () => readonlyReadCount,
  }
}

function gateNextVocabularyReadResult(repositories: LocalRepositories): {
  repositories: LocalRepositories
  holdNextRead: () => () => void
  readCount: () => number
} {
  let heldResult: Promise<void> | null = null
  let readonlyReadCount = 0
  return {
    repositories: new Proxy(repositories, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: Parameters<LocalRepositories['transaction']>) => {
            const [stores, mode] = args
            const result = await target.transaction(...args)
            if (mode === 'readonly' && stores.includes('vocabularyTerms')) {
              readonlyReadCount += 1
              const pendingResult = heldResult
              if (pendingResult) {
                heldResult = null
                await pendingResult
              }
            }
            return result
          }
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
    holdNextRead() {
      if (heldResult) {
        throw new Error('A vocabulary read result is already held')
      }
      let release!: () => void
      heldResult = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    },
    readCount: () => readonlyReadCount,
  }
}

function failReadonlyVocabularyTransactions(
  repositories: LocalRepositories,
): LocalRepositories {
  return new Proxy(repositories, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (...args: Parameters<LocalRepositories['transaction']>) => {
          if (args[0].includes('vocabularyTerms') && args[1] === 'readonly') {
            throw new Error('Vocabulary unavailable')
          }
          return target.transaction(...args)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function failReadwriteVocabularyTransactions(
  repositories: LocalRepositories,
): LocalRepositories {
  return new Proxy(repositories, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (...args: Parameters<LocalRepositories['transaction']>) => {
          if (args[0].includes('vocabularyContexts') && args[1] === 'readwrite') {
            throw new Error('Vocabulary write unavailable')
          }
          return target.transaction(...args)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function failNextVocabularyReloadAfterWrite(
  repositories: LocalRepositories,
): LocalRepositories {
  let failNextReadonly = false
  return new Proxy(repositories, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (...args: Parameters<LocalRepositories['transaction']>) => {
          const [stores, mode] = args
          if (failNextReadonly
            && mode === 'readonly'
            && stores.includes('vocabularyTerms')) {
            failNextReadonly = false
            throw new Error('One vocabulary reload unavailable')
          }
          const result = await target.transaction(...args)
          if (mode === 'readwrite' && stores.includes('vocabularyContexts')) {
            failNextReadonly = true
          }
          return result
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}
