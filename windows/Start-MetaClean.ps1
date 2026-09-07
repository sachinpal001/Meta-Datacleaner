<#
.SYNOPSIS
    MetaClean for Windows - local launcher.

.DESCRIPTION
    Serves the MetaClean app from this folder over a loopback-only HTTP server and
    opens it in Google Chrome.

    Zero dependencies: uses only Windows PowerShell 5.1 + .NET (System.Net.HttpListener).
    No Python, no Node.js, no admin rights, no firewall prompt - the listener is bound
    to localhost / 127.0.0.1 only, so nothing is reachable from your network.

    HTTP on localhost counts as a "secure context" in Chrome, so the webcam
    (getUserMedia), Service Worker, PWA install, File System Access and File Handling
    APIs all work exactly as they would over HTTPS.

.PARAMETER Port
    Preferred TCP port (default 8085). If busy, the next free port is used.

.PARAMETER Mode
    Window - open a new normal Chrome window (default; shows the "Install" button).
    App    - open a frameless Chrome app window (desktop-app feel).
    Tab    - open a tab in the current Chrome window.
    None   - just serve; do not launch a browser.

.PARAMETER NoAutoExit
    Keep serving after the app window is closed. By default the server shuts itself
    down once no MetaClean window has checked in for -IdleSeconds.

.PARAMETER IdleSeconds
    Idle grace period before auto-shutdown (default 120). Kept above 60s because
    Chrome throttles background-tab timers to roughly one tick per minute.

.EXAMPLE
    .\Start-MetaClean.ps1
.EXAMPLE
    .\Start-MetaClean.ps1 -Mode App -Port 9090
#>
[CmdletBinding()]
param(
    [int]$Port = 8085,
    [ValidateSet('Window', 'App', 'Tab', 'None')]
    [string]$Mode = 'Window',
    [switch]$NoAutoExit,
    [int]$IdleSeconds = 120,
    [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'

# When launched hidden (from a shortcut) there is no console to read from, so
# never block on a prompt - just exit with a non-zero code.
function Stop-WithError([string]$message) {
    Write-Host "ERROR: $message" -ForegroundColor Red
    if (-not $NoPrompt) { Read-Host "Press Enter to close" | Out-Null }
    exit 1
}

# App root = parent of this \windows\ folder
$Root = Split-Path -Parent $PSScriptRoot
$RootFull = [System.IO.Path]::GetFullPath($Root)

if (-not (Test-Path (Join-Path $RootFull 'index.html'))) {
    Stop-WithError "index.html not found in $RootFull. Keep Start-MetaClean.ps1 inside the 'windows' folder of the MetaClean project."
}

# ---------------------------------------------------------------- MIME types
$Mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.jfif' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.bmp'  = 'image/bmp'
    '.svg'  = 'image/svg+xml; charset=utf-8'
    '.ico'  = 'image/x-icon'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
    '.woff' = 'font/woff'
    '.woff2' = 'font/woff2'
}

# ---------------------------------------------------------------- helpers
function Test-PortFree([int]$p) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $l.Start(); $l.Stop()
        return $true
    } catch {
        return $false
    }
}

function Find-Chrome {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
    )
    foreach ($k in $keys) {
        try {
            $v = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'
            if ($v -and (Test-Path $v)) { return $v }
        } catch { }
    }
    return $null
}

function Start-Chrome([string]$exe, [string]$url, [string]$launchMode) {
    # NB: not named $args - that is an automatic variable inside functions.
    switch ($launchMode) {
        'App'    { $chromeArgs = @("--app=$url", '--window-size=1200,940') }
        'Window' { $chromeArgs = @('--new-window', $url) }
        'Tab'    { $chromeArgs = @($url) }
        default  { return }
    }
    Start-Process -FilePath $exe -ArgumentList $chromeArgs | Out-Null
}

# ------------------------------------------- already running on this port?
$probeUrl = "http://localhost:$Port/__mc/info"
$alreadyUp = $false
if (-not (Test-PortFree $Port)) {
    try {
        $r = Invoke-WebRequest -Uri $probeUrl -TimeoutSec 2 -UseBasicParsing
        if ($r.Content -match 'MetaClean') { $alreadyUp = $true }
    } catch { }
}

$chrome = Find-Chrome

if ($alreadyUp) {
    Write-Host "MetaClean is already serving on port $Port - opening a window." -ForegroundColor Yellow
    if ($chrome -and $Mode -ne 'None') {
        Start-Chrome $chrome "http://localhost:$Port/" $Mode
    } else {
        Start-Process "http://localhost:$Port/"
    }
    exit 0
}

# ---------------------------------------------------------------- pick port
$chosen = $null
for ($p = $Port; $p -lt ($Port + 25); $p++) {
    if (Test-PortFree $p) { $chosen = $p; break }
}
if (-not $chosen) {
    Stop-WithError "no free port in range $Port-$($Port + 24)."
}
$Port = $chosen
$appUrl = "http://localhost:$Port/"

# ---------------------------------------------------------------- listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
    $listener.Start()
} catch {
    Stop-WithError "could not start the local server: $($_.Exception.Message)"
}

try { $host.UI.RawUI.WindowTitle = "MetaClean Server - $appUrl" } catch { }

