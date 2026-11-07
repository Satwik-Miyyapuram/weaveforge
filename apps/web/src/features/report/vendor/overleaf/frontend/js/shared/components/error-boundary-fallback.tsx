import { FC, ReactNode } from 'react'
import { DefaultMessage } from './default-message'
import Notification from './notification'

export const ErrorBoundaryFallback: FC<
  React.PropsWithChildren<{ modal?: ReactNode }>
> = ({ children, modal }) => {
  return (
    <div className="error-boundary-alert">
      <div className="notification-list">
        <Notification type="error" content={children || <DefaultMessage />} />
      </div>
      {modal}
    </div>
  )
}
