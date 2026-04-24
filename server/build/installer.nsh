; -----------------------------------------------------------------------------
; ViewLocal Server — custom NSIS installer script
; Prompts user for listen port and bind host (and optional auto-start).
; On upgrade, pre-fills fields from the existing config.json that the running
; app maintains at %APPDATA%\viewlocal-server\config.json (electron-store).
; Values the user confirms are written to
; %APPDATA%\ViewLocal Server\bootstrap.json and picked up by the Electron
; main process on next launch.
; -----------------------------------------------------------------------------

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "TextFunc.nsh"

Var Dialog
Var LabelPort
Var TextPort
Var Port

Var LabelHost
Var TextHost
Var Host

Var CheckOpenDashboard
Var OpenDashboardState

Var CheckAutostart
Var AutostartState

Var LabelUpgradeHint

Page custom ViewLocalSrvConfigShow ViewLocalSrvConfigLeave

Function ViewLocalSrvConfigShow
  !insertmacro MUI_HEADER_TEXT "ViewLocal Server — Network" "Listen address and port"

  ; Defaults; will be overridden by existing config when upgrading.
  StrCpy $Port "4000"
  StrCpy $Host "0.0.0.0"
  StrCpy $AutostartState ${BST_CHECKED}
  StrCpy $OpenDashboardState ${BST_CHECKED}
  StrCpy $0 "" ; upgrade flag

  IfFileExists "$APPDATA\viewlocal-server\config.json" 0 cfg_done
    StrCpy $0 "1"

    ; port
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string]((Get-Content -Raw -LiteralPath '$APPDATA\viewlocal-server\config.json' | ConvertFrom-Json).port) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    StrCmp $2 "" +2 0
    StrCpy $Port $2

    ; host
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string]((Get-Content -Raw -LiteralPath '$APPDATA\viewlocal-server\config.json' | ConvertFrom-Json).host) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    StrCmp $2 "" +2 0
    StrCpy $Host $2

    ; launchOnStartup
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string]((Get-Content -Raw -LiteralPath '$APPDATA\viewlocal-server\config.json' | ConvertFrom-Json).launchOnStartup) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    StrCmp $2 "False" 0 +2
    StrCpy $AutostartState ${BST_UNCHECKED}

    ; openDashboardOnStart
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [string]((Get-Content -Raw -LiteralPath '$APPDATA\viewlocal-server\config.json' | ConvertFrom-Json).openDashboardOnStart) } catch {}"`
    Pop $1
    Pop $2
    ${TrimNewLines} $2 $2
    StrCmp $2 "False" 0 +2
    StrCpy $OpenDashboardState ${BST_UNCHECKED}

  cfg_done:

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${If} $0 == "1"
    ${NSD_CreateLabel} 0 0 100% 22u "Existing installation detected — fields are pre-filled with your current settings. Change them if needed or press Install to keep as-is."
    Pop $LabelUpgradeHint
    CreateFont $1 "Segoe UI" "8" "400"
    SendMessage $LabelUpgradeHint ${WM_SETFONT} $1 0
  ${EndIf}

  ${NSD_CreateLabel}  0 28u 100% 12u "Listen port (clients and web UI will use this)"
  Pop $LabelPort
  ${NSD_CreateNumber} 0 42u 30% 12u "$Port"
  Pop $TextPort

  ${NSD_CreateLabel}  0 62u 100% 12u "Bind host (0.0.0.0 = all interfaces, 127.0.0.1 = localhost only)"
  Pop $LabelHost
  ${NSD_CreateText}   0 76u 100% 12u "$Host"
  Pop $TextHost

  ${NSD_CreateCheckbox} 0 102u 100% 12u "Open dashboard in browser after start"
  Pop $CheckOpenDashboard
  ${NSD_SetState} $CheckOpenDashboard $OpenDashboardState

  ${NSD_CreateCheckbox} 0 118u 100% 12u "Launch ViewLocal Server at Windows startup"
  Pop $CheckAutostart
  ${NSD_SetState} $CheckAutostart $AutostartState

  nsDialogs::Show
FunctionEnd

Function ViewLocalSrvConfigLeave
  ${NSD_GetText}  $TextPort $Port
  ${NSD_GetText}  $TextHost $Host
  ${NSD_GetState} $CheckOpenDashboard $OpenDashboardState
  ${NSD_GetState} $CheckAutostart     $AutostartState

  ${If} $Port == ""
    MessageBox MB_ICONEXCLAMATION "Please enter a port number"
    Abort
  ${EndIf}
  ${If} $Host == ""
    MessageBox MB_ICONEXCLAMATION "Please enter a bind host"
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  CreateDirectory "$APPDATA\ViewLocal Server"

  StrCpy $1 "false"
  ${If} $OpenDashboardState == ${BST_CHECKED}
    StrCpy $1 "true"
  ${EndIf}

  StrCpy $2 "false"
  ${If} $AutostartState == ${BST_CHECKED}
    StrCpy $2 "true"
  ${EndIf}

  FileOpen  $9 "$APPDATA\ViewLocal Server\bootstrap.json" w
  FileWrite $9 "{"
  FileWrite $9 '"port":$Port,'
  FileWrite $9 '"host":"$Host",'
  FileWrite $9 '"openDashboardOnStart":$1,'
  FileWrite $9 '"launchOnStartup":$2'
  FileWrite $9 "}"
  FileClose $9

  ; Inbound firewall rule so LAN clients can reach the server.
  ; Silently ignored if firewall service is off or user declines UAC.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ViewLocal Server"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ViewLocal Server" dir=in action=allow protocol=TCP localport=$Port'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ViewLocal Server"'
!macroend
