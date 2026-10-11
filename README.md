# SmartBoBo

基于 Deepseek Harness（dsh web）的智能工作台：启动脚本 + SmartBoBo 品牌补丁 + CloakBrowser 隐身浏览器集成。

## 仓库内容

| 路径 | 说明 |
|---|---|
| `启动.cmd` / `启动.sh` | 启动器：打品牌补丁 → 以项目内 `DSH_HOME` 启动 dsh web（7075） |
| `scripts/` | `apply-brand-patch.mjs` 等工具脚本 |
| `cloak/` | CloakBrowser 集成：官方 `cloakserve` vendored 脚本、dsh 插件（`cloak_fetch` 工具）、预铺脚本 `ensure.ps1` |
| `docs/` | 集成与界面文档 |
| `pyproject.toml` / `uv.lock` / `.python-version` | Python 运行时（uv 管理，见下） |
| `.dsh/` | 本地 DSH_HOME 运行状态（含凭据，已 gitignore） |
| `dsh/` | deepseek-harness-desktop 源码工作区（独立 git 仓库，已 gitignore） |

## 运行前提

1. 已安装 [Deepseek Harness Desktop](https://github.com/dsh-tauri/deepseek-harness-desktop)（提供打包内核），或自行设置 `DSH_KERNEL`。
2. Windows 双击 `启动.cmd`；浏览器自动打开 `http://127.0.0.1:7075`。

## CloakBrowser 运行时（uv 管理 Python 依赖）

```powershell
# 需已安装 uv：https://docs.astral.sh/uv/
powershell -ExecutionPolicy Bypass -File cloak\ensure.ps1   # uv sync + 浏览器二进制预铺
node cloak\plugin\test.mjs                                   # 回归测试（可选）
```

依赖声明在 `pyproject.toml`，锁定在 `uv.lock`，虚拟环境在项目根 `.venv/`。详见 `docs/CloakBrowser浏览器/01-CloakBrowser集成操作指南.md`。

## dsh 源码工作区（可选）

`dsh/` 是 [dsh-tauri/deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop) 的本地克隆（含 SmartBoBo 品牌改动，由 `scripts/apply-brand-patch.mjs` 幂等生成），不随本仓库分发。需要修改内核时：

```bash
git clone https://github.com/dsh-tauri/deepseek-harness-desktop.git dsh
```
