[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Prism')
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This installer only supports Windows.'
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Node.js is required. Install Node.js 20 or newer from https://nodejs.org/ and run this installer again.'
}

$nodeMajor = [int](& $node.Source -p "Number(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required. Current version: $(& $node.Source --version)"
}

$sourceDist = Join-Path $PSScriptRoot 'dist'
$sourceEntry = Join-Path $sourceDist 'cli-node.js'
if (-not (Test-Path -LiteralPath $sourceEntry -PathType Leaf)) {
  throw "Package is incomplete: $sourceEntry was not found. Extract the entire ZIP before installing."
}

$appRoot = Join-Path $InstallRoot 'app'
$targetDist = Join-Path $appRoot 'dist'
$binRoot = Join-Path $InstallRoot 'bin'
$launcher = Join-Path $binRoot 'prism.cmd'

New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
New-Item -ItemType Directory -Path $binRoot -Force | Out-Null

if (Test-Path -LiteralPath $targetDist) {
  Remove-Item -LiteralPath $targetDist -Recurse -Force
}
Copy-Item -LiteralPath $sourceDist -Destination $targetDist -Recurse -Force

$launcherContent = @'
@echo off
node "%~dp0..\app\dist\cli-node.js" %*
'@
[IO.File]::WriteAllText($launcher, $launcherContent, [Text.UTF8Encoding]::new($false))

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | Where-Object { $_.Trim() })
$alreadyInPath = $pathEntries | Where-Object {
  $_.TrimEnd('\') -ieq $binRoot.TrimEnd('\')
}
if (-not $alreadyInPath) {
  $newUserPath = (@($pathEntries) + $binRoot) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
}

if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $binRoot.TrimEnd('\') })) {
  $env:Path = "$binRoot;$env:Path"
}

$version = & $node.Source $sourceEntry --version
Write-Host ''
Write-Host "Prism $version installed successfully." -ForegroundColor Green
Write-Host "Command: prism"
Write-Host "Install directory: $InstallRoot"
Write-Host 'Configuration directory: %USERPROFILE%\.prism'
Write-Host ''
Write-Host 'Open a new PowerShell or Command Prompt window, then run: prism' -ForegroundColor Cyan
Write-Host 'The official claude command and .claude configuration were not modified.'
