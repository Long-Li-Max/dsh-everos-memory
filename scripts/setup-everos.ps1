<#
.SYNOPSIS
  一次性安装 EverOS 服务（Windows），并打印需要填进插件设置的值。

.DESCRIPTION
  - 创建 Python 虚拟环境（默认 <root>\venv）
  - pip install everos（从官方 PyPI 安装，不需要手动去官网下载）
  - 若 <root>\everos.toml 不存在，从仓库 docs/everos.toml.example 复制一份
  - 打印 everosDir / startCommand / panelLogPath，复制到 DSH 面板「设置」即可

.PARAMETER Root
  服务与记忆数据根目录，默认 %ProgramData%\everos（可用 EVEROS_DIR 环境变量改）

.PARAMETER Python
  Python 解释器命令，默认 python（需要 3.10 及以上）

.PARAMETER VenvPath
  自定义虚拟环境目录，默认 <Root>\venv

.PARAMETER SkipInstall
  只创建目录 / 生成配置 / 打印提示，不安装 Python 包

.PARAMETER DryRun
  只打印计划，不做任何修改

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-everos.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-everos.ps1 -Root D:\everos -DryRun
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [string]$Python = 'python',
  [string]$VenvPath = '',
  [switch]$SkipInstall,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$isWindows = ($env:OS -eq 'Windows_NT')
function Get-DefaultRoot {
  if ($env:EVEROS_DIR) { return $env:EVEROS_DIR }
  if ($isWindows) {
    $programData = [Environment]::GetFolderPath('CommonApplicationData')
    if ($programData) { return (Join-Path $programData 'everos') }
  }
  return (Join-Path $HOME '.everos')
}
if ($Root -eq '') { $Root = Get-DefaultRoot }

$venv = if ($VenvPath -ne '') { $VenvPath } else { Join-Path $Root 'venv' }
$exe = if ($isWindows) { Join-Path $venv 'Scripts\everos.exe' } else { Join-Path (Join-Path $venv 'bin') 'everos' }
$pip = if ($isWindows) { Join-Path $venv 'Scripts\pip.exe' } else { Join-Path (Join-Path $venv 'bin') 'pip' }
$logDir = Join-Path $Root 'logs'
$logPath = Join-Path $logDir 'everos-server.log'
$tomlPath = Join-Path $Root 'everos.toml'
$template = Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\everos.toml.example'
$startCommand = '"' + $exe + '" server start --root "' + $Root + '"'

Write-Host ''
Write-Host '=== EverOS 服务安装 ===' -ForegroundColor Cyan
Write-Host ("  平台        : {0}" -f $(if ($isWindows) { 'Windows' } else { '非 Windows（服务启停目前仅 Windows 支持）' }))
Write-Host ("  Python      : {0}" -f $Python)
Write-Host ("  根目录      : {0}" -f $Root)
Write-Host ("  虚拟环境    : {0}" -f $venv)
Write-Host ("  可执行文件  : {0}" -f $exe)
Write-Host ("  日志文件    : {0}" -f $logPath)
Write-Host ("  配置文件    : {0}" -f $tomlPath)
Write-Host ''

if ($DryRun) {
  Write-Host '[-DryRun] 只打印计划，未做任何修改。' -ForegroundColor Yellow
  exit 0
}

# 1) 检查 Python 版本
try {
  $versionText = & $Python -c "import sys; print('%d.%d' % (sys.version_info[0], sys.version_info[1]))"
  if ($LASTEXITCODE -ne 0) { throw 'python 无法运行' }
} catch {
  Write-Host ("找不到可用的 Python（{0}）。请先安装 Python 3.10+ 并确保 python 在 PATH 里。" -f $Python) -ForegroundColor Red
  exit 1
}
$versionText = ($versionText | Select-Object -First 1).Trim()
Write-Host ("检测到 Python {0}" -f $versionText)
$parts = $versionText.Split('.')
if ([int]$parts[0] -lt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -lt 10)) {
  Write-Host '需要 Python 3.10 及以上版本。' -ForegroundColor Red
  exit 1
}

# 2) 创建虚拟环境
if (-not (Test-Path $venv)) {
  Write-Host '创建虚拟环境…'
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) { Write-Host '创建虚拟环境失败。' -ForegroundColor Red; exit 1 }
} else {
  Write-Host '虚拟环境已存在，跳过创建。'
}

# 3) 安装 everos
if ($SkipInstall) {
  Write-Host '[-SkipInstall] 跳过 pip install。'
} else {
  Write-Host '升级 pip…'
  & $pip install --upgrade pip --quiet
  Write-Host '安装 everos（来自官方 PyPI，可能需要几分钟）…' -ForegroundColor Cyan
  & $pip install everos
  if ($LASTEXITCODE -ne 0) { Write-Host '安装失败：请检查网络或代理。' -ForegroundColor Red; exit 1 }
}

# 4) 目录与配置模板
if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Force -Path $Root | Out-Null }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
if (-not (Test-Path $tomlPath)) {
  if (Test-Path $template) {
    Copy-Item $template $tomlPath
    Write-Host ("已生成配置模板：{0}" -f $tomlPath)
  } else {
    Write-Host ("提示：没找到模板 {0}，首次启动也可以先用默认配置。" -f $template) -ForegroundColor Yellow
  }
} else {
  Write-Host 'everos.toml 已存在，保留原文件。'
}

if (-not (Test-Path $exe)) {
  Write-Host ("警告：{0} 不存在（如果用了 -SkipInstall 属正常）。" -f $exe) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 安装完成，接下来 ===' -ForegroundColor Green
Write-Host '1) 编辑 everos.toml，把 [llm] api_key 填成你自己的 API Key'
Write-Host ("   文件：{0}" -f $tomlPath)
Write-Host '2) 打开 DSH → EverOS 记忆 面板 → 点「设置」，把下面几项填进去（或直接编辑 profile 的 cordis.patch.yml 里 id: everos 的 config）：'
Write-Host ("   everosDir     : {0}" -f $Root)
Write-Host ("   startCommand  : {0}" -f $startCommand)
Write-Host ("   panelLogPath  : {0}" -f $logPath)
Write-Host '   autoStart     : true（想手动启动就保持 false）'
Write-Host '3) 返回面板点「启动」，首次启动约 30–70 秒；状态变绿后记忆开始工作'
Write-Host ''
Write-Host '提示：也可以不填启动命令，直接设置环境变量 EVEROS_EXE 指向上面的可执行文件。'
