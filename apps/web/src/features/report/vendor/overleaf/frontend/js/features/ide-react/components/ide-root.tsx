import { FC, memo, useState } from 'react'
import { GenericErrorBoundaryFallback } from '../../../shared/components/generic-error-boundary-fallback'
import withErrorBoundary from '../../../infrastructure/error-boundary'
import IdePage from './layout/ide-page'
import { ReactContextRoot } from '../context/react-context-root'
import { Loading } from './loading'

const IdeRoot: FC = () => {
  const [loaded, setLoaded] = useState(false)

  return (
    <ReactContextRoot>
      {loaded ? <IdePage /> : <Loading setLoaded={setLoaded} />}
    </ReactContextRoot>
  )
}

export default withErrorBoundary(memo(IdeRoot), () => (
  <GenericErrorBoundaryFallback />
))
