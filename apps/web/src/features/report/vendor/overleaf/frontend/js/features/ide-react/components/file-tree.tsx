import React, { memo, useCallback, useState } from 'react'
import { useUserContext } from '../../../shared/context/user-context'
import { useIdeReactContext } from '../context/ide-react-context'
import { useConnectionContext } from '../context/connection-context'
import { RefProviders } from '../../../../../types/user'
import FileTreeRoot from '../../file-tree/components/file-tree-root'
import { useFileTreeOpenContext } from '../context/file-tree-open-context'

export const FileTree = memo(function FileTree() {
  const user = useUserContext()
  const { setStartedFreeTrial } = useIdeReactContext()
  const { isConnected, connectionState } = useConnectionContext()
  const { handleFileTreeInit, handleFileTreeSelect, handleFileTreeDelete } =
    useFileTreeOpenContext()

  const [refProviders, setRefProviders] = useState<RefProviders>(
    () => user.refProviders || {}
  )

  const setRefProviderEnabled = useCallback(
    (provider: keyof RefProviders, value = true) => {
      setRefProviders(refProviders => ({ ...refProviders, [provider]: value }))
    },
    []
  )

  return (
    <FileTreeRoot
      refProviders={refProviders}
      setRefProviderEnabled={setRefProviderEnabled}
      setStartedFreeTrial={setStartedFreeTrial}
      isConnected={isConnected || connectionState.reconnectAt !== null}
      onInit={handleFileTreeInit}
      onSelect={handleFileTreeSelect}
      onDelete={handleFileTreeDelete}
    />
  )
})
