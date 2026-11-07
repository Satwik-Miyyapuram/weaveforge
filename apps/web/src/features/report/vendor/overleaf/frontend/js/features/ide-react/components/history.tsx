import { createPortal } from 'react-dom'
import HistoryFileTree from '../../history/components/history-file-tree'
import LoadingSpinner from '../../../shared/components/loading-spinner'
import DiffView from '../../history/components/diff-view/diff-view'
import ChangeList from '../../history/components/change-list/change-list'
import { useHistoryContext } from '../../history/context/history-context'

export default function History() {
  const { updatesInfo } = useHistoryContext()
  const fileTreeContainer = document.getElementById('history-file-tree')

  return (
    <>
      {fileTreeContainer &&
        createPortal(<HistoryFileTree />, fileTreeContainer)}
      <div className="history-react">
        {updatesInfo.loadingState === 'loadingInitial' ? (
          <LoadingSpinner />
        ) : (
          <>
            <DiffView />
            <ChangeList />
          </>
        )}
      </div>
    </>
  )
}
