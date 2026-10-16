param(
    [string]$ProjectRoot = 'D:\Unreal_Projects\StoryBlueprintDemo'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$projectFile = Join-Path $projectRootPath 'StoryBlueprintDemo.uproject'
if (-not (Test-Path -LiteralPath $projectFile -PathType Leaf)) {
    throw "Expected StoryBlueprintDemo.uproject at $projectRootPath"
}
$project = Get-Content -LiteralPath $projectFile -Raw | ConvertFrom-Json
if ($project.EngineAssociation -ne '5.5') {
    Write-Warning "Project uses UE $($project.EngineAssociation); this sample was first prepared for 5.5."
}
$pluginSource = Join-Path $sourceRoot 'StoryBlueprint'
$pluginsDir = Join-Path $projectRootPath 'Plugins'
$pluginTarget = Join-Path $pluginsDir 'StoryBlueprint'
if (-not (Test-Path -LiteralPath $pluginsDir)) {
    New-Item -ItemType Directory -Path $pluginsDir | Out-Null
}
if (-not (Test-Path -LiteralPath $pluginTarget)) {
    New-Item -ItemType Directory -Path $pluginTarget | Out-Null
}
Get-ChildItem -LiteralPath $pluginSource -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($pluginSource.Length).TrimStart('\')
    $destination = Join-Path $pluginTarget $relative
    $destinationDir = Split-Path -Path $destination -Parent
    if (-not (Test-Path -LiteralPath $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
}

$contentDir = Join-Path $projectRootPath 'Content\StoryBlueprint'
if (-not (Test-Path -LiteralPath $contentDir)) {
    New-Item -ItemType Directory -Path $contentDir | Out-Null
}
$fixture = Join-Path $sourceRoot '..\..\docs\examples\sample-quest.storyc.json'
Copy-Item -LiteralPath $fixture -Destination (Join-Path $contentDir 'sample-quest.storyc.json') -Force

if (-not @($project.Plugins | Where-Object { $_.Name -eq 'StoryBlueprint' }).Count) {
    $project.Plugins = @($project.Plugins) + @([pscustomobject]@{ Name = 'StoryBlueprint'; Enabled = $true })
    $project | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $projectFile -Encoding utf8
}

$engineConfig = Join-Path $projectRootPath 'Config\DefaultEngine.ini'
$configText = Get-Content -LiteralPath $engineConfig -Raw
$modeLine = 'GlobalDefaultGameMode=/Script/StoryBlueprint.StoryBlueprintDemoGameMode'
if ($configText -notmatch '(?m)^GlobalDefaultGameMode=') {
    $heading = '[/Script/EngineSettings.GameMapsSettings]'
    if (-not $configText.Contains($heading)) { throw 'Missing GameMapsSettings section' }
    $configText = $configText.Replace($heading, "$heading`r`n$modeLine")
    Set-Content -LiteralPath $engineConfig -Value $configText -Encoding utf8 -NoNewline
}
Write-Output "Installed StoryBlueprint sample into $projectRootPath"
