import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { sampleArticle } from '@/features/article/sampleArticle'
import type { DailyArticle } from '@/features/article/types'
import type { SentencePlayer } from '@/features/player/useReadAloudSession'
import { useReadAloudSession } from '@/features/player/useReadAloudSession'

describe('useReadAloudSession', () => {
  it('sets active sentence and advances when the current sentence ends', () => {
    const callbacks: Array<() => void> = []
    const playedSentences: Array<{ text: string, language: string }> = []
    const player: SentencePlayer = {
      playSentence: vi.fn(({ onEnded, text, language }) => {
        callbacks.push(onEnded)
        playedSentences.push({ text, language })
        return { stop: vi.fn() }
      }),
    }

    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.play('s1')
    expect(session.activeSentenceId.value).toBe('s1')
    expect(session.isPlaying.value).toBe(true)
    expect(playedSentences[0]).toEqual({
      text: 'A short walk can change the shape of a difficult afternoon.',
      language: 'en',
    })

    callbacks[0]?.()
    expect(session.activeSentenceId.value).toBe('s2')
    expect(playedSentences[1]).toEqual({
      text: 'Your eyes leave the screen, and your breathing becomes easier.',
      language: 'en',
    })
  })

  it('pauses without changing the active sentence and can repeat it', () => {
    const stop = vi.fn()
    const player: SentencePlayer = {
      playSentence: vi.fn(() => ({ stop })),
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.play('s2')
    session.pause()

    expect(stop).toHaveBeenCalled()
    expect(session.activeSentenceId.value).toBe('s2')
    expect(session.isPlaying.value).toBe(false)

    session.repeat()
    expect(session.activeSentenceId.value).toBe('s2')
    expect(session.isPlaying.value).toBe(true)
  })

  it('keeps visual sentence focus and reports failed audio refs without playing', () => {
    const player: SentencePlayer = {
      playSentence: vi.fn(() => ({ stop: vi.fn() })),
    }
    const article: DailyArticle = {
      ...sampleArticle,
      sentences: [
        {
          ...sampleArticle.sentences[0]!,
          audioRef: { id: 'missing', url: 'missing://audio/s1', durationMs: 0 },
        },
      ],
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(article), player)

    session.play('s1')

    expect(session.activeSentenceId.value).toBe('s1')
    expect(session.isPlaying.value).toBe(false)
    expect(session.audioStatus.value).toBe('failed')
    expect(player.playSentence).not.toHaveBeenCalled()
  })
})
