# Legt eine Desktop-Verknuepfung und einen "Senden an"-Eintrag fuer die Zeitraffer-App an.
# Ausfuehren: Rechtsklick > "Mit PowerShell ausfuehren"
$app = $PSScriptRoot
$exe = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) {
    Write-Host 'Electron fehlt - bitte zuerst "npm run setup" im App-Ordner ausfuehren.'
    exit 1
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Zeitraffer.lnk'),
    (Join-Path ([Environment]::GetFolderPath('SendTo')) 'Zeitraffer.lnk')
)
foreach ($lnkPath in $targets) {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $exe
    $lnk.Arguments = "`"$app`""
    $lnk.WorkingDirectory = $app
    $lnk.Description = 'Zeitraffer aus Screencasts erstellen'
    $lnk.Save()
    Write-Host "Angelegt: $lnkPath"
}
