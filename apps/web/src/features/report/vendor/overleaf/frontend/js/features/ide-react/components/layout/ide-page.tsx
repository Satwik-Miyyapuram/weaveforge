import { Alerts } from '../alerts/alerts'
import { useLayoutEventTracking } from '../../hooks/use-layout-event-tracking'
import useSocketListeners from '../../hooks/use-socket-listeners'
import { useEditingSessionHeartbeat } from '../../hooks/use-editing-session-heartbeat'
import { useRegisterUserActivity } from '../../hooks/use-register-user-activity'
import useConnectionOutageTracker from '../../hooks/use-connection-outage-tracker'
import { useHasLintingError } from '../../hooks/use-has-linting-error'
import { Modals } from '../modals/modals'
import { GlobalAlertsProvider } from '../../context/global-alerts-context'
import { GlobalToasts } from '../global-toasts'
import EditorSurvey from '../editor-survey'
import { useFeatureFlag } from '../../../../shared/context/split-test-context'
import { useStatusFavicon } from '../../hooks/use-status-favicon'
import useThemedPage from '../../../../shared/hooks/use-themed-page'

import MainLayout from './main-layout'
import SettingsModal from '../../../ide-settings/components/settings-modal'
import CommandPalette from '../../../command-palette/components/command-palette'

export default function IdePage() {
  useLayoutEventTracking() // sent event when the layout changes
  useSocketListeners() // listen for project-related websocket messages
  useEditingSessionHeartbeat() // send a batched event when user is active
  useRegisterUserActivity() // record activity and ensure connection when user is active
  useConnectionOutageTracker() // track offline episodes and emit connection-restored
  useHasLintingError() // pass editor:lint hasLintingError to the compiler
  useStatusFavicon() // update the favicon based on the compile status
  useThemedPage() // set the page theme based on user settings

  const showEditorSurvey = useFeatureFlag('editor-popup-ux-survey-03-2026')
  const showCommandPalette = useFeatureFlag('command-palette')

  return (
    <GlobalAlertsProvider>
      <Alerts />
      <Modals />
      <SettingsModal />
      <MainLayout />
      <GlobalToasts />
      {showCommandPalette && <CommandPalette />}
      {showEditorSurvey && <EditorSurvey />}
    </GlobalAlertsProvider>
  )
}
