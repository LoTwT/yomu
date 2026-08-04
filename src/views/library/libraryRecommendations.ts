export interface LibraryRecommendation {
  id: string
  title: string
  summary: string
  sourceLabel: string
  levelLabel: 'B1' | 'B2'
  estimatedMinutes: number
}

export const LEGACY_TODAY_ARTICLE_ID = 'daily-en-2026-05-25-why-the-brain-loves-sleep'

export const todayRecommendation: LibraryRecommendation = {
  id: LEGACY_TODAY_ARTICLE_ID,
  title: 'Why the Brain Loves Sleep',
  summary: '用一篇内置英文样例体验逐句阅读和朗读。',
  sourceLabel: 'Today 示例',
  levelLabel: 'B1',
  estimatedMinutes: 5,
}
