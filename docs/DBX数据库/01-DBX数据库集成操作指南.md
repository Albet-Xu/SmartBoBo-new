# 01 - DBX 数据库集成操作指南

> 2026-10-11 从参考项目 BoBo-Handyman 全量迁移完成并实测通过。
> 迁移范围：面板入口、运行时托管、内置 AI 大模型打通、MCP 自然语言查库。

## 1. 功能总览

| 功能块 | 说明 |
| --- | --- |
| 侧栏「数据库」面板 | 主区内嵌本地 DBX Web 控制台（支持 90+ 种数据库的连接、查询、管理），带探活/离线重试 |
| 运行时托管 | dsh 插件启动时自动 spawn `dbx-web.exe`（端口 4230），退出时杀进程树；不再依赖启动脚本 |
| 内置 AI 打通 | 本地 OpenAI 兼容桥 `/bobo-llm`：DBX 里「用 AI 修复 SQL」等能力走对话界面同一条大模型通道，真实 API Key 不落库 |
| 自然语言查库（MCP） | 模型通过 `mcp__dbx__*` 四个只读工具查询 DBX 已保存的数据库连接（仅 SELECT，大结果摘要落盘） |
| 连接器技能 | `db-extraction` 技能：连库/表结构/UPSERT 的单一实现来源，供提取入库脚本复用 |

## 2. 集成架构（与参考项目的差异已标注）

```
+--------------------------- SmartBoBo 前端 (dsh web :7075) --------------------------+
|  插件 dsh-dbx（cloak 式独立目录，link 进 profile）                                    |
|    ├─ client/client.js：sidebar.panellist「数据库」+ main 面板 → iframe 4230          |
|    ├─ index.js（host）：spawn dbx-web + seed + 注册 AI 桥路由                        |
|    └─ llm-bridge.mjs：/bobo-llm/{health,models,chat/completions}                    |
+-------------------------------+-----------------------------+----------------------+
                                | HTTP(iframe)                | OpenAI 兼容(Bearer 桥token)
+-------------------------------v-------------+   +-----------v----------------------+
|  DBX Web (dbx-runtime/dbx-web.exe :4230)    |   |  dsh 内核 llm 服务（凭据内核自理）   |
|  DBX_STATIC_DIR=dbx-runtime/dist            |   |  listProviders/listModels/stream   |
|  DBX_DATA_DIR=dbx-runtime/data              |   +----------------------------------+
|  DBX_DISABLE_PASSWORD=1                     |
|  data/dbx.db ← seed 写入 ai_configs         |
|  data/agents（JRE21+Kafka 驱动，离线可用）   |
+---------------------------------------------+

+---------------- 会话内 AI 取数 ----------------+
|  dsh-mcp-client (serverName=dbx, stdio)        |
|    → .venv python dbx/scripts/dbx_mcp_server.py|
|    → dbx.db 读连接 → 连用户数据库（只读 SELECT）|
|  dbx/skills/db-extraction（连接器技能）         |
+------------------------------------------------+
```

与参考项目（BoBo-Handyman）的关键差异：

1. **服务拉起方式**：参考项目由 `启动.cmd`/`desktop/main.js` 三处拉起；本项目改为 **cloak 式插件 host 内 spawn**（`ensureReady` 探活 + `dispose` 杀进程树），启动脚本零改动。
2. **AI 桥实现路线**：参考项目经 `settings.describe()` + `credentials.resolve()` 手动解析上游 key 再裸 fetch；本项目直接走内核 **`llm.stream()`**（GenerateOptions ↔ OpenAI 双向翻译），凭据由内核自理，不耦合 settings 命名空间，兼容官方内核。
3. **seed 语言**：仍是 python（标准库 only），跑在根 `.venv`；在 spawn dbx-web 前执行（防 sqlite 写锁），服务 ready 后再补种一次。
4. **插件形态**：`packages/bobo/ui-dbx`（pnpm workspace 构建产物）→ `dbx/plugin`（手写 `__ModuleLoader__` CJS 客户端包，零构建）。
5. **MCP serverName**：`dbx`（与参考项目 workflow 预设一致）。

## 3. 目录结构

