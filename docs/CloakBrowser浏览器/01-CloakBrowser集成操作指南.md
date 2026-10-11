# CloakBrowser 集成操作指南（路线 2：cloakserve + CDP）

参考 `E:\BoBo-Handyman` 集成 camoufox 的方法（长驻服务 + 瘦客户端 + 生命周期管理），在 SmartBoBo 中集成 CloakBrowser 隐身浏览器。服务形态选定**路线 2：官方 cloakserve 长驻服务 + 标准 CDP 连接**。本文记录完整实施过程、验证结果与运维方法。

- 实施日期：2026-10-10
- 当前状态：已集成并通过三级验证（独立 E2E / 生命周期 E2E / 内核加载）
- 生效方式：重启 DSH（`启动.cmd`）后，agent 原生获得 `cloak_fetch` 工具

---

## 1. 为什么是这条路线

三个关键事实决定了技术选型：

1. **BoBo-Handyman 的"长驻服务 + 瘦客户端"重架构，根因是 Firefox 内核（camoufox）没有 CDP**，无法 `connect_over_cdp`，只能自造一行 JSON 的 TCP 协议（见其文档 `28-采集引擎统一到Camoufox浏览器操作指南.md` §5）。
2. **CloakBrowser 是 Chromium 内核，原生支持 CDP**，且官方自带 `cloakserve` 多路复用服务（单端口、按指纹 seed 路由、per-seed 独立进程），所以不需要自造协议，直接用标准 CDP。
3. **SmartBoBo 是纯 TS/Rust 栈**（pnpm monorepo + Tauri，无 Python 依赖体系），但本机有 Python 3.13。经调研，`cloakserve` 只存在于官方仓库 `bin/cloakserve`（npm/PyPI 包里都没有），是 Python 脚本，因此采用 **uv 管理的项目级 `.venv` 隔离环境**（与参考项目同一套 pyproject.toml + uv.lock 方式），不污染系统 Python。

与参考项目的对照：

| 层 | BoBo（camoufox） | SmartBoBo（cloakbrowser） |
|---|---|---|
| 依赖 | 根 pyproject + uv 锁 camoufox==0.5.5 | 根 pyproject + uv 锁 `cloakbrowser[serve]==0.6.0` |
| 二进制预铺 | `python -m camoufox fetch` | `cloak/ensure.ps1` → `uv sync` + `python -m cloakbrowser install` |
| 服务 | 自写 `browser_server.py`（TCP 一行 JSON） | 官方 `bin/cloakserve`（HTTP + CDP，标准协议） |
| 端口复用 | crc32(root) 派生 + probe 附着 | 固定 9333（可配）+ `GET /` 探测附着 |
| 消费端 | TS 插件 spawn python + 瘦客户端 | profile 级插件 `dsh-cloakbrowser`，`playwright-core.connectOverCDP` |
| 关进程 | taskkill /T 杀树 | 同样 taskkill /T + spawn 前清孤儿 + detach 防连带死亡 |

---

## 2. 架构与目录

```
agent 调用 cloak_fetch(url, format, selector, ...)
  │
  ▼
dsh-cloakbrowser 插件（.dsh profile 加载，E:\SmartBoBo\cloak\plugin\）
  ├─ service.js   生命周期：GET / 探测 → 未起则 spawn cloakserve → 预热 /json/version → CDP 就绪
  ├─ tools/cloak-fetch.js   connectOverCDP → newPage → goto → 抽取 → 断开
  └─ index.js     apply(): 注册工具 + ctx.effect 注册退出清理
  │ spawn / attach
  ▼
cloakserve（Python 长驻，监听 127.0.0.1:9333）
  │ 按需拉起
  ▼
隐身 Chromium（free 版 146.0.7680.177.5，87 个 C++ 源级指纹补丁）
```

集成目录（全部新文件，不碰 dsh 源码仓、不碰启动脚本、不碰 Rust）：

