# Laedt einen ffmpeg-Build (BtbN, GPL, shared) nach vendor/ffmpeg,
# damit electron-builder ihn ins Paket legt (resources/ffmpeg).
# Wird von GitHub Actions vor dem Build aufgerufen, geht aber auch lokal.
param(
    [string]$Asset = 'ffmpeg-n9.0-latest-win64-gpl-shared-9.0'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root   = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor\ffmpeg'
$tmp    = Join-Path ([IO.Path]::GetTempPath()) ("ffmpeg-" + [guid]::NewGuid())
$url    = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$Asset.zip"

New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    Write-Host "Lade $url"
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp 'ffmpeg.zip')
    Expand-Archive (Join-Path $tmp 'ffmpeg.zip') -DestinationPath $tmp
    $src = Join-Path $tmp $Asset

    if (Test-Path $vendor) { Remove-Item $vendor -Recurse -Force }
    New-Item -ItemType Directory -Force (Join-Path $vendor 'bin') | Out-Null

    # Nur was die App braucht: ffmpeg, ffprobe und die gemeinsamen Bibliotheken
    Copy-Item (Join-Path $src 'bin\ffmpeg.exe'), (Join-Path $src 'bin\ffprobe.exe') (Join-Path $vendor 'bin')
    Copy-Item (Join-Path $src 'bin\*.dll') (Join-Path $vendor 'bin')
    Copy-Item (Join-Path $src 'LICENSE.txt') $vendor

    @"
ffmpeg – mitgeliefert mit Zeitraffer

Build:   $Asset
Quelle:  https://github.com/BtbN/FFmpeg-Builds (Build-Skripte)
         https://ffmpeg.org/download.html#get-sources (Quellcode von FFmpeg)

Dieser Build steht unter der GNU General Public License, Version 3
(siehe LICENSE.txt). Zeitraffer ruft ffmpeg.exe und ffprobe.exe als
eigenstaendige Programme auf; der Quelltext des Builds ist ueber die
oben genannten Adressen erhaeltlich.
"@ | Set-Content -Encoding utf8 (Join-Path $vendor 'README.txt')

    & (Join-Path $vendor 'bin\ffmpeg.exe') -hide_banner -version | Select-Object -First 1
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
