import { useEffect, useState } from 'react'
import { useProjectContext } from '../../../shared/context/project-context'
import { fetchImageUrl } from '../../../../../ol-host/image-url'
import { BinaryFile } from '../types/binary-file'

export default function FileViewImage({
  file,
  onLoad,
  onError,
}: {
  file: BinaryFile
  onLoad: () => void
  onError: () => void
}) {
  const { projectId } = useProjectContext()
  // WeaveForge: load through fetch so the host's bridge serves it.
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let url: string | undefined
    let live = true
    fetchImageUrl(`/project/${projectId}/blob/${file.hash}`).then(
      u => (live ? setSrc((url = u)) : URL.revokeObjectURL(u)),
      () => live && onError()
    )
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [projectId, file.hash]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return null
  return (
    <img
      src={src}
      onLoad={onLoad}
      onError={onError}
      alt={file.name}
    />
  )
}
