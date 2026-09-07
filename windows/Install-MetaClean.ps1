<#
.SYNOPSIS
    Adds MetaClean to the Windows Desktop and Start Menu.

.DESCRIPTION
    Builds a multi-resolution MetaClean.ico from icon-512.png, then creates
    Desktop and Start Menu shortcuts that launch MetaClean silently (no console
    window) in Chrome.

    Per-user only: writes to your own Desktop and Start Menu, so no admin rights
    are needed and nothing is written to HKLM or Program Files.

.PARAMETER Mode
    Launch mode baked into the shortcuts: Window (default), App, or Tab.

.PARAMETER NoDesktop
    Skip the Desktop shortcut.

.PARAMETER Uninstall
    Remove the shortcuts and the generated icon.

.EXAMPLE
    .\Install-MetaClean.ps1
.EXAMPLE
    .\Install-MetaClean.ps1 -Mode App
.EXAMPLE
    .\Install-MetaClean.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [ValidateSet('Window', 'App', 'Tab')]
    [string]$Mode = 'Window',
    [switch]$NoDesktop,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $PSScriptRoot
$IcoPath   = Join-Path $PSScriptRoot 'MetaClean.ico'
$VbsPath   = Join-Path $PSScriptRoot 'MetaClean-Silent.vbs'
$SourcePng = Join-Path $Root 'icon-512.png'

$Desktop   = [Environment]::GetFolderPath('Desktop')
$StartMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
$Shortcuts = @(
    (Join-Path $Desktop   'MetaClean.lnk'),
    (Join-Path $StartMenu 'MetaClean.lnk')
)

# ------------------------------------------------------------------ uninstall
if ($Uninstall) {
    foreach ($s in $Shortcuts) {
        if (Test-Path -LiteralPath $s) {
            Remove-Item -LiteralPath $s -Force
            Write-Host "  removed  $s" -ForegroundColor DarkGray
        }
    }
    if (Test-Path -LiteralPath $IcoPath) {
        Remove-Item -LiteralPath $IcoPath -Force
        Write-Host "  removed  $IcoPath" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  MetaClean shortcuts removed." -ForegroundColor Green
    Write-Host "  If you also installed the PWA in Chrome, remove it from" -ForegroundColor DarkGray
    Write-Host "  chrome://apps (right-click MetaClean > Remove from Chrome)." -ForegroundColor DarkGray
    Write-Host ""
    exit 0
}

if (-not (Test-Path -LiteralPath $VbsPath)) {
    Write-Host "ERROR: MetaClean-Silent.vbs not found next to this script." -ForegroundColor Red
    exit 1
}

# --------------------------------------------------- build a Windows .ico file
# Windows Vista+ accepts PNG-compressed frames inside an ICO container, so we can
# pack resized PNGs directly instead of writing BMP/DIB frames by hand.
function New-IcoFromPng {
    param(
        [Parameter(Mandatory = $true)][string]$PngPath,
        [Parameter(Mandatory = $true)][string]$OutPath,
        [int[]]$Sizes = @(16, 24, 32, 48, 64, 128, 256)
    )

    Add-Type -AssemblyName System.Drawing

    $src = [System.Drawing.Image]::FromFile($PngPath)
    $frames = New-Object System.Collections.ArrayList
    try {
        foreach ($size in $Sizes) {
            $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $g.Clear([System.Drawing.Color]::Transparent)
                $g.DrawImage($src, 0, 0, $size, $size)
            } finally {
                $g.Dispose()
            }

            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            [void]$frames.Add([pscustomobject]@{ Size = $size; Bytes = $ms.ToArray() })
            $ms.Dispose()
        }
    } finally {
        $src.Dispose()
    }

    $out = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter($out)
    try {
        # ICONDIR
        $w.Write([uint16]0)                  # reserved
        $w.Write([uint16]1)                  # type: 1 = icon
        $w.Write([uint16]$frames.Count)      # image count

        # ICONDIRENTRY records are fixed at 16 bytes each
        $offset = 6 + (16 * $frames.Count)
        foreach ($f in $frames) {
            if ($f.Size -ge 256) { $dim = [byte]0 } else { $dim = [byte]$f.Size }
            $w.Write($dim)                   # width  (0 => 256)
            $w.Write($dim)                   # height (0 => 256)
            $w.Write([byte]0)                # palette colours (0 = truecolour)
            $w.Write([byte]0)                # reserved
            $w.Write([uint16]1)              # colour planes
            $w.Write([uint16]32)             # bits per pixel
            $w.Write([uint32]$f.Bytes.Length)
            $w.Write([uint32]$offset)
            $offset += $f.Bytes.Length
        }
        foreach ($f in $frames) { $w.Write($f.Bytes) }

        $w.Flush()
        [System.IO.File]::WriteAllBytes($OutPath, $out.ToArray())
    } finally {
        $w.Dispose()
        $out.Dispose()
    }
}

Write-Host ""
Write-Host "  Installing MetaClean shortcuts" -ForegroundColor Cyan
Write-Host "  ------------------------------" -ForegroundColor DarkGray

if (Test-Path -LiteralPath $SourcePng) {
    try {
        New-IcoFromPng -PngPath $SourcePng -OutPath $IcoPath
        Write-Host "  icon     $IcoPath" -ForegroundColor DarkGray
    } catch {
        Write-Host "  icon     could not build .ico ($($_.Exception.Message)) - using Chrome's icon" -ForegroundColor Yellow
        $IcoPath = $null
    }
} else {
    Write-Host "  icon     icon-512.png not found - using Chrome's icon" -ForegroundColor Yellow
    $IcoPath = $null
}

# ----------------------------------------------------------- create shortcuts
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell

$targets = @()
if (-not $NoDesktop) { $targets += (Join-Path $Desktop 'MetaClean.lnk') }
$targets += (Join-Path $StartMenu 'MetaClean.lnk')

foreach ($lnk in $targets) {
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath       = $wscript
    $sc.Arguments        = '"' + $VbsPath + '" ' + $Mode
    $sc.WorkingDirectory = $Root
    $sc.Description      = 'MetaClean - strip EXIF, GPS and camera metadata from photos'
    $sc.WindowStyle      = 1
    if ($IcoPath) { $sc.IconLocation = "$IcoPath,0" }
    $sc.Save()
    Write-Host "  created  $lnk" -ForegroundColor DarkGray
}

[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)

Write-Host ""
Write-Host "  Done. Launch MetaClean from the Desktop or Start Menu." -ForegroundColor Green
Write-Host ""
Write-Host "  For full Windows integration (taskbar app, jump list, and" -ForegroundColor DarkGray
Write-Host "  'Open with > MetaClean' in File Explorer), open MetaClean and" -ForegroundColor DarkGray
Write-Host "  click the Install button in the header once." -ForegroundColor DarkGray
Write-Host ""
