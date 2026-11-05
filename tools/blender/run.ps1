# Runs a Blender Python script headless and prints its log.
# Usage: powershell -File tools/blender/run.ps1 tools/blender/build_dragon.py [extra args]
# Blender is the Microsoft Store build, so it starts through its launcher alias,
# which has no console; scripts write their own log to tools/blender/last.log.
param([Parameter(Mandatory)][string]$Script, [Parameter(ValueFromRemainingArguments)][string[]]$Rest)
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$log = Join-Path $PSScriptRoot "last.log"
Remove-Item $log -ErrorAction SilentlyContinue
$launcher = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WindowsApps\BlenderFoundation.Blender_*\blender-launcher.exe" | Select-Object -First 1
if (-not $launcher) { $launcher = Get-Command blender -ErrorAction Stop }
$scriptPath = (Resolve-Path $Script).Path
$argsList = @('-b', '--factory-startup', '-P', "`"$scriptPath`"", '--', "`"$root`"", "`"$log`"")
if ($Rest) { $argsList += $Rest }
Start-Process $launcher.FullName -ArgumentList $argsList -Wait
# the launcher can return before Blender finishes writing; wait for the end marker
for ($i = 0; $i -lt 600; $i++) {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern '^== (DONE|FAILED)' -Quiet)) { break }
    Start-Sleep -Milliseconds 500
}
if (Test-Path $log) { Get-Content $log } else { "No log written." ; exit 1 }
if (Select-String -Path $log -Pattern '^== FAILED' -Quiet) { exit 1 }
