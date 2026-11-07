import NoSelectionPane from './no-selection-pane'
import { Editor } from '../layout/editor'
import { useFileTreeOpenContext } from '../../context/file-tree-open-context'
import FileView from '../../../file-view/components/file-view'
import { fileViewFile } from '../../util/file-view'
import MultipleSelectionPane from './multiple-selection-pane'
import { TabsContainer } from '../../../source-editor/components/tabs/tabs-container'
import { useAreTabsEnabled } from '../../hooks/use-are-tabs-enabled'

export default function EditorPanel() {
  const { selectedEntityCount, openEntity } = useFileTreeOpenContext()
  const tabsEnabled = useAreTabsEnabled()

  return (
    <div className="ide-redesign-editor-container">
      {tabsEnabled && <TabsContainer />}
      {selectedEntityCount === 0 && <NoSelectionPane />}
      {selectedEntityCount === 1 && openEntity?.type === 'fileRef' && (
        <FileView
          file={fileViewFile(openEntity.entity)}
          key={openEntity.entity._id}
        />
      )}
      {selectedEntityCount > 1 && (
        <MultipleSelectionPane selectedEntityCount={selectedEntityCount} />
      )}
      <Editor />
    </div>
  )
}
