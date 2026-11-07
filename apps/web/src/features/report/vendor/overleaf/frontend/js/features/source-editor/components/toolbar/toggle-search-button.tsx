import { FC } from 'react'
import * as commands from '../../extensions/toolbar/commands'
import { searchPanelOpen } from '../../../../../../codemirror/search/index.js'
import { ToolbarButton } from './toolbar-button'
import { EditorState } from '@codemirror/state'
import { useTranslation } from 'react-i18next'
import { isMac } from '../../../../shared/utils/os'

export const ToggleSearchButton: FC<{ state: EditorState }> = ({ state }) => {
  const { t } = useTranslation()

  return (
    <ToolbarButton
      id="toolbar-toggle-search"
      label={t('toolbar_search_file')}
      command={commands.toggleSearch}
      active={searchPanelOpen(state)}
      icon="search"
      shortcut={isMac ? '⌘F' : 'Ctrl+F'}
    />
  )
}
