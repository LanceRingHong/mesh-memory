# 安装 dsh-mesh 到 DSH profile（带备份与回滚）
# 用法：
#   pwsh -File .\install.ps1                      # 装到 desktop + web（存在的才装）
#   pwsh -File .\install.ps1 -Profiles desktop    # 只装桌面
#   pwsh -File .\install.ps1 -Rollback            # 回滚到上一个备份
param(
  [string[]]$Profiles = @('desktop', 'web'),
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$keepBackups = 5

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Remove-ShipExcludes([string]$Target) {
  foreach ($name in @('.git', '.github', 'test', '.backups')) {
    $path = Join-Path $Target $name
    if (Test-Path $path) { Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Get-ChildItem $Target -Filter '*.bak-*' -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

if ($Rollback) {
  foreach ($name in $Profiles) {
    $profileDir = Join-Path $dshHome "profiles\$name"
    if (-not (Test-Path $profileDir)) { Write-Output "skip $name (profile not found)"; continue }
    $backupRoot = Join-Path $profileDir '.dsh-mesh-backups'
    $latest = Get-ChildItem $backupRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
    if (-not $latest) { Write-Output "no backup for $name"; continue }

    $dst = Join-Path $profileDir 'node_modules\dsh-mesh'
    Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $latest.FullName 'dsh-mesh') $dst -Recurse -Force
    foreach ($file in @('package.json', 'cordis.patch.yml')) {
      $backup = Join-Path $latest.FullName $file
      if (Test-Path $backup) { Copy-Item $backup (Join-Path $profileDir $file) -Force }
    }
    Write-Output "rolled back $name from $($latest.FullName)"
  }
  exit 0
}

foreach ($name in $Profiles) {
  $profileDir = Join-Path $dshHome "profiles\$name"
  if (-not (Test-Path $profileDir)) {
    Write-Output "skip $name (profile not found)"
    continue
  }
  $dst = Join-Path $profileDir 'node_modules\dsh-mesh'
  $backupRoot = Join-Path $profileDir '.dsh-mesh-backups'
  $backupDir = Join-Path $backupRoot $stamp

  # 先备份，再替换：安装失败可以直接 -Rollback。
  if (Test-Path $dst) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item $dst (Join-Path $backupDir 'dsh-mesh') -Recurse -Force
    foreach ($file in @('package.json', 'cordis.patch.yml')) {
      $p = Join-Path $profileDir $file
      if (Test-Path $p) { Copy-Item $p (Join-Path $backupDir $file) -Force }
    }
    Get-ChildItem $backupRoot -Directory | Sort-Object Name -Descending |
      Select-Object -Skip $keepBackups | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output "backup $name -> $backupDir"
  }

  Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item $src $dst -Recurse -Force
  Remove-ShipExcludes $dst

  $pkgPath = Join-Path $profileDir 'package.json'
  $json = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if ($null -eq $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $json.dsh.profile.bundles) { $json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
  $bundles = @($json.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-mesh') { $bundles += 'dsh-mesh' }
  $json.dsh.profile.bundles = $bundles
  Write-Utf8NoBom $pkgPath ($json | ConvertTo-Json -Depth 20)

  $patch = Join-Path $profileDir 'cordis.patch.yml'
  if (Test-Path $patch) {
    Add-Content $patch "`n# dsh-mesh reload $stamp`n" -Encoding utf8
  }
  Write-Output "installed $name -> $dst (bundles: $($bundles -join ', '))"
}
Write-Output 'done. If the running host does not hot-reload, restart DSH.'
