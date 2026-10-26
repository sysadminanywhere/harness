param(
  [string]$Version = '',
  [string]$OutputDirectory = 'release'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$stage = Join-Path $outputRoot 'harness-lab-pwa'
$resolvedStage = [IO.Path]::GetFullPath($stage)
if (-not $resolvedStage.StartsWith($outputRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release staging directory must stay inside the output directory' }

if (-not $Version) {
  $package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $Version = [string]$package.version
}

if (-not $Version) { throw 'Version is required' }

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$files = @(
  'index.html', 'style.css', 'app.js', 'board.js', 'project.js', 'planner.js', 'i18n.js',
  'manifest.json', 'sw.js', 'favicon.svg', 'server.js', 'codex-bridge.js', 'model-settings.js', 'package.json', 'README.md', 'LICENSE'
)

foreach ($relativePath in $files) {
  $source = Join-Path $root $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relativePath" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $relativePath) -Force
}

@(
  'Harness Lab PWA',
  "Version: $Version",
  '',
  'This archive contains the local Harness Lab server and installable PWA shell.',
  'Start with: npm start',
  'The archive intentionally excludes local project data, .harness state, and development artifacts.'
) | Set-Content -LiteralPath (Join-Path $stage 'RELEASE.txt') -Encoding utf8

$safeVersion = $Version -replace '[^0-9A-Za-z._-]', '-'
$archive = Join-Path $outputRoot "harness-lab-pwa-v$safeVersion.zip"
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal

Write-Output $archive
