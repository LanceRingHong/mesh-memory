# 安装 dsh-mesh 到 DSH profile
# 用法：powershell -ExecutionPolicy Bypass -File .\install.ps1
# 默认安装 desktop + web（存在的才装）；只装桌面可传 -Profiles desktop。
param(
  [string[]]$Profiles = @('desktop', 'web')
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

foreach ($name in $Profiles) {
  $profileDir = Join-Path $dshHome "profiles\$name"
  if (-not (Test-Path $profileDir)) {
    Write-Output "skip $name (profile not found)"
    continue
  }
  $dst = Join-Path $profileDir 'node_modules\dsh-mesh'
  Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item $src $dst -Recurse -Force
  # The source tree is a git checkout; don't ship .git into node_modules.
  Remove-Item (Join-Path $dst '.git') -Recurse -Force -ErrorAction SilentlyContinue

  $pkgPath = Join-Path $profileDir 'package.json'
  Copy-Item $pkgPath "$pkgPath.bak-mesh-$stamp" -Force
  $json = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if ($null -eq $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $json.dsh.profile.bundles) { $json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
  $bundles = @($json.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-mesh') { $bundles += 'dsh-mesh' }
  $json.dsh.profile.bundles = $bundles
  $json | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding utf8

  $patch = Join-Path $profileDir 'cordis.patch.yml'
  if (Test-Path $patch) {
    Add-Content $patch "`n# dsh-mesh reload $stamp`n" -Encoding utf8
  }
  Write-Output "installed $name -> $dst (bundles: $($bundles -join ', '))"
}
Write-Output 'done. If the running host does not hot-reload, restart DSH.'
