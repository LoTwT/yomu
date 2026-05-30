import type { ArticleSentence, ArticleToken, DailyArticle } from './types'
import { createStableTextHash } from '@/features/import/textHash'
import { createTtsCacheKey } from '@/features/tts/cacheKey'
import { defaultMimoTtsFormat, defaultMimoTtsModel, defaultMimoTtsVoice } from '@/features/tts/mimoPayload'

const publicDomainSentences = [
  'Alice was not a bit hurt, and she jumped up on to her feet in a moment.',
  'She looked up, but it was all dark overhead; before her was another long passage.',
  'There was not a moment to be lost: away went Alice like the wind.',
]

export const publicDomainSampleArticle: DailyArticle = {
  id: 'public-domain-sample-alice-rabbit-hole',
  contentVersion: 'public-domain-sample-2026-05-31',
  language: 'en',
  level: 'B1',
  topic: 'story',
  title: 'Alice Finds the Hall',
  deck: 'A short public-domain example from Alice’s Adventures in Wonderland for trying Yomu before importing your own text.',
  estimatedReadTimeMinutes: 1,
  factSources: [
    {
      title: 'Project Gutenberg eBook #11',
      url: 'https://www.gutenberg.org/ebooks/11',
    },
  ],
  rights: {
    sourceType: 'public-domain',
    rightsStatus: 'public-domain',
    licenseNote: 'Public-domain excerpt from Project Gutenberg eBook #11.',
    ttsAllowed: true,
    translationAllowed: true,
    cacheAllowed: true,
  },
  publicDomainMetadata: {
    title: 'Alice’s Adventures in Wonderland',
    author: 'Lewis Carroll',
    year: '1865',
    sourceUrl: 'https://www.gutenberg.org/ebooks/11',
    sourceArchiveDate: '2025-06-26',
    publicDomainBasis: 'Project Gutenberg lists eBook #11 as public domain in the USA.',
    regionPosture: 'Use as a public-domain example only after confirming the target deployment region accepts this public-domain status.',
    allowedUses: {
      tts: true,
      cache: true,
      translation: true,
    },
    excerptRange: 'Chapter I, Down the Rabbit-Hole; paragraphs beginning “Alice was not a bit hurt” and “There was not a moment to be lost”.',
    providerCachePolicy: 'No prebuilt audio. Sentence audio is generated on demand through the same MiMo privacy prompt and cache policy as BYO text.',
  },
  model: {
    provider: 'public-domain',
    name: 'project-gutenberg-excerpt',
    version: 'm1-sample',
    promptHash: 'none',
  },
  qaStatus: 'approved',
  sentences: publicDomainSentences.map((sentence, index) => toPublicDomainSentence(sentence, index)),
}

function toPublicDomainSentence(sentence: string, index: number): ArticleSentence {
  const textHash = createStableTextHash(sentence)
  const cacheKey = createTtsCacheKey({
    provider: 'mimo',
    model: defaultMimoTtsModel,
    voice: defaultMimoTtsVoice,
    format: defaultMimoTtsFormat,
    textHash,
  })

  return {
    id: `sample-p1-s${index + 1}`,
    order: index,
    original: sentence,
    paragraphIndex: 0,
    textHash,
    annotations: {},
    bilingual: {},
    translation: '',
    tokens: tokenize(sentence).map((token, tokenIndex) => ({
      ...token,
      id: `sample-p1-s${index + 1}-t${tokenIndex + 1}`,
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
  const words = sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 1
  return Math.max(900, Math.round((words / 155) * 60_000))
}
