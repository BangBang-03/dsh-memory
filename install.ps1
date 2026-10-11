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

  远程更新模式（-FromNpm）：先从 npm registry 拉取指定包的 tarball，解包到
  <DshHome>/plugins/dsh-memory，再对它执行上面三步。重跑同一条命令即完成更新
  （脚本会整体替换 plugins 里的旧版本，junction 与 profile 引用的目录名不变，
  所以 DSH 侧不需要任何额外动作）。registry 用 GitHub Packages 时把 PAT 传给
  -NpmToken（需 read:packages）。

.PARAMETER Profile
  profile 名，默认 desktop。

.PARAMETER DshHome
  DSH 主目录，默认 $env:DSH_HOME 或 ~/.dsh。

.PARAMETER PackageRoot
  本包根目录，默认脚本所在目录。-FromNpm 模式下忽略，改用解包目录。

.PARAMETER FromNpm
  远程包描述，如 "@bangbang-03/dsh-memory"（取 latest）或 "@bangbang-03/dsh-memory@0.3.1"（锁定版本）。

.PARAMETER Registry
  npm registry 根地址，默认 https://registry.npmjs.org；GitHub Packages 用
  https://npm.pkg.github.com（必须配 -NpmToken）。

.PARAMETER NpmToken
  访问 registry 用的 Bearer token（GitHub Packages 必填，npmjs 公共包可省）。
  默认读环境变量 NPM_TOKEN。

.PARAMETER DryRun
  只打印将要做的改动，不落盘、不联网。

.EXAMPLE
  pwsh -File install.ps1
  pwsh -File install.ps1 -Profile web -DryRun
  pwsh -File install.ps1 -FromNpm "@bangbang-03/dsh-memory" -Registry https://npm.pkg.github.com -NpmToken $env:NPM_TOKEN
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [string]$PackageRoot = $PSScriptRoot,
  [string]$FromNpm = '',
  [string]$Registry = 'https://registry.npmjs.org',
  [string]$NpmToken = $(if ($env:NPM_TOKEN) { $env:NPM_TOKEN } else { '' }),
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

<# 删包目录专用：PS 5.1 的 Remove-Item -Recurse 会跟进 junction 删到目标里，
   会把共享的 @deepseek-ai 模块清掉。先把目录里已知的 junction 用 rmdir 摘掉再删本体。 #>
