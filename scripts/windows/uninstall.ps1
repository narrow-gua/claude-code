[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Prism'),
  [switch]$RemoveConfig
)

$ErrorActionPreference = 'Stop'
$binRoot = Join-Path $InstallRoot 'bin'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$remainingEntries = @($userPath -split ';' | Where-Object {
  $_.Trim() -and $_.TrimEnd('\') -ine $binRoot.TrimEnd('\')
})
[Environment]::SetEnvironmentVariable('Path', ($remainingEntries -join ';'), 'User')

if (Test-Path -LiteralPath $InstallRoot) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}

if ($RemoveConfig) {
  $configRoot = Join-Path $HOME '.prism'
  if (Test-Path -LiteralPath $configRoot) {
    Remove-Item -LiteralPath $configRoot -Recurse -Force
  }
  Write-Host 'Prism and its .prism configuration were removed.' -ForegroundColor Green
} else {
  Write-Host 'Prism was removed. The .prism configuration was preserved.' -ForegroundColor Green
}

Write-Host 'Open a new terminal window to refresh PATH.'
Write-Host 'The official claude command and .claude configuration were not modified.'
