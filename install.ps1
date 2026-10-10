#Requires -Version 5.1
<#
.SYNOPSIS
  把 dsh-memory 装进某个 DSH profile（默认 desktop）。

.DESCRIPTION
  `dsh plugin --profile desktop add …` 会被拒绝（desktop 由 Electron 应用独占管理），
  所以手工安装分三步，本脚本把三步做完并保证可回滚：

    1. 包内垫片  node_modules/@deepseek-ai  ->  <DSH_HOME>/profiles/node_modules/@deepseek-ai
       （profile 用 junction 挂载本包时，Node 按 realpath 解析，源码目录向上找不到
        profile 的 node_modules，缺这层垫片宿主半就 import 不到 @deepseek-ai/*。）
    2. 在 <profile>/package.json 里
         dsh.profile.bundles += "dsh-memory"
         dependencies["dsh-memory"] = "link:<本包路径>"
       进了 bundles 之后包自带的 cordis.patch.yml 会被自动应用，不用改 profile 的 patch 文件。
    3. <profile>/node_modules/dsh-memory -> <本包路径>（junction）

  改 package.json 前一定先备份；写盘用「临时文件 + 替换」，避免上次那种截断事故。

.PARAMETER Profile
  profile 名，默认 desktop。

.PARAMETER DshHome
  DSH 主目录，默认 $env:DSH_HOME 或 ~/.dsh。

.PARAMETER PackageRoot
  本包根目录，默认脚本所在目录。

.PARAMETER DryRun
  只打印将要做的改动，不落盘。

.EXAMPLE
  pwsh -File install.ps1
  pwsh -File install.ps1 -Profile web -DryRun
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [string]$PackageRoot = $PSScriptRoot,
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

function New-JunctionSafe([string]$Path, [string]$Target) {
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) {
    Write-Step "建目录 $parent"
    if (-not $DryRun) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  }
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.LinkType -ne 'Junction') { throw "已存在且不是 junction，拒绝覆盖：$Path" }
    $current = @($item.Target)[0]
    if ($current -eq $Target) { Write-Step "junction 已就位：$Path"; return $false }
    throw "junction 指向别处：$Path -> $current（期望 $Target）"
  }
  Write-Step "建 junction $Path -> $Target"
  if (-not $DryRun) { New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null }
  return $true
}

function Save-Json([string]$Path, $Object) {
  $text = $Object | ConvertTo-Json -Depth 24
  $temp = "$Path.tmp-$PID"
  if (-not $DryRun) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temp, $text, $utf8)
    Move-Item -LiteralPath $temp -Destination $Path -Force
  }
}

Write-Host "dsh-memory 安装（profile=$Profile, dryRun=$($DryRun.IsPresent)）"

$pkgRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $pkgRoot 'cordis.patch.yml'))) {
  throw "$pkgRoot 看起来不是 dsh-memory 包根目录（缺 cordis.patch.yml）"
}

$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileJson = Join-Path $profileDir 'package.json'
if (-not (Test-Path -LiteralPath $profileJson)) { throw "找不到 profile 的 package.json：$profileJson" }

$sharedModules = Join-Path (Join-Path $DshHome 'profiles') 'node_modules'
if (-not (Test-Path -LiteralPath (Join-Path $sharedModules '@deepseek-ai'))) {
  Write-Warning "找不到 $sharedModules\@deepseek-ai，垫片可能指向一个不存在的目录"
}

# 1. 垫片
New-JunctionSafe -Path (Join-Path $pkgRoot 'node_modules\@deepseek-ai') -Target (Join-Path $sharedModules '@deepseek-ai') | Out-Null

# 2. package.json
$raw = Get-Content -LiteralPath $profileJson -Raw
$json = $raw | ConvertFrom-Json
if (-not $json.dsh) { throw "$profileJson 里没有 dsh 字段，可能不是 profile 清单" }
if (-not $json.dsh.profile) { throw "$profileJson 里没有 dsh.profile 字段" }

$linkTarget = 'link:' + ($pkgRoot -replace '\\', '/')
$bundles = @($json.dsh.profile.bundles)
$hasBundle = $bundles -contains $PackageName
$hasDep = $json.dependencies -and ($json.dependencies.PSObject.Properties.Name -contains $PackageName)

if ($hasBundle -and $hasDep) {
  Write-Step "package.json 已经是目标状态（bundles 与 dependencies 都含 $PackageName）"
} else {
  if (-not $DryRun) {
    $backup = Get-BackupPath $profileJson
    Copy-Item -LiteralPath $profileJson -Destination $backup -Force
    Write-Step "备份 -> $(Split-Path -Leaf $backup)"
  } else {
    Write-Step "[dry] 会先备份 package.json"
  }
  if (-not $hasBundle) {
    $json.dsh.profile.bundles = @($bundles + $PackageName)
    Write-Step "bundles += $PackageName"
  }
  if (-not $hasDep) {
    if (-not $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
    $json.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue $linkTarget -Force
    Write-Step "dependencies.$PackageName = $linkTarget"
  }
  Save-Json -Path $profileJson -Object $json
  Write-Step "写入 $profileJson"
}

# 3. profile junction
New-JunctionSafe -Path (Join-Path $profileDir "node_modules\$PackageName") -Target $pkgRoot | Out-Null

Write-Host ''
if ($DryRun) { Write-Host 'dry run 结束，没有改动任何文件。' }
else {
  Write-Host "装好了。重启 DSH 桌面端（profile=$Profile）后：设置 → 记忆。"
  Write-Host "回滚： pwsh -File uninstall.ps1 -Profile $Profile"
}