```
E:\SmartBoBo\cloak\
├── bin\cloakserve          官方仓库 vendored 脚本（CDP 多路复用器，914 行）
├── ensure.ps1              首次预铺：uv sync（根 .venv 依赖）+ 浏览器二进制
├── plugin\                 dsh 插件（profile 以 link: 挂载）
│   ├── package.json        name=dsh-cloakbrowser，deps: playwright-core ^1.63（实际 1.64.0）
│   ├── index.js            name / inject / apply 导出
│   ├── service.js          服务生命周期（探测/spawn/预热/杀树/孤儿清理/日志）
│   ├── tools\cloak-fetch.js   cloak_fetch 工具
│   ├── test.mjs            回归测试（独立可跑）
│   └── node_modules\       npm install 产物
├── data\                   Chrome 持久化 profile（Cookie 跨重启延续，__default__ 为默认身份）
└── cloakserve.log          服务日志（append）
```

Python 环境由 uv 管理在项目根（与 BoBo-Handyman 同构）：

```
E:\SmartBoBo\
├── pyproject.toml          依赖声明：cloakbrowser[serve]==0.6.0（virtual project）
├── .python-version         解释器固定 3.13
├── uv.lock                 依赖锁定（uv sync 读取，应入库）
└── .venv\                  Python 3.13 隔离环境（uv sync 生成；service.js 指向此处）
```

profile 挂载（两处修改，已生效）：

```jsonc
// E:\SmartBoBo\.dsh\profiles\web\package.json  dependencies 新增
"dsh-cloakbrowser": "link:../../../cloak/plugin",
```

```yaml
# E:\SmartBoBo\.dsh\profiles\web\cordis.patch.yml 新增
- insert:
    - id: dsh-cloakbrowser
      name: dsh-cloakbrowser
      config:
        port: 9333
        readyTimeoutMs: 120000
```

---

## 3. 首次部署（新机器三步）

```powershell
# ① 预铺运行时（uv sync 同步根 .venv 依赖 + 隐身浏览器二进制约 200MB，幂等可重跑）
powershell -ExecutionPolicy Bypass -File E:\SmartBoBo\cloak\ensure.ps1

# ② profile 安装 link 依赖（若 package.json 已有则跳过）
cd E:\SmartBoBo\.dsh\profiles\web
pnpm install

# ③ 回归测试（独立于 dsh 验证全链路）
node E:\SmartBoBo\cloak\plugin\test.mjs
```

然后重启 DSH（`启动.cmd`），启动日志首行应出现：

```
[dsh-cloakbrowser] cloak_fetch registered, endpoint http://127.0.0.1:9333, data E:\SmartBoBo\cloak\data
```

---

## 4. 工具说明：cloak_fetch

agent 原生工具（不是 MCP、不是 skill），schema 自动进 system prompt。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 绝对 http(s) 地址 |
| `format` | `html` \| `text` | 否 | 默认 `html`；`text` 返回可见 innerText |
| `selector` | string | 否 | CSS 选择器，只抽匹配元素；匹配为空报错 |
| `waitUntil` | `domcontentloaded` \| `load` \| `networkidle` | 否 | 默认 `domcontentloaded` |
| `timeoutMs` | number | 否 | 导航超时，默认 30000 |

返回：`{ ok, url, finalUrl, title, status, format, bytes, truncated, content, error }`，content 超过 128000 字符截断并置 `truncated`。render 给模型看的是"元信息头 + 正文"。

设计要点：

