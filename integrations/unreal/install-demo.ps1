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
Copy-Item -LiteralPath (Join-Path $sourceRoot 'README.md') -Destination (Join-Path $pluginTarget 'README.md') -Force

# These two files belonged to the first sample and now live in the project module.
foreach ($relative in @('Source\StoryBlueprint\Public\StoryBlueprintDemo.h', 'Source\StoryBlueprint\Private\StoryBlueprintDemo.cpp')) {
    $legacyFile = Join-Path $pluginTarget $relative
    if (Test-Path -LiteralPath $legacyFile -PathType Leaf) { Remove-Item -LiteralPath $legacyFile -Force }
}

$sampleSource = Join-Path $sourceRoot 'SampleSource\StoryBlueprintDemo'
$gameModuleDir = Join-Path $projectRootPath 'Source\StoryBlueprintDemo'
Get-ChildItem -LiteralPath $sampleSource -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $gameModuleDir $_.Name) -Force
}
$buildFile = Join-Path $gameModuleDir 'StoryBlueprintDemo.Build.cs'
$buildText = Get-Content -LiteralPath $buildFile -Raw
if (-not $buildText.Contains('"StoryBlueprint"')) {
    $buildText = $buildText.Replace('"Core",', '"StoryBlueprint", "Core",')
    Set-Content -LiteralPath $buildFile -Value $buildText -Encoding utf8 -NoNewline
}

$contentDir = Join-Path $projectRootPath 'Content\StoryBlueprint'
if (-not (Test-Path -LiteralPath $contentDir)) {
    New-Item -ItemType Directory -Path $contentDir | Out-Null
}
$fixture = Join-Path $sourceRoot '..\..\docs\examples\sample-quest.storyc.json'
Copy-Item -LiteralPath $fixture -Destination (Join-Path $contentDir 'sample-quest.storyc.json') -Force
$contractDir = Join-Path $contentDir 'Fixtures'
if (-not (Test-Path -LiteralPath $contractDir)) {
    New-Item -ItemType Directory -Path $contractDir | Out-Null
}
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'Fixtures') -Filter '*.json' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $contractDir $_.Name) -Force
}

if (-not @($project.Plugins | Where-Object { $_.Name -eq 'StoryBlueprint' }).Count) {
    $project.Plugins = @($project.Plugins) + @([pscustomobject]@{ Name = 'StoryBlueprint'; Enabled = $true })
    $project | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $projectFile -Encoding utf8
}

$engineConfig = Join-Path $projectRootPath 'Config\DefaultEngine.ini'
$configText = Get-Content -LiteralPath $engineConfig -Raw
$modeLine = 'GlobalDefaultGameMode=/Script/StoryBlueprintDemo.StoryDemoGameMode'
if ($configText.Contains('GlobalDefaultGameMode=/Script/StoryBlueprint.StoryBlueprintDemoGameMode')) {
    $configText = $configText.Replace('GlobalDefaultGameMode=/Script/StoryBlueprint.StoryBlueprintDemoGameMode', $modeLine)
    Set-Content -LiteralPath $engineConfig -Value $configText -Encoding utf8 -NoNewline
}
if ($configText -notmatch '(?m)^GlobalDefaultGameMode=') {
    $heading = '[/Script/EngineSettings.GameMapsSettings]'
    if (-not $configText.Contains($heading)) { throw 'Missing GameMapsSettings section' }
    $configText = $configText.Replace($heading, "$heading`r`n$modeLine")
    Set-Content -LiteralPath $engineConfig -Value $configText -Encoding utf8 -NoNewline
}
Write-Output "Installed StoryBlueprint sample into $projectRootPath"
