export interface LibraryArticle {
  id: string
  availability: 'legacy-today' | 'unavailable'
  title: string
  summary?: string
  source: string
  level: 'B1' | 'B2' | '未评估'
  estimatedMinutes: number
  progress: number
  lastOpened: string
  lastSentence?: string
}

export const LEGACY_TODAY_ARTICLE_ID = 'daily-en-2026-05-25-why-the-brain-loves-sleep'

export const continueReadingArticle: LibraryArticle = {
  id: LEGACY_TODAY_ARTICLE_ID,
  availability: 'legacy-today',
  title: 'Why the Brain Loves Sleep',
  summary: 'Every night, your brain does quiet but important work while you sleep. Sleep is not only rest; it is also when the mind organizes and keeps what you learned during the day.',
  source: 'Today',
  level: 'B1',
  estimatedMinutes: 5,
  progress: 42,
  lastOpened: '今天',
  lastSentence: '第 5 / 12 句',
}

export const libraryArticles: readonly LibraryArticle[] = [
  {
    id: 'power-of-small-habits',
    availability: 'unavailable',
    title: 'The Power of Small Habits',
    summary: 'Tiny changes, repeated daily, lead to remarkable results over time.',
    source: 'Aeon',
    level: 'B1',
    estimatedMinutes: 5,
    progress: 60,
    lastOpened: '今天 09:24',
  },
  {
    id: 'hidden-life-of-trees',
    availability: 'unavailable',
    title: 'The Hidden Life of Trees',
    summary: 'Trees communicate, support each other, and store memory.',
    source: 'BBC Future',
    level: 'B2',
    estimatedMinutes: 7,
    progress: 25,
    lastOpened: '昨天 20:11',
  },
  {
    id: 'designing-for-calm',
    availability: 'unavailable',
    title: 'Designing for Calm',
    summary: 'Good design removes noise and helps people focus on what matters.',
    source: 'Smashing Magazine',
    level: 'B1',
    estimatedMinutes: 5,
    progress: 70,
    lastOpened: '5 月 28 日',
  },
  {
    id: 'how-memory-works-while-you-sleep',
    availability: 'unavailable',
    title: 'How Memory Works While You Sleep',
    summary: 'During sleep, the brain strengthens useful connections and clears away what is not needed.',
    source: 'Scientific American',
    level: 'B2',
    estimatedMinutes: 6,
    progress: 15,
    lastOpened: '5 月 22 日',
  },
]

export const recommendedArticle: LibraryArticle = {
  id: 'pride-and-prejudice-excerpt',
  availability: 'unavailable',
  title: 'Pride and Prejudice (Excerpt)',
  summary: 'A classic novel by Jane Austen. Public domain.',
  source: 'Public domain',
  level: 'B1',
  estimatedMinutes: 2,
  progress: 0,
  lastOpened: '尚未开始',
}
