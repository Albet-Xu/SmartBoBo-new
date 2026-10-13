# 采集/逆向浏览器栈接入 CloakBrowser 操作指南（browser_server 收口）

> 迁移轮次：R1（浏览器收口）· R1.1
> 日期：2026-10-12
> 前置文档：`docs/CloakBrowser浏览器/01-CloakBrowser集成操作指南.md`（cloakserve 本体与 cloak_fetch）

## 1. 背景与目标

参考项目（BoBo-Handyman）的采集/逆向栈建立在 camoufox 上，本项目 `.venv` **刻意未安装 camoufox**
（`docs/后端功能/04` §5.1），导致以下功能"代码在、跑不通"：

- `crawl_fetch` 工具（`run_camoufox.py` 引擎）
- `camoufox-debug` 逆向调试 MCP（`camoufox_debug_server.py`）
- `browser_handoff` 人工接管、右栏内置浏览器桥（`bridge.ts`）

**收口原则（本轮定案）：cloakserve 是唯一浏览器服务。** 任何需要打开网页的代码只准走
cloakserve（CDP `127.0.0.1:9333`），不引入第二个浏览器引擎。

## 2. 迁移思路：适配器收口，调用方零改动

参考项目的架构是"自造协议"：camoufox 没有 CDP，所以 `browser_server.py` 自己起了一个
**TCP 一行 JSON 协议**服务（render/debug_*/panel_* 一组 op），上面挂了 4 类消费者：

```
run_camoufox.py（采集）        camoufox_debug_server.py（调试 MCP）
tool-acquisition/crawl-tool.ts  bridge.ts / handoff.ts（面板+接管）
                    │ 全部走 TCP 一行 JSON
                    ▼
            browser_server.py  ←—— 本轮只改这一层的"浏览器后端"
                    │
              camoufox（自启动）  ──改为──▶  cloakserve CDP（按需拉起 + attach）
```

**改动只落在 `browser_server.py` 的启动层**，op 层（render/debug_*/panel_*）本身就是纯
Playwright API，`connect_over_cdp` 后原样可用。因此：

- `run_camoufox.py` → 改名为 `run_cloak.py`（语义对齐，协议不变）
- `crawl-tool.ts` → 只改 `CRAWL_ENGINE_SCRIPT` 常量一行
- `camoufox_debug_server.py` / `bridge.ts` / `handoff.ts` → **零改动**

### cloakserve 生命周期约定

| 角色 | 职责 |
|---|---|
| `dsh-cloakbrowser` 插件（宿主层） | cloakserve 的主生命周期（惰性 spawn / dispose 杀树） |
| `browser_server.py` | **按需兜底**：探测 9333 未运行则拉起；用 `DETACHED_PROCESS` 脱离自己的进程树，被 `taskkill /T` 关闭时**不连带关掉**共享的 cloakserve |
| `browser_server.py` 退出 | 只断 CDP 连接（`playwright.stop()`），**绝不** `browser.close()`——那会向 Chrome 发 `Browser.close` 关掉整个共享实例 |

代理语义与 cloak 插件一致：**服务级参数，只在拉起时注入**；cloakserve 已在运行时保持其
既有代理不重启（`--proxy` 仅在按需拉起时传 `--proxy-server=`）。

## 3. 改动清单

```
修改 scripts/browser_server.py        核心：启动层 camoufox → cloakserve CDP
    - 删除：AsyncCamoufox/DefaultAddons/gen_env_manifest 导入、profile 清理、
            camoufox 可执行路径解析、ff_version 推导（约 200 行）
    - 新增：_cloakserve_alive() / ensure_cloakserve() / ensure_context() 重连语义
    - 新增：parse_proxy 改为归一化 --proxy-server URL（不再是 camoufox dict）
    - 保留：全部 op（render/debug_*/panel_*）、TCP 协议、READY 行、派生端口约定
新增 scripts/run_cloak.py             采集瘦客户端（迁自参考项目 run_camoufox.py，协议不变）
修改 scripts/crawl_common.py          仅文档串：camoufox → cloakserve 措辞
修改 bobo/tool-acquisition/src/crawl-tool.ts    CRAWL_ENGINE_SCRIPT = 'run_cloak.py'
修改 bobo/tool-acquisition/src/browser-server.ts  注释（endpoint 用途说明）
修改 bobo/tool-acquisition/src/deployment.ts    注释（pythonBin 用途说明）
修改 bobo/tool-acquisition/lib/*                 重新构建产物（tsdown）
新增 tsconfig.base.json               项目根（bobo/* 的 tsconfig extends 深度修正）
修改 bobo/tool-acquisition/tsconfig.json  extends ../../../ → ../../（本项目层级浅一级）
```

## 4. 构建方法（bobo/ 包改 src 后必须重建）

```powershell
cd E:\SmartBoBo\bobo\tool-acquisition
node E:\SmartBoBo\dsh\node_modules\.pnpm\tsdown@0.17.4_@emnapi+core@_163e5014d162021836b034056e52176c\node_modules\tsdown\dist\run.mjs
```

