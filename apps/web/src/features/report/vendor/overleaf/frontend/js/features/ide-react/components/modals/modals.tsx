import { memo } from 'react'
import ForceDisconnected from './force-disconnected'
import { UnsavedDocs } from '../unsaved-docs/unsaved-docs'
import SystemMessages from '../../../../shared/components/system-messages'
import ViewOnlyAccessModal from '../../../share-project-modal/components/view-only-access-modal'
import ProjectConvertedFromDocumentModal from './project-converted-from-document-modal'

export const Modals = memo(() => {
  return (
    <>
      <ForceDisconnected />
      <UnsavedDocs />
      <SystemMessages />
      <ViewOnlyAccessModal />
      <ProjectConvertedFromDocumentModal />
    </>
  )
})
Modals.displayName = 'Modals'
