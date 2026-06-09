<#
  ViewLocal — removes the resilience tasks (must run elevated / as admin).
  Safe to run repeatedly; missing tasks/processes are ignored.
#>
$ErrorActionPreference = 'SilentlyContinue'

$AgentTask = 'ViewLocal Agent'
$WatchTask = 'ViewLocal Watchdog'
$DataDir   = Join-Path $env:ProgramData 'ViewLocal'

# Stop + remove the watchdog first so it can't relaunch the agent mid-uninstall.
Stop-ScheduledTask  -TaskName $WatchTask
Unregister-ScheduledTask -TaskName $WatchTask -Confirm:$false

Stop-ScheduledTask  -TaskName $AgentTask
Unregister-ScheduledTask -TaskName $AgentTask -Confirm:$false

# Kill any lingering watchdog (Electron-as-Node) still holding the loop.
Get-CimInstance Win32_Process -Filter "Name='ViewLocal Client.exe'" |
  Where-Object { $_.CommandLine -like '*watchdog.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Heartbeat / launcher / logs in ProgramData.
Remove-Item -LiteralPath $DataDir -Recurse -Force

Write-Host "ViewLocal: resilience tasks removed."