```
E:\SmartBoBo\
├── dbx-runtime\                  # DBX 自包含运行时（dbx-web.exe 98M + dist 31M + data/agents 73M）
│   ├── dbx-web.exe
│   ├── dbx-web.log               # 运行日志（spawn 时追加）
│   ├── dist\                     # DBX Vue 前端构建产物
│   └── data\
│       ├── dbx.db                # 连接库（含口令/AI 配置，勿外传；首次运行自建）
│       └── agents\               # JRE 21 + Kafka 驱动（agent 型数据库离线可用）
├── dbx\
│   ├── plugin\                   # dsh 插件（dsh-dbx，零构建）
│   │   ├── package.json          # dsh.client 声明 + exports ./client
│   │   ├── index.js              # host：seed → spawn → 桥路由 → dispose
│   │   ├── service.js            # dbxRuntime：spawn/probe/killTree
│   │   ├── llm-bridge.mjs        # /bobo-llm 桥（--selftest 53 用例）
│   │   └── client\client.js      # 手写浏览器包：面板+图标+三态+重试
│   ├── scripts\
│   │   ├── dbx_ai_seed.py        # ai_configs 幂等预置 + 桥 token 生成（标准库）
│   │   ├── dbx_mcp_server.py     # FastMCP 只读 4 工具
│   │   └── result_digest.py      # 大结果落盘
│   ├── skills\db-extraction\     # 连接器技能（dbx_connector.py 单一实现来源）
│   └── tests\                    # dbx_query 摘要契约测试（10 用例）
└── .dsh\profiles\web\
    ├── package.json              # "dsh-dbx": "link:../../../dbx/plugin"
    └── cordis.patch.yml          # insert：dsh-dbx + mcp-dbx
```

## 4. 接线明细（已全部就位）

### 4.1 插件与面板

`.dsh/profiles/web/package.json`：

```json
"dsh-dbx": "link:../../../dbx/plugin"
```

`.dsh/profiles/web/cordis.patch.yml` 的 `- insert:` 段：

```yaml
    - id: dsh-dbx
      name: dsh-dbx
      config:
        port: 4230
        readyTimeoutMs: 60000
```

> 注意：内核不会自动 `pnpm install`；`node_modules/dsh-dbx` 需是指向 `dbx\plugin`
> 的链接（本机已建好）。换机或删除后重建：
> `mklink /J "E:\SmartBoBo\.dsh\profiles\web\node_modules\dsh-dbx" "E:\SmartBoBo\dbx\plugin"`
> （或在 profile 目录跑一次 `pnpm install`）。

### 4.2 MCP（自然语言查库）

同文件 insert 段追加：

```yaml
    - id: mcp-dbx
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dbx
        transport: stdio
        command: 'E:\SmartBoBo\.venv\Scripts\python.exe'
        args: ['E:\SmartBoBo\dbx\scripts\dbx_mcp_server.py']
        env:
          DBX_DATA_DIR: 'E:\SmartBoBo\dbx-runtime\data'
```

模型侧可见工具（只读）：

| 工具 | 作用 |
| --- | --- |
| `dbx_list_connections` | 列出 DBX 已保存连接（脱敏） |
| `dbx_describe_table` | 表字段定义（带缓存） |
| `dbx_table_exists` | 表是否存在 |
| `dbx_query` | 仅 SELECT；默认摘要模式（列名+真实行数+前 K 行+完整结果落盘路径），`detail="full"` 原样返回 |

Python 依赖已进根 `pyproject.toml`（`mcp>=1.2,<2`、`pymysql`、`psycopg[binary]`），`uv sync` 安装。新增数据库驱动时在 pyproject 加依赖再 `uv sync`。

### 4.3 AI 桥协议常量（三处必须一致）

| 常量 | 值 | 位置 |
| --- | --- | --- |
| 路由前缀 | `/bobo-llm` | `dbx/plugin/llm-bridge.mjs`（config.bridgePrefix） |
| 桥 token | 64 位 hex | `E:\SmartBoBo\.dsh\.bobo-llm-token`（seed 与桥谁先到谁生成，启动顺序无关） |
| DBX 端点 | `http://127.0.0.1:7075/bobo-llm` | `dbx-runtime/data/dbx.db` 的 `ai_configs` 行（seed 写入；web 端口变了要用 seed 的 `--endpoint` 重刷） |

真实 API Key 永不写入 dbx.db；dbx.db 的 `ai_configs.apiKey` 槽里只有桥 token。

## 5. 启动与使用

1. 正常启动 SmartBoBo（`启动.cmd`），无需任何额外步骤。
2. 内核加载 `dsh-dbx` 时自动：seed → 拉起 dbx-web（4230）→ 注册 `/bobo-llm`。
3. 侧栏出现「数据库」图标（排在 Plugins 附近，order 10），点击在主区打开 DBX 控制台。
4. 首次使用：在 DBX 里「新建连接」选择数据库类型填写连接信息。
5. AI：DBX 设置 → AI 里 seed 已预置「bobo-llm-bridge」为默认；「从 API 获取模型列表」应列出内核全部模型；「测试连接」走一条真实 stream 小 chat。
6. 自然语言查库：直接在对话里让模型查（如「用 dbx 看看 xx 连接里有哪些表」），模型会调 `mcp__dbx__*` 工具。

