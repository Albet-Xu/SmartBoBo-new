# 复制打包内核的同版本运行时依赖到 bobo/node_modules
# command-proxy / ui-settings-* 的裸导入（zod、schemastery 及传递依赖）靠它解析。
# dsh 内核升级后重跑本脚本即可对齐版本。
$ErrorActionPreference = 'Stop'
$kernel = Join-Path $env:APPDATA 'dsh-tauri\dependencies\dsh\node_modules'
$dest = 'E:\SmartBoBo\bobo\node_modules'
$pkgs = @(
  'zod',
  '@deepseek-ai\schemastery',
  '@deepseek-ai\cosmokit',
  '@standard-schema\spec'
)
if (-not (Test-Path $kernel)) { throw "内核 node_modules 不存在: $kernel" }
New-Item -ItemType Directory -Force -Path (Join-Path $dest '@deepseek-ai'), (Join-Path $dest '@standard-schema') | Out-Null
foreach ($p in $pkgs) {
  $src = Join-Path $kernel $p
  $dst = Join-Path $dest $p
  if (-not (Test-Path $src)) { Write-Warning "内核缺少 $p，跳过"; continue }
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Copy-Item -Recurse -Force $src $dst
  Write-Host "copied $p"
}
Write-Host "done -> $dest"