- **惰性启动**：首次调用才 spawn cloakserve；已有人起过则直接附着（探测 `GET /` 返回 `{"status":"ok"}`）。
- **退出清理**：`ctx.effect` 注册 dispose，仅杀"本插件启动的"服务，附着来的不动；杀进程树用 `taskkill /T /F`（Windows），保证 Chrome 不残留占 profile 锁。
- **孤儿自愈**：spawn 前先按 `--user-data-dir` 匹配清掉上一次异常死亡残留的 Chrome。
- **预热**：服务探测通过后先 GET `/json/version` 直到 200（触发 Chrome 启动并等它 CDP 就绪），避免冷启动期 playwright 连接撞 502。
- **断连不杀浏览器**：`connectOverCDP` 模式下 `browser.close()` 只是断开客户端，Chrome 由 cloakserve 继续持有，Cookie/会话延续。

---

## 5. 验证方法

```powershell
# ① 独立回归（spawn → 4 种抓取 → 隐身检查 → dispose 杀树，全绿输出 E2E OK）
node E:\SmartBoBo\cloak\plugin\test.mjs

# ② 配置树确认
$env:DSH_HOME="E:\SmartBoBo\.dsh"
node "$env:APPDATA\dsh-tauri\dependencies\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config | Select-String -Pattern "dsh-cloakbrowser" -Context 0,4

# ③ 内核加载确认
启动.cmd → 日志首行出现 [dsh-cloakbrowser] cloak_fetch registered
```

实测结果（2026-10-10）：

- 抓取 example.com：html 2373B / text 1301B / selector 抽取 / 不存在选择器正确报错
- 隐身指标：`navigator.webdriver=false`、`plugins=5`、UA Chrome/146.0.0.0
- 生命周期：服务未起 → 自动 spawn → dispose 后端口关闭、cloak 相关 chrome 进程数归零
- 内核加载：`--dump-config` 进树 + 启动日志确认

---

## 6. 配置与运维

**插件配置**（`cordis.patch.yml` 的 `config` 段）：

| 键 | 默认 | 说明 |
|---|---|---|
| `port` | 9333 | cloakserve 监听端口（仅绑定 127.0.0.1，勿对外暴露，CDP 可完全控制浏览器） |
| `dataDir` | `cloak\data` | Chrome profile 目录 |
| `readyTimeoutMs` | 120000 | 首次启动 + 二进制下载的就绪超时 |
| `root` | 插件上级目录 | cloak 运行时根（一般不用改） |

**License**：当前 free 版（无需 key，单并发会话）。要最新二进制（Chromium 154）或多并发：

```powershell
E:\SmartBoBo\cloak\venv\Scripts\python.exe -m cloakbrowser login   # GitHub 免费领 key
# 或设置环境变量 CLOAKBROWSER_LICENSE_KEY=cb_xxx
```

**手动运维**：

```powershell
# 手动起服务（调试用；正常由插件管）
E:\SmartBoBo\cloak\venv\Scripts\python.exe E:\SmartBoBo\cloak\bin\cloakserve --port=9333 --data-dir=E:\SmartBoBo\cloak\data

# 查看状态（返回 JSON：进程、PID、连接数）
curl http://127.0.0.1:9333/

# 手动停（插件 dispose 用的是同一手段）
taskkill /F /T /PID <cloakserve的PID>

# 诊断
E:\SmartBoBo\cloak\venv\Scripts\python.exe -m cloakbrowser info --quick
Get-Content E:\SmartBoBo\cloak\cloakserve.log -Tail 50
```

**升级**：

```powershell
# pip 层（wrapper + playwright + 依赖）
E:\SmartBoBo\cloak\venv\Scripts\python.exe -m pip install -U "cloakbrowser[serve]==0.6.0"
# 浏览器二进制（反爬规则周更，建议定期跑）
E:\SmartBoBo\cloak\venv\Scripts\python.exe -m cloakbrowser update
# cloakserve 脚本：重新 clone 官方仓库，覆盖 bin\cloakserve 后重启 DSH
git clone --depth 1 https://github.com/CloakHQ/CloakBrowser.git
```