Write-Host ""
Write-Host "  MetaClean for Windows" -ForegroundColor Cyan
Write-Host "  ---------------------" -ForegroundColor DarkGray
Write-Host "  Serving : $RootFull"
Write-Host "  Address : $appUrl  (loopback only - not exposed to your network)"
if ($chrome) {
    Write-Host "  Chrome  : $chrome"
} else {
    Write-Host "  Chrome  : not found - falling back to your default browser" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Tip: click 'Install' in the app to add MetaClean to the Start Menu," -ForegroundColor DarkGray
Write-Host "       which also enables 'Open with > MetaClean' in File Explorer." -ForegroundColor DarkGray
Write-Host ""
if ($NoAutoExit) {
    Write-Host "  Press Ctrl+C or close this window to stop the server." -ForegroundColor DarkGray
} else {
    Write-Host "  Stops automatically ~$IdleSeconds s after you close the MetaClean window." -ForegroundColor DarkGray
}
Write-Host ""

if ($Mode -ne 'None') {
    if ($chrome) {
        Start-Chrome $chrome $appUrl $Mode
    } else {
        Start-Process $appUrl
    }
}

# ---------------------------------------------------------------- serve loop
$running   = $true
$sawClient = $false
$lastSeen  = Get-Date
$quitAt    = $null
$hits      = 0

try {
    while ($running) {
        $task = $listener.GetContextAsync()

        $ready = $false
        while (-not $ready) {
            try {
                $ready = $task.Wait(250)
            } catch {
                $ready = $true
            }
            if (-not $ready) {
                $now = Get-Date
                # -NoAutoExit must beat the quit beacon too, otherwise closing the
                # window would still kill a server the user asked to keep running.
                if ((-not $NoAutoExit) -and $null -ne $quitAt -and $now -gt $quitAt) {
                    Write-Host "  App window closed - shutting down." -ForegroundColor DarkGray
                    $running = $false
                    break
                }
                if ((-not $NoAutoExit) -and $sawClient -and (($now - $lastSeen).TotalSeconds -gt $IdleSeconds)) {
                    Write-Host "  Idle for $IdleSeconds s - shutting down." -ForegroundColor DarkGray
                    $running = $false
                    break
                }
            }
        }
        if (-not $running) { break }

        try {
            $ctx = $task.Result
        } catch {
            continue
        }

        $req = $ctx.Request
        $res = $ctx.Response
        $sawClient = $true
        $lastSeen = Get-Date

        try {
            $res.Headers['Service-Worker-Allowed'] = '/'
            $res.Headers['X-Content-Type-Options'] = 'nosniff'

            $urlPath = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)

            # ---- control endpoints used by the app to manage this server
            if ($urlPath -eq '/__mc/ping') {
                $quitAt = $null            # a window is alive; cancel any pending shutdown
                $res.StatusCode = 204
                $res.Close()
                continue
            }
            if ($urlPath -eq '/__mc/quit') {
                # Grace period: if another MetaClean window pings within 6s, stay up.
                $quitAt = (Get-Date).AddSeconds(6)
                $res.StatusCode = 204
                $res.Close()
                continue
            }
            if ($urlPath -eq '/__mc/info') {
                $body = [System.Text.Encoding]::UTF8.GetBytes("MetaClean $Port")
                $res.ContentType = 'text/plain; charset=utf-8'
                $res.ContentLength64 = $body.Length
                $res.OutputStream.Write($body, 0, $body.Length)
                $res.Close()
                continue
            }

            # ---- share_target POST lands here when no Service Worker is active yet
            if ($req.HttpMethod -eq 'POST') {
                $res.StatusCode = 303
                $res.Headers['Location'] = '/'
                $res.Close()
                continue
            }

            if ($urlPath -eq '/' -or $urlPath -eq '') { $urlPath = '/index.html' }

            $rel = $urlPath.TrimStart('/').Replace('/', '\')
            $full = [System.IO.Path]::GetFullPath((Join-Path $RootFull $rel))

            # ---- refuse anything outside the app folder
            if (-not $full.StartsWith($RootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                $res.StatusCode = 403
                $res.Close()
                continue
            }

            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                $res.StatusCode = 404
                $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - $urlPath not found")
                $res.ContentType = 'text/plain; charset=utf-8'
                $res.ContentLength64 = $msg.Length
                $res.OutputStream.Write($msg, 0, $msg.Length)
                $res.Close()
                continue
            }

            $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
            $leaf = [System.IO.Path]::GetFileName($full).ToLowerInvariant()

            if ($leaf -eq 'manifest.json') {
                $ctype = 'application/manifest+json; charset=utf-8'
            } elseif ($Mime.ContainsKey($ext)) {
                $ctype = $Mime[$ext]
            } else {
                $ctype = 'application/octet-stream'
            }

            # Never cache the app shell: edits show up on reload, and sw.js is
            # already network-first. Images are immutable enough to cache.
            if ($ext -in @('.html', '.htm', '.js', '.mjs', '.css', '.json', '.webmanifest')) {
                $res.Headers['Cache-Control'] = 'no-store, must-revalidate'
            } else {
                $res.Headers['Cache-Control'] = 'public, max-age=3600'
            }

            $bytes = [System.IO.File]::ReadAllBytes($full)
            $res.ContentType = $ctype
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.Close()

            $hits++
            if ($hits -le 12) {
                Write-Host ("  200  " + $urlPath) -ForegroundColor DarkGray
            }
        } catch {
            try {
                $res.StatusCode = 500
                $res.Close()
            } catch { }
        }
    }
} finally {
    try { $listener.Stop() } catch { }
    try { $listener.Close() } catch { }
    Write-Host "  MetaClean server stopped." -ForegroundColor DarkGray
}
