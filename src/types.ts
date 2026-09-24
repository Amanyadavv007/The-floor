// Shared types for The Floor (used by both the app and the cloud sync layer).

export interface CatItem {
  id: string
  label: string
}
export interface CatConfig {
  label: string
  ideal: string
  floor: string
  ifthen: string
  type: 'multi' | 'single'
  items?: CatItem[]
}
export type CategoryId = 'physical' | 'study' | 'diet' | 'english'
export interface Config {
  startDate: string
  categories: Record<CategoryId, CatConfig>
}
export type DayLog = Record<string, unknown>
export interface State {
  config: Config
  logs: Record<string, DayLog>
}
