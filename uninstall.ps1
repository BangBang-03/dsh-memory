#Requires -Version 5.1
<#
.SYNOPSIS
  从某个 DSH profile 里卸掉 dsh-memory（install.ps1 的逆操作）。

.DESCRIPTION
  - 从 <profile>/package.json 的 dsh.profile.bundles 与 dependencies 里移除 dsh-memory（改前备份）。
  - 删掉 <profile>/node_modules/dsh-memory 这层 junction。只删 junction，绝不跟进目标目录。
  - 默认**不动**记忆数据（~/.dsh/storages/dsh-memory）。要连数据一起删得显式加 -PurgeStorage。

.PARAMETER Profile
  profile 名，默认 desktop。

.PARAMETER DshHome
  DSH 主目录，默认 $env:DSH_HOME 或 ~/.dsh。

.PARAMETER PurgeStorage
  连 ~/.dsh/storages/dsh-memory 一起删掉（记忆全丢，慎用）。

.PARAMETER DryRun
  只打印将要做的改动，不落盘。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [switch]$PurgeStorage,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$PackageName = 'dsh-memory'

function Write-Step([string]$Text) { Write-Host "  $Text" }

<# 备份名按秒带时间戳；同一秒内多次改动就往后编号，绝不覆盖已有备份。 #>
function Get-BackupPath([string]$Path) {
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
  $candidate = "$Path.bak-$stamp"
  $n = 1
  while (Test-Path -LiteralPath $candidate) {
    $candidate = "$Path.bak-$stamp-$n"
    $n += 1
  }
  return $candidate
}

function Remove-JunctionSafe([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { Write-Step "本来就不存在：$Path"; return }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -ne 'Junction') {
    throw "拒绝删除非 junction 路径（可能是真实目录，删了会丢东西）：$Path"
  }
  Write-Step "删 junction $Path"
  if (-not $DryRun) { cmd /c rmdir "$Path" | Out-Null }
}

Write-Host "dsh-memory 卸载（profile=$Profile, dryRun=$($DryRun.IsPresent)）"

$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileJson = Join-Path $profileDir 'package.json'

if (Test-Path -LiteralPath $profileJson) {
  $json = (Get-Content -LiteralPath $profileJson -Raw) | ConvertFrom-Json
  $bundles = @($json.dsh.profile.bundles)
  $depNames = if ($json.dependencies) { @($json.dependencies.PSObject.Properties.Name) } else { @() }
  $hasBundle = $bundles -contains $PackageName
  $hasDep = $depNames -contains $PackageName

  if ($hasBundle -or $hasDep) {
    if (-not $DryRun) {
      $backup = Get-BackupPath $profileJson
      Copy-Item -LiteralPath $profileJson -Destination $backup -Force
      Write-Step "备份 -> $(Split-Path -Leaf $backup)"
    } else {
      Write-Step '[dry] 会先备份 package.json'
    }
    if ($hasBundle) {
      $json.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne $PackageName })
      Write-Step "bundles -= $PackageName"
    }
    if ($hasDep) {
      $json.dependencies.PSObject.Properties.Remove($PackageName)
      Write-Step "dependencies -= $PackageName"
    }
    $text = $json | ConvertTo-Json -Depth 24
    if (-not $DryRun) {
      $temp = "$profileJson.tmp-$PID"
      [System.IO.File]::WriteAllText($temp, $text, (New-Object System.Text.UTF8Encoding($false)))
      Move-Item -LiteralPath $temp -Destination $profileJson -Force
    }
    Write-Step "写入 $profileJson"
  } else {
    Write-Step "package.json 里没有 $PackageName，跳过"
  }
} else {
  Write-Step "找不到 $profileJson，跳过清单清理"
}

Remove-JunctionSafe -Path (Join-Path $profileDir "node_modules\$PackageName")
# 垫片留着无害（它只是指向共享的 @deepseek-ai），删它反而可能影响同一源码目录的其它装法。
Write-Step "保留垫片 $(Join-Path $PackageName 'node_modules\@deepseek-ai')（无害）"

$storage = Join-Path (Join-Path $DshHome 'storages') $PackageName
if ($PurgeStorage) {
  if (Test-Path -LiteralPath $storage) {
    Write-Step "删记忆数据 $storage"
    if (-not $DryRun) { Remove-Item -LiteralPath $storage -Recurse -Force }
  } else {
    Write-Step "没有记忆数据目录 $storage"
  }
} else {
  Write-Step "记忆数据保留在 $storage（要一起删加 -PurgeStorage）"
}

Write-Host ''
if ($DryRun) { Write-Host 'dry run 结束，没有改动任何文件。' }
else { Write-Host '卸好了。重启 DSH 桌面端生效。' }
