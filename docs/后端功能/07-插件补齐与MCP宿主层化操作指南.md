# 插件补齐与 MCP 宿主层化操作指南

> 迁移轮次：R3（插件补齐 + 闸门修复 + MCP 宿主层化）
> 日期：2026-10-13

## 1. 本轮三件事

1. **补迁 4 个跨模式插件**（参考项目有、本项目缺）：`at-workspace` / `context-facts` /
   `context-throttle` / `session-search-cn`
2. **修复 paper 闸门死行**：宿主层 `preset: paper` 恒不匹配（市场预设 id 是
   empirical/experiment/modeling/review）
3. **literature + cloak-debug MCP 宿主层化**：从各预设摘除分行、宿主层各挂单实例，
   并完成 camoufox-debug → cloak-debug 更名

## 2. 补迁的四个插件

四个都是纯 ESM 单文件插件，只依赖 Node 内置模块（`node:sqlite`/`node:zlib`/`node:fs` 等），
零外部包依赖，`node --check` 全过。

| 插件 | 职责 | 挂载 |
|---|---|---|
| `at-workspace.mjs` | 用户消息里 `@路径` 展开成文件正文/目录清单注入请求 | 宿主层 |
| `context-facts.mjs` | 压缩后注入「确定性事实块」：本会话改过的文件/未解决报错/采集站点/涉及的表，T1-T4 分层丢弃装进 2000 字符预算 | 宿主层 |
| `context-throttle.mjs` | 重型检索工具限流：软档挂提醒、硬档拒绝并给替代做法（session_recall/经验库检索带逃生阀） | 宿主层 |
| `session-search-cn.mjs` | 中文友好历史会话检索（`session_recall`）：trigram 索引专治 unicode61 分词搜不到中文子串；惰性建索引 | 宿主层 |

挂载行加在 `.dsh/profiles/web/cordis.patch.yml`（`session-state` 之后）。

## 3. paper 闸门死行修复

**问题**（`docs/后端功能/04` §5.4 记录的遗留）：宿主层挂着
`paper-experience-gate` 且 `config.preset: paper`，但市场预设没有 `paper` 这个 id——
闸门按 `config.preset === composedPreset` 比对，恒不匹配即恒停用。

**实际结构**：四个论文预设（empirical/experiment/modeling/review）在**预设层**
各自挂了正确的实例（`preset: empirical` 等，随市场预设装入），宿主层这行是多余死行。

**修复**：删除宿主层该行，留注释说明"闸门在预设层"防误以为漏挂。

## 4. literature + cloak-debug MCP 宿主层化

### 4.1 动机与取舍

原结构：literature 在 5 个预设各挂一行（serverName=`literature-<mode>`）、
camoufox-debug 在 reverse/workflow 各挂一行（`camoufox-debug` / `-wf`）。
问题：**非预设会话（如标准模式）用不到这些工具**；且预设装卸时容易与宿主层双挂。

宿主层化后：单实例 `literature` / `cloak-debug`，所有会话可用，进程数从 7 → 2。

### 4.2 更名（camoufox → cloak）

```
scripts/camoufox_debug_server.py → scripts/cloak_debug_server.py
  FastMCP("camoufox-debug") → FastMCP("cloak-debug")
serverName: camoufox-debug / camoufox-debug-wf → cloak-debug（单实例）
模型侧工具全名: mcp__camoufox-debug(-wf)?__* → mcp__cloak-debug__*
```

### 4.3 预设文件改写（14 个文件）

7 预设 × {agent.cordis.yml, decl.yml}：

- 删除 `mcp-literature` / `mcp-camoufox-debug` 整块（含紧邻注释）
- 提示词与闸门配置里的工具全名统一改写：
  `mcp__literature-{empirical,experiment,modeling,review,report}__` → `mcp__literature__`
  `mcp__camoufox-debug(-wf)?__` → `mcp__cloak-debug__`
