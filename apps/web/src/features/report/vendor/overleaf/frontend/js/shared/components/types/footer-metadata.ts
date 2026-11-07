import type { SubdomainLang } from './fat-footer'

export type FooterItem = {
  text: string
  translatedText?: string
  url?: string
  class?: string
  label?: string
}

export type FooterMetadata = {
  showThinFooter: boolean
  translatedLanguages: { [key: string]: string }
  showPoweredBy?: boolean
  subdomainLang?: SubdomainLang
  leftItems?: FooterItem[]
  rightItems?: FooterItem[]
}
