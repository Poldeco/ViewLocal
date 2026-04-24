; -----------------------------------------------------------------------------
; ViewLocal Server — custom NSIS installer script
; Prompts user for listen port and bind host (and optional auto-start).
; Values are saved to %APPDATA%\ViewLocal Server\bootstrap.json and picked up
; by the Electron main process on first launch.
; -----------------------------------------------------------------------------

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

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

Page custom ViewLocalSrvConfigShow ViewLocalSrvConfigLeave

Function ViewLocalSrvConfigShow
  !insertmacro MUI_HEADER_TEXT "ViewLocal Server — Network" "Listen address and port"

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel}  0 0  100% 12u "Listen port (clients and web UI will use this)"
  Pop $LabelPort
  ${NSD_CreateNumber} 0 14u 30% 12u "4000"
  Pop $TextPort

  ${NSD_CreateLabel}  0 34u 100% 12u "Bind host (0.0.0.0 = all interfaces, 127.0.0.1 = localhost only)"
  Pop $LabelHost
  ${NSD_CreateText}   0 48u 100% 12u "0.0.0.0"
  Pop $TextHost

  ${NSD_CreateCheckbox} 0 76u 100% 12u "Open dashboard in browser after start"
  Pop $CheckOpenDashboard
  ${NSD_Check} $CheckOpenDashboard

  ${NSD_CreateCheckbox} 0 94u 100% 12u "Launch ViewLocal Server at Windows startup"
  Pop $CheckAutostart
  ${NSD_Check} $CheckAutostart

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
