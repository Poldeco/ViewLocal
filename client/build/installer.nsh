; -----------------------------------------------------------------------------
; ViewLocal Client — custom NSIS installer script
; Prompts user for server URL and capture parameters.
; Values are saved to %APPDATA%\ViewLocal Client\bootstrap.json and picked up
; by the Electron main process on first launch.
; -----------------------------------------------------------------------------

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var Dialog
Var LabelServer
Var TextServer
Var ServerURL

Var LabelInterval
Var TextInterval
Var CaptureInterval

Var LabelMaxWidth
Var TextMaxWidth
Var MaxWidth

Var LabelQuality
Var TextQuality
Var JpegQuality

Var CheckAutostart
Var AutostartState

; Top-level page declaration — electron-builder includes this file at the top
; of its generated installer.nsi, so the page becomes part of the wizard flow.
Page custom ViewLocalConfigShow ViewLocalConfigLeave

Function ViewLocalConfigShow
  !insertmacro MUI_HEADER_TEXT "ViewLocal Client — Connection" "Server address and capture parameters"

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel}  0 0  100% 12u "Server URL (http://host:port)"
  Pop $LabelServer
  ${NSD_CreateText}   0 14u 100% 12u "http://192.168.1.10:4000"
  Pop $TextServer

  ${NSD_CreateLabel}  0 34u 48% 12u "Capture interval (ms)"
  Pop $LabelInterval
  ${NSD_CreateNumber} 0 48u 48% 12u "1000"
  Pop $TextInterval

  ${NSD_CreateLabel}  52% 34u 48% 12u "Max frame width (px)"
  Pop $LabelMaxWidth
  ${NSD_CreateNumber} 52% 48u 48% 12u "1280"
  Pop $TextMaxWidth

  ${NSD_CreateLabel}  0 70u 48% 12u "JPEG quality (0.1 - 1.0)"
  Pop $LabelQuality
  ${NSD_CreateText}   0 84u 48% 12u "0.6"
  Pop $TextQuality

  ${NSD_CreateCheckbox} 0 106u 100% 12u "Launch ViewLocal Client at Windows startup"
  Pop $CheckAutostart
  ${NSD_Check} $CheckAutostart

  nsDialogs::Show
FunctionEnd

Function ViewLocalConfigLeave
  ${NSD_GetText}  $TextServer   $ServerURL
  ${NSD_GetText}  $TextInterval $CaptureInterval
  ${NSD_GetText}  $TextMaxWidth $MaxWidth
  ${NSD_GetText}  $TextQuality  $JpegQuality
  ${NSD_GetState} $CheckAutostart $AutostartState

  ${If} $ServerURL == ""
    MessageBox MB_ICONEXCLAMATION "Please enter Server URL"
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  ; Write bootstrap config for the Electron app to read on first launch.
  CreateDirectory "$APPDATA\ViewLocal Client"

  StrCpy $0 "false"
  ${If} $AutostartState == ${BST_CHECKED}
    StrCpy $0 "true"
  ${EndIf}

  FileOpen  $9 "$APPDATA\ViewLocal Client\bootstrap.json" w
  FileWrite $9 "{"
  FileWrite $9 '"serverUrl":"$ServerURL",'
  FileWrite $9 '"captureInterval":$CaptureInterval,'
  FileWrite $9 '"maxWidth":$MaxWidth,'
  FileWrite $9 '"jpegQuality":$JpegQuality,'
  FileWrite $9 '"launchOnStartup":$0'
  FileWrite $9 "}"
  FileClose $9
!macroend
