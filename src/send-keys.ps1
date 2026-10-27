param(
    [Parameter(Mandatory=$false)][int]$ProcessId,
    [Parameter(Mandatory=$false)][string]$StartIn,
    [Parameter(Mandatory=$false)][string]$SendText,
    [Parameter(Mandatory=$false)][switch]$SendEnter,
    [Parameter(Mandatory=$false)][switch]$StartNew,
    [Parameter(Mandatory=$false)][ValidateSet('UP','DOWN','LEFT','RIGHT','ESC','TAB')][string[]]$SendSpecial
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Windows.Forms

function Escape-SendKeys([string]$text) {
    # SendKeys treats + ^ % ~ ( ) { } [ ] as special; escape them by wrapping in braces,
    # except for braces themselves which need doubled-brace escaping.
    $escaped = $text
    $escaped = $escaped -replace '\{', '{{}'
    $escaped = $escaped -replace '\}', '{}}'
    $escaped = $escaped -replace '\(', '{(}'
    $escaped = $escaped -replace '\)', '{)}'
    $escaped = $escaped -replace '\+', '{+}'
    $escaped = $escaped -replace '\^', '{^}'
    $escaped = $escaped -replace '%', '{%}'
    $escaped = $escaped -replace '~', '{~}'
    $escaped = $escaped -replace '\[', '{[}'
    $escaped = $escaped -replace '\]', '{]}'
    return $escaped
}

if ($StartNew) {
    $startDir = if ($StartIn) { $StartIn } else { (Get-Location).Path }
    $proc = Start-Process powershell -ArgumentList @("-NoExit") -WorkingDirectory $startDir -PassThru
    Start-Sleep -Milliseconds 800
    Write-Output "STARTED_PID:$($proc.Id)"
    exit 0
}

if (-not $ProcessId) {
    Write-Error "ProcessId is required unless -StartNew is given."
    exit 1
}

$targetProc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $targetProc) {
    Write-Error "No process with id $ProcessId"
    exit 1
}

# Wait briefly for a main window handle to exist (console host window).
$tries = 0
while ($targetProc.MainWindowHandle -eq [IntPtr]::Zero -and $tries -lt 20) {
    Start-Sleep -Milliseconds 100
    $targetProc.Refresh()
    $tries++
}

if ($targetProc.MainWindowHandle -eq [IntPtr]::Zero) {
    Write-Error "Could not find a window handle for process $ProcessId"
    exit 1
}

[Win32Focus]::ShowWindow($targetProc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE in case minimized
[Win32Focus]::SetForegroundWindow($targetProc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 200

if ($SendText) {
    $escaped = Escape-SendKeys $SendText
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
    Start-Sleep -Milliseconds 100
}

if ($SendSpecial) {
    foreach ($key in $SendSpecial) {
        [System.Windows.Forms.SendKeys]::SendWait("{$key}")
        Start-Sleep -Milliseconds 100
    }
}

if ($SendEnter) {
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

Write-Output "OK: sent to pid $ProcessId (window handle $($targetProc.MainWindowHandle))"