- reverse / workflow 闸门的 `gatedTools/closeTools` 同步改为 `mcp__cloak-debug__*`

### 4.4 宿主层挂载行（`.dsh/profiles/web/cordis.patch.yml`）

```yaml
    - id: mcp-literature          # serverName: literature → mcp__literature__literature_*
      ...args: ['E:\SmartBoBo\scripts\literature_server.py']
      env: { LITERATURE_DATA_DIR: 'E:\SmartBoBo\literature' }
    - id: mcp-cloak-debug         # serverName: cloak-debug → mcp__cloak-debug__debug_*
      ...args: ['E:\SmartBoBo\scripts\cloak_debug_server.py']
    # reverse-memory-gate 的 gatedTools/closeTools 改为 mcp__cloak-debug__*
```

## 5. 验收记录（2026-10-13）

### 5.1 静态检查

```
node --check ×4（新插件）        → ALL SYNTAX OK
py_compile cloak_debug_server.py → OK
17 个 YAML（16 预设文件 + patch）宽容 loader 全部解析通过
grep 残留：mcp__literature-<mode> / mcp__camoufox / camoufox-debug → 0 命中
           （仅 patch 注释里保留"原名 camoufox-debug 已删"的说明性提及）
```

### 5.2 真实内核实例启动（临时端口 7099）

```
[context-facts] 已挂载：压缩/剪枝提交后注入「确定性事实块」，按 T1-T4 分层丢弃装进 2000 字符预算
[context-throttle] 已挂载：软提醒；硬档 4/8 条规则（逃生阀 3 次）
[session-search-cn] 已挂载 session_recall（中文 trigram 历史会话检索，惰性索引，预算 2000ms/次，输出上限 6000 字符）
[pdf-extract] 启动，MAX_PAGES=20 MAX_CHARS=40000 PAGE_CHAR_CAP=12000
[literature] 启动，本地库 E:\SmartBoBo\literature\library.db
dsh web: http://127.0.0.1:7099/?token=...
启动日志 0 报错、0 failed to import
```

### 5.3 cloak-debug MCP 握手

```
initialize → serverInfo: {"name":"cloak-debug","version":"1.30.0"}（协议握手成功）
```

## 6. 已知限制与遗留

1. **at-workspace 无启动日志**（纯请求拦截型插件，无 apply 打印）：随宿主层挂载，
   功能验证需要在会话里发一条含 `@文件路径` 的消息。
2. **literature 单实例的副作用**：原各模式独立实例时工具前缀区分模式；现在所有模式
   共用 `mcp__literature__*`。若未来需要按模式区分检索行为（如不同联络邮箱），
   需回到分实例方案。
3. `xujianbo-persona` / `minimal-notice` / `market-*` / `repo*` 未迁：
   persona 是品牌彩蛋（可选）、minimal-notice 只服务 minimal 模式（未迁市场预设）、
   market/repo 宿主侧已被 dsh-tauri-extension 的市场实现替代。
4. session-search-cn 的索引库在 `<DSH_HOME>/cache/session-recall.db`，首次调用才建
   （635 个会话实测约 12s，之后 mtime/size 增量）。

## 7. 关键文件速查

| 文件 | 变更 |
|---|---|
| `bobo/plugins/at-workspace.mjs` | 新增（原样搬运） |
| `bobo/plugins/context-facts.mjs` | 新增（原样搬运） |
| `bobo/plugins/context-throttle.mjs` | 新增（原样搬运） |
| `bobo/plugins/session-search-cn.mjs` | 新增（原样搬运） |
| `scripts/cloak_debug_server.py` | 更名自 camoufox_debug_server.py + 内部改名 |
| `.dsh/profiles/web/cordis.patch.yml` | +4 插件行、+2 MCP 行、-paper 闸门死行、gate 工具名改写 |
| `.dsh/.agent-presets/{7 预设}/{agent.cordis.yml,decl.yml}` | -MCP 分行、工具全名改写 |
