<#
  ViewLocal — resilience installer (must run elevated / as admin).

  Creates two scheduled tasks:

    "ViewLocal Agent"     — runs the Electron capture client in the interactive
                            user's session (so desktopCapturer can see the
                            desktop). Starts at logon and on demand.

    "ViewLocal Watchdog"  — runs this repo's watchdog.js as LocalSystem at boot.
                            A non-admin user cannot kill a SYSTEM process, so the
                            watchdog survives and relaunches the agent whenever
                            the user closes it. The watchdog is launched via
                            Electron-as-Node (no separate Node runtime needed).

  Both tasks live in the Task Scheduler root, which is admin-protected: a
  standard user cannot disable or delete them. The admin keeps full control
  (disable the watchdog task or run uninstall-tasks.ps1 to remove everything).

  Params:
    -ExePath         Full path to "ViewLocal Client.exe".
    -WatchdogScript  Full path to watchdog.js (shipped under resources\).
#>
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$WatchdogScript
)

$ErrorActionPreference = 'Stop'

$AgentTask = 'ViewLocal Agent'
$WatchTask = 'ViewLocal Watchdog'
$DataDir   = Join-Path $env:ProgramData 'ViewLocal'

# Well-known SIDs (locale-independent).
$SID_USERS  = 'S-1-5-32-545' # BUILTIN\Users
$SID_SYSTEM = 'S-1-5-18'     # LocalSystem

Write-Host "ViewLocal: installing resilience tasks"
Write-Host "  ExePath        = $ExePath"
Write-Host "  WatchdogScript = $WatchdogScript"

if (-not (Test-Path -LiteralPath $ExePath)) { throw "ExePath not found: $ExePath" }
if (-not (Test-Path -LiteralPath $WatchdogScript)) { throw "WatchdogScript not found: $WatchdogScript" }

# --- Shared data dir: agent (user session) writes heartbeat, watchdog reads it.
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
# Grant Users Modify so the user-session agent can write the heartbeat/log.
& icacls $DataDir /grant "*$($SID_USERS):(OI)(CI)M" /T | Out-Null

# --- Launcher .cmd: sets ELECTRON_RUN_AS_NODE and runs the watchdog script.
# Generated with absolute paths to avoid quoting headaches in the task action.
$Launcher = Join-Path $DataDir 'watchdog-launch.cmd'
$cmd = "@echo off`r`nset ELECTRON_RUN_AS_NODE=1`r`n`"$ExePath`" `"$WatchdogScript`"`r`n"
Set-Content -LiteralPath $Launcher -Value $cmd -Encoding ASCII

$noLimit = New-TimeSpan -Seconds 0  # PT0S => no execution time limit

# --- Agent task: interactive user session ------------------------------------
$agentAction = New-ScheduledTaskAction -Execute $ExePath -Argument '--hidden'
$agentTrigger = New-ScheduledTaskTrigger -AtLogOn
# GroupId = Users + Interactive: the task runs as whichever user logs on / is
# active, in their session. schtasks /Run from the SYSTEM watchdog resolves to
# the current interactive user.
$agentPrincipal = New-ScheduledTaskPrincipal -GroupId $SID_USERS -RunLevel Limited
$agentSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit $noLimit
Register-ScheduledTask -TaskName $AgentTask -Action $agentAction -Trigger $agentTrigger `
  -Principal $agentPrincipal -Settings $agentSettings -Force | Out-Null
Write-Host "  [ok] task '$AgentTask' registered"

# --- Watchdog task: LocalSystem, session 0, starts at boot -------------------
# Run the launcher via cmd.exe /c so execution doesn't depend on Task Scheduler
# resolving a bare .cmd action.
$cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
$watchAction = New-ScheduledTaskAction -Execute $cmdExe -Argument "/c `"$Launcher`""
$watchTrigger = New-ScheduledTaskTrigger -AtStartup
$watchPrincipal = New-ScheduledTaskPrincipal -UserId $SID_SYSTEM -LogonType ServiceAccount -RunLevel Highest
$watchSettings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit $noLimit
Register-ScheduledTask -TaskName $WatchTask -Action $watchAction -Trigger $watchTrigger `
  -Principal $watchPrincipal -Settings $watchSettings -Force | Out-Null
Write-Host "  [ok] task '$WatchTask' registered"

# Start the watchdog now (and kick the agent if a user is logged on).
Start-ScheduledTask -TaskName $WatchTask
try { Start-ScheduledTask -TaskName $AgentTask } catch {}

Write-Host "ViewLocal: resilience tasks installed."