手动启动 DBX（不经过 dsh，调试用）：

```bash
cd E:/SmartBoBo/dbx-runtime
DBX_STATIC_DIR="$(pwd)/dist" DBX_DATA_DIR="$(pwd)/data" \
DBX_PORT=4230 DBX_DISABLE_PASSWORD=1 ./dbx-web.exe
```

## 6. 运维与排障

| 问题 | 处理 |
| --- | --- |
| 面板显示「DBX 服务未启动」 | 看 `dbx-runtime/dbx-web.log` 尾部；确认 4230 未被其它程序占用；点面板「重试」 |
| **4230 被参考项目 BoBo 占用** | 本项目已默认改用 4230，与参考项目（4230）不再冲突，可同时运行。若要再改端口，需同步多处：`cordis.patch.yml` 的 `config.port`、`dbx/plugin/index.js` 与 `service.js` 的默认 port、`dbx/plugin/client/client.js` 的 `DBX_WEB_URL` 与文案、`dbx/skills/db-extraction` 两处提示 URL（seed endpoint 与 DBX 端口无关不用动） |
| 桥 `/bobo-llm/models` 返回 401 | 桥 token 与 dbx.db 里存的不一致：删 `E:\SmartBoBo\.dsh\.bobo-llm-token` 后重启（seed 与桥会重新对齐），或 DBX AI 设置里重新「从 API 获取模型列表」 |
| DBX AI 报「上游连接失败」 | 对话界面本身要用得通（内核 provider 配置正确），桥才有上游可转 |
| 禁用 AI 预置 | 环境变量 `SMARTBOBO_DBX_AI_SEED=0`（或 `BOBO_DBX_AI_SEED=0`） |
| 连接配置丢失 | 连接在 `dbx-runtime/data/dbx.db`；删 `data` 目录会清空全部连接与 AI 配置 |
| 端口 7075 变更 | 用 seed 重刷端点：`E:\SmartBoBo\.venv\Scripts\python.exe E:\SmartBoBo\dbx\scripts\dbx_ai_seed.py --endpoint http://127.0.0.1:<新端口>/bobo-llm`，然后重启 |
| MCP 工具没出现 | 看启动日志有无 `ListToolsRequest`；检查 `mcp-dbx` insert 与 `.venv\Scripts\python.exe` 是否存在；`uv run python E:\SmartBoBo\dbx\scripts\dbx_mcp_server.py` 手动 stdio 冒烟 |
| 需要 DuckDB/MQ 等完整驱动 | 参考项目用 `--no-default-features` 编译的二进制不含这些；需要时从 DBX 官方源码全量编译后替换 `dbx-web.exe` |

## 7. 验收记录（2026-10-11）

- `node --check` ×4 全过；`llm-bridge.mjs --selftest` 53 用例全绿。
- seed 三连幂等通过（缺库跳过 → 建库写入 → 幂等同步）。
- 4226 端口真实拉起 dbx-web 冒烟：探活 200、正式库建成、seed 写入 ai_configs、进程树清理干净。
- pytest `dbx/tests`：10 passed（摘要契约全覆盖）。
- 端到端（真实内核 7075 启动）：`[dsh-dbx]` 加载、seed 两次同步、`/bobo-llm/health` → `{"ok":true}`、`/bobo-llm/models` 返回内核模型目录（deepseek 官方 2 模型）、无 token 401、boot graph 含 `dsh-dbx/client.js` 组合包并可下载、MCP stdio 收到 `ListToolsRequest`。

## 8. 相关文件速查

| 文件 | 用途 |
| --- | --- |
| `dbx/plugin/index.js` | 插件 host 入口（config 默认值都在这） |
| `dbx/plugin/llm-bridge.mjs` | AI 桥（`--selftest` 可独立跑） |
| `dbx/scripts/dbx_ai_seed.py` | AI 配置/桥 token 预置（幂等） |
| `dbx/scripts/dbx_mcp_server.py` | MCP 只读工具 server |
| `dbx/skills/db-extraction/SKILL.md` | 连接器技能 SOP |
| `.dsh/profiles/web/cordis.patch.yml` | 插件与 MCP 挂载 |
| 参考文档 | `E:\BoBo-Handyman\docs\说明文档\功能实现\20-DBX数据库集成操作指南.md`、`64-DBX内置AI与智能体大模型打通操作指南.md` |