- 本项目 `bobo/` 不在任何 pnpm workspace 内，用内核 `.pnpm` 里的 tsdown 直跑。
- `tsdown.config.ts` 的 `clean:false` 不清旧产物：重建后手动删除无引用的
  `lib/deployment-<旧hash>.js` / `lib/handoff-state-<旧hash>.js`（`grep 新hash lib/*.js` 确认）。
- `lib/types/` 是 tsc 类型树（运行时不加载），本轮未重建，不影响运行。

## 5. 验收记录（2026-10-12，全部真实进程实测）

### 5.1 browser_server 按需拉起 + render（cloakserve 冷启动场景）

```
# cloakserve 未运行时启动服务，发 render
ping:  {'ok': True, 'pong': True}
render: status=200 title=Example Domain partial=False error=None html_len=1989 (8.4s)
# 同时确认 cloakserve 已被按需拉起：
curl http://127.0.0.1:9333/json/version → {"Browser": "Chrome/146.0.7680.177", ...}
```

### 5.2 采集全链路（run_cloak.py 三格式落盘）

```
python scripts/run_cloak.py --url https://www.example.org \
  --out .temp/crawl_smoke/t1 --format html,md,skeleton --server 127.0.0.1:27999 --auto-name
→ exit=0，产物：
  example_org_Example_Domain_20261012-213311.html        2374 B
  example_org_Example_Domain_20261012-213311.md           1356 B
  example_org_Example_Domain_20261012-213311.skeleton.txt 1289 B
单行 JSON 报告含 savedTo/status=200/preview/title/outputs[]，与 crawl-tool.ts 的解析契约一致。
```

### 5.3 逆向调试链路（debug_* op）

```
debug_navigate: {'ok': True, 'status': 200, 'title': 'Example Domain', 'network_count': 2}
debug_evaluate: {'ok': True, 'result': 'Example Domain'}
panel_state:    {'ok': True, 'has_page': True, 'url': 'https://example.com/'}
debug_close:    {'ok': True, 'closed': True}
```

### 5.4 debug MCP 自启动路径（camoufox_debug_server.py → 派生端口拉起 browser_server）

```
import camoufox_debug_server; addr = _addr()   → 127.0.0.1:27033（crc32 派生端口）
_call('debug_navigate', {'url':'https://example.org'}) → ok=True status=200
_call('debug_close')                                   → ok=True
```

### 5.5 服务不可达 → 退出码 2（crawl-tool 重启重试依赖的语义）

```
python scripts/run_cloak.py --server 127.0.0.1:28888 ...
→ {"preview": "ERROR: 浏览器服务不可达(127.0.0.1:28888)", ...}  exit=2
```

### 5.6 进程树隔离 + attach 复用

```
taskkill /T 关掉 browser_server 测试实例后：
  netstat :9333 仍 LISTENING（PID 14872）→ 共享 cloakserve 未被连带杀死
重启 browser_server 后：
  ping OK；render status=200 仅 2.5s（attach 复用，无冷启动开销）
```

### 5.7 语法/残留检查

```
python -m py_compile scripts/browser_server.py → SYNTAX OK
grep 残留：AsyncCamoufox / DefaultAddons / gen_env_manifest / proxy_cfg → 0 命中
```

## 6. 已知限制与遗留

1. **`camoufox-debug` 这个 serverName 保留原名**（MCP 工具前缀 `mcp__camoufox-debug__*`）：
   逆向预设的 decl/agent.cordis.yml、reverse-memory-gate 的 `gatedTools/closeTools` 都按这个名字
   接线，改名要连动预设与闸门配置，收益纯属命名。**R3（插件补齐轮）**再统一更名评估。
2. `scripts/camoufox_debug_server.py` 文件名同上保留（预设 `args` 直接引用该路径）。
3. `scripts/gen_env_manifest.py` 的 camoufox 探测/预铺段仍在（函数内延迟 import，无 camoufox
   时不报错），但已无消费方（browser_server 不再 import 它）。**R4（启动编排轮）**裁撤。
4. `dbx/skills/db-extraction/SKILL.md` 提示词文案仍写"唯一采集引擎是 camoufox"——提示词层
   文案，不影响运行，**R3** 随文案轮更新。
5. `lib/types/` 未重建（tsc 树），IDE 里 tool-acquisition 的类型提示可能滞后；下次动该包
   类型时顺手 `tsc -b`。
6. 带认证的代理（`user:pass@`）在 Chrome 系 `--proxy-server` 下不支持内联凭据；本项目代理池
   目前均为 IP:PORT 直连，未受影响（与 cloak 插件同限制）。

## 7. 关键文件速查

| 文件 | 角色 |
|---|---|
| `scripts/browser_server.py` | 浏览器服务适配层（TCP 协议不变，后端 cloakserve CDP） |
| `scripts/run_cloak.py` | crawl_fetch 的采集瘦客户端 |
| `scripts/camoufox_debug_server.py` | 逆向调试 MCP（经 browser_server 派生端口，零改动） |
| `scripts/crawl_common.py` | 格式派生（md/skeleton）+ 协议客户端（`crawl_via_server`/`send_cmd`） |
| `bobo/tool-acquisition/src/crawl-tool.ts` | crawl_fetch 工具（引擎脚本名指向 run_cloak.py） |
| `bobo/tool-acquisition/src/browser-server.ts` | 服务生命周期（spawn/READY/taskkill 杀树，零逻辑改动） |
| `cloak/plugin/service.js` | cloakserve 主生命周期（宿主层 dsh-cloakbrowser） |

