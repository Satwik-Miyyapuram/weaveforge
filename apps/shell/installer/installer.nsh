; The header strip behind the page title is drawn by NSIS in MUI_BGCOLOR
; (white by default). The setup window's art-panel colours, so the strip and
; the header art read as one band.
!define MUI_BGCOLOR F1D5A7
!define MUI_TEXTCOLOR 2B222B

; A running WeaveForge keeps its files and the sign-in port (53682) open. Close
; it before the files are replaced: a close request first, so the window exits
; on its own, then a forced end for whatever is still up. /T takes the app's
; child processes with it. The Electron build is
; WeaveForge.exe; the Tauri shell is weaveforge-shell.exe.
!macro WF_CLOSE_RUNNING
  DetailPrint "Closing a running WeaveForge"
  ExecShellWait "open" "taskkill.exe" '/T /IM "WeaveForge.exe" /IM "weaveforge-shell.exe"' SW_HIDE
  Sleep 3000
  ExecShellWait "open" "taskkill.exe" '/F /T /IM "WeaveForge.exe" /IM "weaveforge-shell.exe"' SW_HIDE
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WF_CLOSE_RUNNING
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WF_CLOSE_RUNNING
!macroend
