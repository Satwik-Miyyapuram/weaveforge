// The page values Overleaf's IDE reads with getMeta(). On overleaf.com they are
// <meta> tags its server renders; here the host supplies them, so the vendored
// code runs unchanged. Server-only features are switched off, and no Overleaf
// secret (CSRF token, user email) is ever put here.

import type { Meta } from '../frontend/js/utils/meta'
import type { ExposedSettings } from '../types/exposed-settings'
import type { User } from '../types/user'
import type { UserSettings } from '../types/user-settings'

export type HostMeta = Pick<
  Meta,
  | 'ol-project_id'
  | 'ol-wsUrl'
  | 'ol-i18n'
  | 'ol-ExposedSettings'
  | 'ol-user'
  | 'ol-user_id'
  | 'ol-anonymous'
  | 'ol-capabilities'
  | 'ol-splitTestVariants'
  | 'ol-otMigrationStage'
  | 'ol-compileSettings'
  | 'ol-editorThemes'
  | 'ol-legacyEditorThemes'
  | 'ol-overallThemes'
  | 'ol-userSettings'
  | 'ol-languages'
  | 'ol-learnedWords'
  | 'ol-imageNames'
  | 'ol-projectTags'
  | 'ol-maxDocLength'
  | 'ol-useShareJsHash'
  | 'ol-detachRole'
>

// Files the editor opens as text; anything else is shown as a binary file.
const TEXT_EXTENSIONS = [
  'tex', 'latex', 'sty', 'cls', 'bst', 'bib', 'bibtex', 'txt', 'tikz', 'mtx',
  'rtex', 'md', 'asy', 'lbx', 'bbx', 'cbx', 'm', 'lco', 'dtx', 'ins', 'ist',
  'def', 'clo', 'ldf', 'rmd', 'lua', 'gv', 'mf', 'yml', 'yaml', 'lhs', 'mk',
  'xmpdata', 'cfg', 'rnw', 'ltx', 'inc', 'csv', 'tsv', 'json', 'py', 'r',
]

const SETTINGS: ExposedSettings = {
  adminEmail: '',
  appName: 'WeaveForge',
  cookieDomain: '',
  dropboxAppName: '',
  emailConfirmationDisabled: true,
  enableSubscriptions: false,
  hasAffiliationsFeature: false,
  hasLinkUrlFeature: false,
  hasLinkedProjectFileFeature: false,
  hasLinkedProjectOutputFileFeature: false,
  hasSamlFeature: false,
  ieeeBrandId: 0,
  isOverleaf: false,
  env: 'server-ce',
  maxEntitiesPerProject: 2000,
  projectUploadTimeout: 120000,
  maxUploadSize: 50 * 1024 * 1024,
  recaptchaDisabled: { invite: true, login: true, passwordReset: true, register: true, addEmail: true },
  sentryAllowedOriginRegex: '',
  siteUrl: 'https://www.overleaf.com',
  textExtensions: TEXT_EXTENSIONS,
  editableFilenames: ['latexmkrc', '.latexmkrc', 'makefile', 'gnumakefile'],
  validRootDocExtensions: ['tex', 'Rtex', 'ltx', 'Rnw'],
  fileIgnorePattern:
    '**/{{__MACOSX,.git,.texpadtmp,.R,.venv,venv}{,/**},.!(latexmkrc),*.{dvi,aux,log,toc,out,pdfsync,synctex,synctex(busy),fdb_latexmk,fls,nlo,ind,glo,gls,glg,bbl,blg,doc,docx,gz,swp}}',
  labsEnabled: false,
  wikiEnabled: false,
  templatesEnabled: false,
  enablePandocConversions: false,
}

type BuildOptions = {
  projectId: string
  /** The app's mode; the IDE and its editor follow it. */
  dark?: boolean
  /** Overleaf's defaultSettings, passed in: its module reads window on load. */
  settings?: UserSettings
}

export function buildMeta({ projectId, dark = false, settings }: BuildOptions): HostMeta {
  return {
    'ol-project_id': projectId,
    // The bridge on window.io ignores the URL; the live link knows Overleaf's.
    'ol-wsUrl': '',
    'ol-i18n': { currentLangCode: 'en' },
    'ol-ExposedSettings': SETTINGS,
    'ol-user': { id: '', email: '' } as unknown as User,
    'ol-user_id': undefined,
    'ol-anonymous': false,
    'ol-capabilities': [],
    'ol-splitTestVariants': {},
    // History OT is shimmed out, so stay on ShareJS ops.
    'ol-otMigrationStage': 0,
    'ol-compileSettings': { compileTimeout: 180 },
    'ol-editorThemes': [
      { name: 'textmate', dark: false },
      { name: 'overleaf_dark', dark: true },
    ],
    'ol-legacyEditorThemes': [],
    'ol-overallThemes': [],
    // Overleaf's own names: '' is its dark theme, 'light-' its light one.
    'ol-userSettings': {
      ...(settings as UserSettings),
      overallTheme: dark ? '' : 'light-',
      editorTheme: dark ? 'overleaf_dark' : 'textmate',
    },
    'ol-languages': [],
    'ol-learnedWords': [],
    'ol-imageNames': [],
    'ol-projectTags': [],
    'ol-maxDocLength': 2 * 1024 * 1024,
    'ol-useShareJsHash': true,
    'ol-detachRole': '',
  }
}

/** Puts the values where getMeta() looks first, before any <meta> tag. */
export function installMeta(meta: HostMeta, cache: Map<string, unknown>) {
  for (const [name, value] of Object.entries(meta)) cache.set(name, value)
}