**卸载**：profile `cordis.patch.yml` 删 insert 条目、`package.json` 删依赖行 + `pnpm install`，再删 `E:\SmartBoBo\cloak\`。

---

## 7. 踩坑记录（复现过的真实问题）

1. **playwright-core 1.64 方法名是 `connectOverCDP`**（全大写），不是文档常见的 `connectOverCdp`。代码已做双写兼容，升级后如再报 "not a function" 先查这个。
2. **cloakserve 的 `GET /` 返回 `processes` 是对象 `{}` 不是数组**，探测逻辑用 `Array.isArray` 会永远 false，导致一直等到超时。
3. **Windows 杀服务必须等进程树死透**：taskkill 是异步的，dispose 后立即探测端口会误判"没杀掉"。现已 await 子进程 exit（5s 上限）。
4. **Chrome 孤儿占 profile 锁 → 新实例 502**：上一次服务异常死亡（如宿主被杀）会留下 `--user-data-dir=cloak\data\__default__` 的孤儿 Chrome，新 cloakserve 的 Chrome 起不来，`/json/version` 返回 502。现已在 spawn 前按 dataDir 匹配强杀残留。
5. **stdio 管道会让服务跟着宿主一起死**（EPIPE）：Python 日志写进已关闭的管道直接崩，Chrome 变孤儿。现已改为 `detached + 日志落盘 cloakserve.log`，服务是真长驻，宿主崩了下次探测照样附着。
6. **`/json/version` 会触发 Chrome 按需启动**（有副作用），不能当轻量健康探测；轻探测用 `GET /`，重的预热才用它。
7. **example.com 当前页面没有 h1**（只有 title + p），测选择器别拿 h1 当样例。
8. **npm 与 pip 共享同一份二进制缓存** `C:\Users\<user>\.cloakbrowser\`，先跑过 PoC 的话 ensure.ps1 秒过。

---

## 8. 已知限制

- **free 版单并发会话**，二进制锁 Chromium 146（Pro 才有 154 和最新反爬补丁）；`latest_version` 查询需要 key。
- **headless 局限**：cloakserve 默认 headless=true，部分站点仍可测出 headless；高难目标需 `cloakserve --headless=false`（有头）+ 住宅代理 + `humanize`（humanize 是 wrapper 层功能，经 CDP 连接时需另行注入，当前未集成）。
- **代理是服务级的**：`cloakserve --proxy-server=...` 启动时定死，运行中改代理需重启服务（与 BoBo 结论一致）。
- **fetch 输出格式只有 html/text**，没有 BoBo 的 md/skeleton 派生；需要时再扩展 `cloak-fetch.js`。
- **多指纹身份（`?fingerprint=seed`）能力已在 cloakserve 里**，插件当前固定用默认身份，按需可把 seed 暴露成工具参数。
- 插件改动期间不要跑 dsh 构建（遵循 `dsh/AGENTS.md` 插件开发保护条款；本集成不涉及 dsh 源码，无需构建）。

---

## 9. 关键文件索引

| 用途 | 路径 |
|---|---|
| 插件入口 | `E:\SmartBoBo\cloak\plugin\index.js` |
| 服务生命周期 | `E:\SmartBoBo\cloak\plugin\service.js` |
| 工具实现 | `E:\SmartBoBo\cloak\plugin\tools\cloak-fetch.js` |
| 回归测试 | `E:\SmartBoBo\cloak\plugin\test.mjs` |
| 预铺脚本 | `E:\SmartBoBo\cloak\ensure.ps1` |
| 依赖声明 / 锁定 | `E:\SmartBoBo\pyproject.toml` + `E:\SmartBoBo\uv.lock`（uv 管理） |
| CDP 服务 | `E:\SmartBoBo\cloak\bin\cloakserve`（来源 github.com/CloakHQ/CloakBrowser `bin/cloakserve`） |
| profile 挂载 | `E:\SmartBoBo\.dsh\profiles\web\{package.json, cordis.patch.yml}` |
| 服务日志 | `E:\SmartBoBo\cloak\cloakserve.log` |