---

## 8. R1.2：右栏「内置浏览器」面板 + 桥接（2026-10-13 追加）

### 8.1 背景

`browser_handoff`（人工接管）的用户侧落点是右栏「内置浏览器」面板：agent 把卡在验证码/
登录墙的会话页推到面板前，用户在面板里手动操作。本项目此前**没有**这个面板（参考项目
`ui-browser-camoufox` 未迁入），`bridge.ts`（`POST /bobo-camoufox/cmd` 路由）也未挂载。

### 8.2 迁移方案：迁入 + 全量 cloak 化改名（不是照搬）

按"不移植 camoufox、用 CloakBrowser 替代"的要求，面板包迁入时做了**系统性重命名**：

| 参考项目 | 本项目 |
|---|---|
| `bobo/ui-browser-camoufox/` | `bobo/ui-browser-cloak/` |
| 插件 id `ui-browser-camoufox` | `ui-browser-cloak` |
| tab kind `'camoufox'`（CLOAK_KIND） | `'cloak'` |
| 路由前缀 `/bobo-camoufox/cmd`（面板 COMMAND_URL ↔ bridge BRIDGE_PREFIX 配对） | `/bobo-cloak/cmd` |
| 命名空间 `browserCamoufox` / `BrowserCamoufoxKey` | `browserCloak` / `BrowserCloakKey` |
| 组件/函数 `CamoufoxPanel` / `camoufoxDefinition` / `CamoufoxTitle` / `CAMOUFOX_KIND` / `CAMOUFOX_ID` | `CloakPanel` / `cloakDefinition` / `CloakTitle` / `CLOAK_KIND` / `CLOAK_ID` |
| 文案「BoBo内置的camoufox浏览器」 | 「BoBo内置的CloakBrowser浏览器」 |
| `effect` 标签 `ui-browser-camoufox:*` | `ui-browser-cloak:*` |

实现标识 `CLOAK_ID = 'bobo-browser-ui'`（Slot dispatch key）不含 camoufox，保持不变。

本项目没有 clientBundle 客户端构建链（`ui-settings-proxy` 同为"连 lib 预构建产物一起复制"），
因此改名同时作用于 **src 源码 + lib 预构建产物**（sed 系统性替换，`node --check` 校验语法）。
文件同步改名：`CamoufoxPanel.tsx/.module.css` → `CloakPanel.tsx/.module.css`。

### 8.3 挂载（`.dsh/profiles/web/cordis.patch.yml` 宿主层 insert）

```yaml
    - id: bobo-browser-bridge          # 宿主侧 HTTP 桥：POST /bobo-cloak/cmd
      name: '../../../bobo/tool-acquisition/lib/bridge.js'
    - id: ui-browser-cloak             # 浏览器端右栏面板（dsh.client 清单自动带出 lib/client.js）
      name: '../../../bobo/ui-browser-cloak/lib/index.js'
```

`bridge.ts` 的 `BRIDGE_PREFIX` 同步改为 `/bobo-cloak` 并重建 `lib/bridge.js`（tsdown）。

### 8.4 验收记录（2026-10-13）

```
# ① 产物语法
node --check lib/index.js / lib/client.js（ui-browser-cloak）→ 通过
bridge exports: [ 'Config', 'apply', 'inject', 'name' ]

# ② 配对面板↔桥接
lib/client.js:  const COMMAND_URL = "/bobo-cloak/cmd"
lib/bridge.js:  const BRIDGE_PREFIX = "/bobo-cloak"
kind 常量:      const CLOAK_KIND = "cloak"（src + lib 一致）

# ③ 真实内核实例（临时端口 7099，DSH_HOME=项目内 .dsh）
启动日志 0 报错、0 failed to import；
[dsh-cloakbrowser] cloak_fetch registered, endpoint http://127.0.0.1:9333
POST /bobo-cloak/cmd        → 401（路由已注册，鉴权围栏生效——浏览器面板在
                               已登录会话内 fetch 会带签名 cookie 通过）
POST /bobo-nonexistent/cmd  → 405（catch-all，证明 401 确来自 bridge 路由）
GET  /bobo-cloak/cmd        → 401（前缀路由匹配后拒方法/未鉴权，同上）
```

### 8.5 遗留

1. **面板 UI 未在浏览器里实点**（镜像画面/键鼠转发/handoff 守望）：协议层与路由层已验，
   组件层需要人工开一次右栏「内置浏览器」标签页确认。下次启动 7075 后随手点验即可。
2. `lib/tsconfig.tsbuildinfo` 里残留旧路径字符串——纯构建缓存，不影响运行。
3. 参考项目 patch 里还有一行 `- id: ui-sidebar-browser / disabled: false`（重新启用上游
   自带浏览器标签，与自建面板并存）。本项目未迁移上游自带浏览器，此行**不需要**。