function Remove-PackageDir([string]$Path) {
  $shim = Join-Path $Path 'node_modules\@deepseek-ai'
  if (Test-Path -LiteralPath $shim) {
    $item = Get-Item -LiteralPath $shim -Force
    if ($item.LinkType -eq 'Junction') {
      Write-Step "摘掉垫片 junction $shim"
      if (-not $DryRun) { cmd /c rmdir "$shim" | Out-Null }
    }
  }
  if (-not $DryRun) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

Write-Host "dsh-memory 安装（profile=$Profile, dryRun=$($DryRun.IsPresent)）"

$pkgRoot = (Resolve-Path -LiteralPath $PackageRoot).Path

# ---------------------------------------------------------------- #
# 可选：远程更新模式（-FromNpm）：从 registry 拉 tarball 解包到
# <DshHome>/plugins/dsh-memory，之后 $pkgRoot 切到那里继续走本地安装三步。
# ---------------------------------------------------------------- #

if ($FromNpm) {
  # 规范：<name> 或 <name>@<version>；scoped 名自带开头的 @，版本分隔要找第二个 @。
  $npmName = $FromNpm
  $wantVersion = ''
  if ($FromNpm.StartsWith('@')) {
    $secondAt = $FromNpm.IndexOf('@', 1)
    if ($secondAt -ge 0) {
      $npmName = $FromNpm.Substring(0, $secondAt)
      $wantVersion = $FromNpm.Substring($secondAt + 1)
    }
  } elseif ($FromNpm.Contains('@')) {
    $at = $FromNpm.IndexOf('@')
    $npmName = $FromNpm.Substring(0, $at)
    $wantVersion = $FromNpm.Substring($at + 1)
  }
  if (-not $npmName) { throw "-FromNpm 缺少包名：'$FromNpm'" }

  $remoteTarget = Join-Path (Join-Path $DshHome 'plugins') $PackageName
  $specLabel = if ($wantVersion) { "$npmName@$wantVersion" } else { "$npmName（latest）" }

  if ($DryRun) {
    Write-Step "[dry] 会从 $Registry 拉 $specLabel"
    Write-Step "[dry] 解包替换 $remoteTarget，再按本地三步安装（垫片 / package.json / junction）"
    Write-Host ''
    Write-Host 'dry run 结束，没有改动任何文件、没有联网。'
    return
  }

  if (-not $NpmToken) {
    Write-Warning "没有 -NpmToken：npmjs 公共包可以匿名拉，GitHub Packages 必须提供 PAT（read:packages）"
  }
  $headers = @{}
  if ($NpmToken) { $headers['Authorization'] = "Bearer $NpmToken" }

  # PowerShell 5.1 默认不一定启用 TLS 1.2，registry 全是 https。
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $encoded = [uri]::EscapeDataString($npmName)
  Write-Step "查询 $Registry/$encoded"
  try {
    $meta = Invoke-RestMethod -Uri "$Registry/$encoded" -Headers $headers
  } catch {
    throw "从 $Registry 查询 $npmName 失败：$($_.Exception.Message)（包不存在、版本不存在或 registry 不可达）"
  }
  $version = if ($wantVersion) { $wantVersion } else { [string]$meta.'dist-tags'.latest }
  if (-not $version) { throw "registry 元数据里没有 dist-tags.latest，且未指定版本" }
  $entry = $meta.versions.PSObject.Properties[$version]
  if (-not $entry) { throw "registry 上没有 $npmName@$version（现有版本：$(@($meta.versions.PSObject.Properties.Name) -join ', '))" }
  $tarball = [string]$entry.Value.dist.tarball
  if (-not $tarball) { throw "registry 元数据缺 dist.tarball" }

  Write-Step "下载 $tarball"
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $workDir = Join-Path ([IO.Path]::GetTempPath()) "dsh-memory-$PID-$stamp"
  $extractDir = Join-Path $workDir 'x'
  try {
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
    $tempTgz = Join-Path $workDir 'pkg.tgz'
    Invoke-WebRequest -Uri $tarball -Headers $headers -OutFile $tempTgz
    # GNU tar 会把 "C:\xxx" 的盘符冒号当成远程主机名，所以进到解包目录用相对路径解，
    # GNU/BSD 两种 tar 都不吃亏。
    Push-Location -LiteralPath $extractDir
    try { tar -xzf '../pkg.tgz' } finally { Pop-Location }
    $extracted = Join-Path $extractDir 'package'
    if (-not (Test-Path -LiteralPath (Join-Path $extracted 'cordis.patch.yml'))) {
      throw "tarball 里没有 cordis.patch.yml，不是 dsh-memory 包：$tarball"
    }
    $fetchedVersion = ((Get-Content -LiteralPath (Join-Path $extracted 'package.json') -Raw) | ConvertFrom-Json).version

    # 旧版本目录先改名兜底：新目录就位成功才清理；就位失败则把旧版本放回原位。
    $oldRoot = "$remoteTarget.old-$PID"
    if (Test-Path -LiteralPath $oldRoot) { Remove-PackageDir $oldRoot }
    $hadOld = Test-Path -LiteralPath $remoteTarget
    $swapped = $false
    if ($hadOld) {
      $oldVersion = ((Get-Content -LiteralPath (Join-Path $remoteTarget 'package.json') -Raw) | ConvertFrom-Json).version
      Move-Item -LiteralPath $remoteTarget -Destination $oldRoot
      Write-Step "旧版本 $oldVersion 暂存 -> $oldRoot"
    }
    try {
      $pluginsParent = Split-Path -Parent $remoteTarget
      if (-not (Test-Path -LiteralPath $pluginsParent)) { New-Item -ItemType Directory -Path $pluginsParent -Force | Out-Null }
      Move-Item -LiteralPath $extracted -Destination $remoteTarget
      $swapped = $true
      Write-Step "已就位 $remoteTarget（$npmName@$fetchedVersion）"
    } finally {
      if (-not $swapped -and (Test-Path -LiteralPath $oldRoot)) {
        Move-Item -LiteralPath $oldRoot -Destination $remoteTarget -Force
        Write-Step "新版本就位失败，已恢复旧版本 $remoteTarget"
      } elseif ($swapped -and (Test-Path -LiteralPath $oldRoot)) {
        Remove-PackageDir $oldRoot
        Write-Step "旧版本目录已清理"
      }
    }
    $pkgRoot = (Resolve-Path -LiteralPath $remoteTarget).Path
  } finally {
    if (Test-Path -LiteralPath $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force }
  }
}

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
  if ($FromNpm) { Write-Host "更新：重跑同一条 -FromNpm 命令即可，脚本会整体替换 $remoteTarget 里的旧版本。" }
  Write-Host "回滚： pwsh -File uninstall.ps1 -Profile $Profile"
}
