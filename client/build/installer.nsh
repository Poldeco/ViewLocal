; -----------------------------------------------------------------------------
; ViewLocal Client — custom NSIS installer script
; Prompts user for server URL and capture parameters.
; On upgrade, pre-fills fields by reading (in order):
;   1. %APPDATA%\viewlocal-client\config.json   (electron-store)
;   2. %APPDATA%\ViewLocal Client\bootstrap.json (previous installer)
; .NET File.ReadAllText with explicit UTF-8 encoding is used so Russian /
; non-English Windows locales don't corrupt the JSON read by PowerShell.
; Confirmed values are saved to
; %APPDATA%\ViewLocal Client\bootstrap.json and picked up by the Electron
; main process on first launch.
; -----------------------------------------------------------------------------

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "TextFunc.nsh"
!include "WordFunc.nsh"

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

Var LabelUpgradeHint

Page custom ViewLocalConfigShow ViewLocalConfigLeave

Function ViewLocalConfigShow
  !insertmacro MUI_HEADER_TEXT "ViewLocal Client — Connection" "Server address and capture parameters"

  ; Defaults; will be overridden by existing config when upgrading.
  StrCpy $ServerURL "http://192.168.1.10:4000"
  StrCpy $CaptureInterval "1000"
  StrCpy $MaxWidth "1280"
  StrCpy $JpegQuality "0.6"
  StrCpy $AutostartState ${BST_CHECKED}
  StrCpy $0 "" ; upgrade flag

  ; Debug log — helps diagnose pre-fill failures on user machines.
  FileOpen $8 "$TEMP\viewlocal-client-install.log" w
  FileWrite $8 "ViewLocal Client installer started$\r$\n"
  FileWrite $8 "APPDATA=$APPDATA$\r$\n"

  StrCpy $3 ""
  IfFileExists "$APPDATA\viewlocal-client\config.json" 0 check_bootstrap
    StrCpy $3 "$APPDATA\viewlocal-client\config.json"
    FileWrite $8 "Found config.json at $3$\r$\n"
    Goto have_source

  check_bootstrap:
  IfFileExists "$APPDATA\ViewLocal Client\bootstrap.json" 0 no_source
    StrCpy $3 "$APPDATA\ViewLocal Client\bootstrap.json"
    FileWrite $8 "Found bootstrap.json at $3$\r$\n"
    Goto have_source

  no_source:
    FileWrite $8 "No existing config/bootstrap found, using defaults$\r$\n"
    Goto cfg_done

  have_source:
    StrCpy $0 "1"

    ; serverUrl
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string](([System.IO.File]::ReadAllText('$3',[System.Text.Encoding]::UTF8) | ConvertFrom-Json).serverUrl) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    FileWrite $8 "serverUrl exit=$1 value='$2'$\r$\n"
    StrCmp $2 "" +2 0
    StrCpy $ServerURL $2

    ; captureInterval
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string](([System.IO.File]::ReadAllText('$3',[System.Text.Encoding]::UTF8) | ConvertFrom-Json).captureInterval) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    FileWrite $8 "captureInterval exit=$1 value='$2'$\r$\n"
    StrCmp $2 "" +2 0
    StrCpy $CaptureInterval $2

    ; maxWidth
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string](([System.IO.File]::ReadAllText('$3',[System.Text.Encoding]::UTF8) | ConvertFrom-Json).maxWidth) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    FileWrite $8 "maxWidth exit=$1 value='$2'$\r$\n"
    StrCmp $2 "" +2 0
    StrCpy $MaxWidth $2

    ; jpegQuality (handle decimal comma from Russian locale)
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string](([System.IO.File]::ReadAllText('$3',[System.Text.Encoding]::UTF8) | ConvertFrom-Json).jpegQuality) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    ${WordReplace} $2 "," "." "+" $2
    FileWrite $8 "jpegQuality exit=$1 value='$2'$\r$\n"
    StrCmp $2 "" +2 0
    StrCpy $JpegQuality $2

    ; launchOnStartup
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string](([System.IO.File]::ReadAllText('$3',[System.Text.Encoding]::UTF8) | ConvertFrom-Json).launchOnStartup) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    FileWrite $8 "launchOnStartup exit=$1 value='$2'$\r$\n"
    StrCmp $2 "False" 0 +2
    StrCpy $AutostartState ${BST_UNCHECKED}

  cfg_done:

  FileWrite $8 "Final: ServerURL=$ServerURL Interval=$CaptureInterval MaxWidth=$MaxWidth Quality=$JpegQuality Autostart=$AutostartState Upgrade=$0$\r$\n"
  FileClose $8

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${If} $0 == "1"
    ${NSD_CreateLabel} 0 0 100% 22u "Existing installation detected — fields are pre-filled with your current settings. Change them if needed or press Install to keep as-is."
    Pop $LabelUpgradeHint
  ${EndIf}

  ${NSD_CreateLabel}  0 28u  100% 12u "Server URL (http://host:port)"
  Pop $LabelServer
  ${NSD_CreateText}   0 42u 100% 12u "$ServerURL"
  Pop $TextServer

  ${NSD_CreateLabel}  0 62u 48% 12u "Capture interval (ms)"
  Pop $LabelInterval
  ${NSD_CreateNumber} 0 76u 48% 12u "$CaptureInterval"
  Pop $TextInterval

  ${NSD_CreateLabel}  52% 62u 48% 12u "Max frame width (px)"
  Pop $LabelMaxWidth
  ${NSD_CreateNumber} 52% 76u 48% 12u "$MaxWidth"
  Pop $TextMaxWidth

  ${NSD_CreateLabel}  0 98u 48% 12u "JPEG quality (0.1 - 1.0)"
  Pop $LabelQuality
  ${NSD_CreateText}   0 112u 48% 12u "$JpegQuality"
  Pop $TextQuality

  ${NSD_CreateCheckbox} 0 134u 100% 12u "Launch ViewLocal Client at Windows startup"
  Pop $CheckAutostart
  ${NSD_SetState} $CheckAutostart $AutostartState

  nsDialogs::Show
FunctionEnd

Function ViewLocalConfigLeave
  ${NSD_GetText}  $TextServer   $ServerURL
  ${NSD_GetText}  $TextInterval $CaptureInterval
  ${NSD_GetText}  $TextMaxWidth $MaxWidth
  ${NSD_GetText}  $TextQuality  $JpegQuality
  ${NSD_GetState} $CheckAutostart $AutostartState

  ; Normalize decimal separator so the JSON we emit is valid regardless of locale.
  ${WordReplace} $JpegQuality "," "." "+" $JpegQuality

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

  ; Startup-folder shortcut — more reliable than Run registry on locked-down
  ; Windows installs. Paired with app.setLoginItemSettings in the Electron
  ; main; single-instance lock dedupes if both mechanisms fire.
  Delete "$SMSTARTUP\ViewLocal Client.lnk"
  ${If} $AutostartState == ${BST_CHECKED}
    CreateShortcut "$SMSTARTUP\ViewLocal Client.lnk" "$INSTDIR\ViewLocal Client.exe" "--hidden" "$INSTDIR\ViewLocal Client.exe" 0
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\ViewLocal Client.lnk"
!macroend
