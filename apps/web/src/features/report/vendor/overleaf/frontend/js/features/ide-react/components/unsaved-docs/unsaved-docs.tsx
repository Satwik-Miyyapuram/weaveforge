import { FC } from 'react'
import { UnsavedDocsLockedAlert } from './unsaved-docs-locked-alert'
import { UnsavedDocsAlert } from './unsaved-docs-alert'
import { createPortal } from 'react-dom'
import { useGlobalAlertsContainer } from '../../context/global-alerts-context'
import { useUnsavedDocsContext } from '../../context/unsaved-docs-context'
import { useFeatureFlag } from '../../../../shared/context/split-test-context'

export const UnsavedDocs: FC = () => {
  const { unsavedDocs, isLocked } = useUnsavedDocsContext()
  const globalAlertsContainer = useGlobalAlertsContainer()
  const improvedFlakyConnections = useFeatureFlag(
    'intermittent-connection-improvements'
  )

  if (!globalAlertsContainer) {
    return null
  }

  return (
    <>
      {isLocked &&
        createPortal(<UnsavedDocsLockedAlert />, globalAlertsContainer)}

      {!improvedFlakyConnections &&
        unsavedDocs.size > 0 &&
        createPortal(
          <UnsavedDocsAlert unsavedDocs={unsavedDocs} />,
          globalAlertsContainer
        )}
    </>
  )
}
