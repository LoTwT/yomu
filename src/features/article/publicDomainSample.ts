import type { ArticleSentence, ArticleToken, DailyArticle, PublicDomainDifficultyKey, PublicDomainDifficultyMetadata } from './types'
import { createStableTextHash } from '@/features/import/textHash'
import { createTtsCacheKey } from '@/features/tts/cacheKey'
import { defaultMimoTtsFormat, defaultMimoTtsModel, defaultMimoTtsVoice } from '@/features/tts/mimoPayload'

export interface PublicDomainDifficultyOption {
  key: PublicDomainDifficultyKey
  label: string
  shortLabel: string
}

interface PublicDomainExcerptSeed {
  id: string
  contentVersion: string
  level: DailyArticle['level']
  title: string
  deck: string
  topic: DailyArticle['topic']
  metadata: {
    id: string
    title: string
    author: string
    publicationYear: string
    sourceUrl: string
    sourceName: string
    retrievedAt: string
    excerptRange: string
    publicDomainBasis: string
    regionPosture: string
    sourceLabel: string
    difficulty: PublicDomainDifficultyMetadata
  }
  sentences: string[]
}

export const publicDomainDifficultyOptions: PublicDomainDifficultyOption[] = [
  { key: 'beginner', label: '约 初级', shortLabel: '初级' },
  { key: 'intermediate', label: '约 中级', shortLabel: '中级' },
  { key: 'advanced', label: '约 进阶', shortLabel: '进阶' },
]

const publicDomainExcerptSeeds: PublicDomainExcerptSeed[] = [
  {
    id: 'public-domain-alice-hall',
    contentVersion: 'public-domain-2026-06-01-alice-hall',
    level: 'B1',
    topic: 'story',
    title: 'Alice Falls and Shrinks',
    deck: 'A short public-domain selection from Alice’s Adventures in Wonderland for trying Yomu before importing your own text.',
    metadata: {
      id: 'gutenberg-11-alice-hall',
      title: 'Alice’s Adventures in Wonderland',
      author: 'Lewis Carroll',
      publicationYear: '1865',
      sourceUrl: 'https://www.gutenberg.org/ebooks/11',
      sourceName: 'Project Gutenberg',
      retrievedAt: '2026-06-01',
      excerptRange: 'Chapter I, Down the Rabbit-Hole; selected source sentences from the rabbit-hole and little-door scenes.',
      publicDomainBasis: 'Project Gutenberg lists eBook #11 as public domain in the USA.',
      regionPosture: 'USA public-domain source; copyright status can vary by region.',
      sourceLabel: 'Project Gutenberg · 美国公共领域;请自行确认所在地区版权。',
      difficulty: {
        key: 'beginner',
        label: '约 初级',
        basis: 'Short source sentences, mostly concrete vocabulary, 9.7 average words per sentence.',
      },
    },
    sentences: [
      'Down, down, down.',
      'There was nothing else to do, so Alice soon began talking again.',
      '“What a curious feeling!” said Alice; “I must be shutting up like a telescope.”',
    ],
  },
  {
    id: 'public-domain-secret-garden-mary',
    contentVersion: 'public-domain-2026-06-01-secret-garden-mary',
    level: 'B1',
    topic: 'story',
    title: 'Mary Arrives in the Story',
    deck: 'A public-domain opening from The Secret Garden with clear character description and simple narration.',
    metadata: {
      id: 'gutenberg-113-secret-garden-opening',
      title: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      publicationYear: '1911',
      sourceUrl: 'https://www.gutenberg.org/ebooks/113',
      sourceName: 'Project Gutenberg',
      retrievedAt: '2026-06-01',
      excerptRange: 'Chapter I, “There Is No One Left”; opening character-description paragraph.',
      publicDomainBasis: 'Project Gutenberg lists eBook #113 as public domain in the USA.',
      regionPosture: 'USA public-domain source; copyright status can vary by region.',
      sourceLabel: 'Project Gutenberg · 美国公共领域;请自行确认所在地区版权。',
      difficulty: {
        key: 'intermediate',
        label: '约 中级',
        basis: 'Longer noun phrases and descriptive clauses, 15.3 average words per sentence.',
      },
    },
    sentences: [
      'When Mary Lennox was sent to Misselthwaite Manor to live with her uncle everybody said she was the most disagreeable-looking child ever seen.',
      'It was true, too.',
      'She had a little thin face and a little thin body, thin light hair and a sour expression.',
    ],
  },
  {
    id: 'public-domain-time-machine-table',
    contentVersion: 'public-domain-2026-06-01-time-machine-table',
    level: 'B2',
    topic: 'story',
    title: 'The Time Traveller Speaks',
    deck: 'A denser public-domain passage from The Time Machine for a more challenging guided reading session.',
    metadata: {
      id: 'gutenberg-35-time-machine-opening',
      title: 'The Time Machine',
      author: 'H. G. Wells',
      publicationYear: '1895',
      sourceUrl: 'https://www.gutenberg.org/ebooks/35',
      sourceName: 'Project Gutenberg',
      retrievedAt: '2026-06-01',
      excerptRange: 'Chapter I, opening dining-room scene.',
      publicDomainBasis: 'Project Gutenberg lists eBook #35 as public domain in the USA.',
      regionPosture: 'USA public-domain source; copyright status can vary by region.',
      sourceLabel: 'Project Gutenberg · 美国公共领域;请自行确认所在地区版权。',
      difficulty: {
        key: 'advanced',
        label: '约 进阶',
        basis: 'Older vocabulary, embedded clauses, and 21.0 average words per sentence.',
      },
    },
    sentences: [
      'The Time Traveller (for so it will be convenient to speak of him) was expounding a recondite matter to us.',
      'His pale grey eyes shone and twinkled, and his usually pale face was flushed and animated.',
      'The fire burnt brightly, and the soft radiance of the incandescent lights in the lilies of silver caught the bubbles that flashed and passed in our glasses.',
    ],
  },
]

