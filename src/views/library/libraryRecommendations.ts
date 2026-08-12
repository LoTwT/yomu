import { publicDomainSampleArticle } from '@/features/article/publicDomainSample'

export interface LibraryRecommendation {
  id: string
  title: string
  summary: string
  sourceLabel: string
  levelLabel: 'B1' | 'B2'
  estimatedMinutes: number
}

export const LEGACY_TODAY_ARTICLE_ID = 'daily-en-2026-05-25-why-the-brain-loves-sleep'

export const bundledSampleRecommendation: LibraryRecommendation = {
  id: publicDomainSampleArticle.id,
  title: publicDomainSampleArticle.title,
  summary: publicDomainSampleArticle.deck,
  sourceLabel: publicDomainSampleArticle.publicDomainMetadata?.sourceName ?? '公共领域样例',
  levelLabel: publicDomainSampleArticle.level,
  estimatedMinutes: publicDomainSampleArticle.estimatedReadTimeMinutes,
}