export const publicDomainFallbackArticles: DailyArticle[] = publicDomainExcerptSeeds.map(buildPublicDomainArticle)

export const publicDomainSampleArticle: DailyArticle = publicDomainFallbackArticles[0]!

export function getPublicDomainFallbackArticle(difficulty: PublicDomainDifficultyKey): DailyArticle {
  return publicDomainFallbackArticles.find(article => article.publicDomainMetadata?.difficulty.key === difficulty)
    ?? publicDomainSampleArticle
}

function buildPublicDomainArticle(seed: PublicDomainExcerptSeed): DailyArticle {
  const wordCount = seed.sentences.reduce((sum, sentence) => sum + countWords(sentence), 0)

  return {
    id: seed.id,
    contentVersion: seed.contentVersion,
    language: 'en',
    level: seed.level,
    topic: seed.topic,
    title: seed.title,
    deck: seed.deck,
    estimatedReadTimeMinutes: Math.max(1, Math.ceil(wordCount / 130)),
    factSources: [
      {
        title: `${seed.metadata.sourceName} eBook`,
        url: seed.metadata.sourceUrl,
      },
    ],
    rights: {
      sourceType: 'public-domain',
      rightsStatus: 'public-domain',
      licenseNote: `${seed.metadata.sourceLabel}. ${seed.metadata.publicDomainBasis}`,
      ttsAllowed: true,
      translationAllowed: true,
      cacheAllowed: true,
    },
    publicDomainMetadata: {
      ...seed.metadata,
      language: 'en',
      rightsStatus: 'public-domain-us',
      allowedUses: {
        tts: true,
        cache: true,
        translation: true,
      },
      noRewrite: true,
      providerCachePolicy: 'No prebuilt audio. Sentence audio is generated on demand through the same TTS provider privacy prompt and cache policy as BYO text.',
    },
    model: {
      provider: 'public-domain',
      name: 'project-gutenberg-curated-excerpt',
      version: 'm3-fallback-pool',
      promptHash: 'none',
    },
    qaStatus: 'approved',
    sentences: seed.sentences.map((sentence, index) => toPublicDomainSentence(seed.id, sentence, index)),
  }
}

function toPublicDomainSentence(articleId: string, sentence: string, index: number): ArticleSentence {
  const textHash = createStableTextHash(sentence)
  const cacheKey = createTtsCacheKey({
    provider: 'mimo',
    model: defaultMimoTtsModel,
    voice: defaultMimoTtsVoice,
    format: defaultMimoTtsFormat,
    textHash,
  })
  const sentenceId = `${articleId}-s${index + 1}`

  return {
    id: sentenceId,
    order: index,
    original: sentence,
    paragraphIndex: 0,
    textHash,
    annotations: {},
    bilingual: {},
    translation: '',
    tokens: tokenize(sentence).map((token, tokenIndex) => ({
      ...token,
      id: `${sentenceId}-t${tokenIndex + 1}`,
    })),
    audioRef: {
      id: `tts-${textHash}`,
      url: `missing://tts-consent-required/${textHash}`,
      durationMs: estimateDurationMs(sentence),
    },
    audio: {
      cacheKey,
      status: 'idle',
    },
  }
}

function tokenize(sentence: string): Array<Omit<ArticleToken, 'id'>> {
  return sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+(?:\.[0-9]+)?|[^\sA-Za-z0-9]/g)
    ?.map(token => ({
      text: token,
      kind: /[A-Za-z0-9]/.test(token) ? 'word' : 'punctuation',
    })) ?? []
}

function estimateDurationMs(sentence: string): number {
  const words = countWords(sentence)
  return Math.max(900, Math.round((words / 155) * 60_000))
}

function countWords(sentence: string): number {
  return sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length ?? 1
}
