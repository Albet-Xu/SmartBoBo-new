# SmartBoBo 前端文案品牌统一操作指南（第二轮）

> 前置：`01-SmartBoBo前端品牌替换操作指南.md`（第一轮：图标/字标/标语/productName）。
> 本轮目标：把前端**文字表述**里残留的 DeepSeek / Harness / DSH 按语义替换为 SmartBoBo 体系命名，
> **不动后端功能**（CLI 命令、环境变量、包名、协议、账号后端全部保持原样）。

## 一、核心原则：按语义分流，禁止全局替换

同一个词在界面文字里有三种身份，只有第一种该改：

| 身份 | 判据 | 例子 | 处置 |
|---|---|---|---|
| **产品品牌** | 主语是我们的产品 | 「无法加载 DeepSeek Harness 界面」「发现 DSH 新版本」「由社区 & DeepSeek Harness 驱动」 | ✅ 替换 |
| **供应商/账号实体** | 登录、账号、充值、模型供应商 | 「登录 DeepSeek 账号」「已登录 DeepSeek」「当前未登录 DeepSeek Harness 账号」 | ❌ 保留——后端仍是 DeepSeek 的服务，改名即误导 |
| **技术标识** | 改了功能就坏 | `@deepseek-ai/dsh` 包名、`DSH_HOME`、`~/.dsh`、`dsh://`、CLI 命令 `dsh --help`、GitHub URL | ❌ 保留 |

**命名映射**（长串优先）：

1. `DeepSeek Harness` → `SmartBoBo Agent`
2. 残留产品义 `DeepSeek` → `SmartBoBo`（本轮内核侧无需单列——产品义几乎都以 DeepSeek Harness 全称出现）
3. `DSH`（大写产品缩写，如「发现 DSH 新版本」）→ `BoBo`
4. 裸 `Harness`（服务/进程/日志简称，如「重启 Harness」「Starting Harness…」）→ `Agent`
5. 小写 `dsh` 散文（如「档案是 dsh 中…」）→ `BoBo`；**CLI 命令字面量保留 `dsh`**

插件市场（dshmarket 及 manifest preset 段）**全部不动**——按需求排除。

## 二、改动清单

### 2.1 壳层 i18n（`src/i18n/locales/zh-CN.json` / `en-US.json`）

策展式替换（非全局 sed），双语同步。本次各改 44/45 行。代表性条目：

| key | 旧 | 新 |
|---|---|---|
| `update.available` | 发现 DSH 新版本 {{tag}} | 发现 BoBo 新版本 {{tag}} |
| `menu.harness_feedback` | DeepSeek Harness 官方反馈 | SmartBoBo Agent 官方反馈 |
| `about.powered_by` | 由社区 & DeepSeek Harness 驱动 | 由社区 & SmartBoBo Agent 驱动 |
| `ui.iframe_error` | 无法加载 DeepSeek Harness 界面。 | 无法加载 SmartBoBo Agent 界面。 |
| `status.loading_process` | Starting Harness… | Starting Agent… |
| `errors.*`（约 10 条） | Harness 在{{phase}}阶段失败… | Agent 在{{phase}}阶段失败… |
| `recovery.restart` | 重启 Harness | 重启 Agent |
| `task_manager.kind.harness` | Harness 服务 | Agent 服务 |
| `core.tooltip` | Harness Core 是驱动桌面端的 dsh 引擎… | Agent Core 是驱动桌面端的 BoBo 引擎… |
| `profiles.tooltip` | 档案是 dsh 中一组… | 档案是 BoBo 中一组… |
| `backup.*` / `network.*` / `appearance.*` 等 | 各处 Harness/DSH 服务 | Agent/BoBo |

**刻意保留**（豁免清单）：

- CLI 命令字面量：`ui.cli_link_enabled`「启用 dsh 命令」、`ui.cli_link_hint`「运行 dsh --help」、`errors.plugin_route_conflict` 里的 `dsh plugin --profile` 与包名 `dsh-web-ui-all`——命令真名就是 `dsh`，改显示会误导输入。
- 环境变量与路径：`DSH_HOME`、`~/.dsh`、`~/.dsh.dev`（`data_dir.*`、`backup.profile_scope` 等）。
- npm 包名：`@deepseek-ai/dsh`（`core.local_missing_hint`）。
- 键名（key）本身不改：`menu.harness_feedback`、`ui.dsh_version`、`task_manager.kind.harness` 等只是值变了。

### 2.2 manifest 内置插件显示名（`src-tauri/resources/manifest.jsonc`）

`plugins.built-in` 段 12 个显示名按 SmartBoBo 家族改（**preset 段是插件市场目录，一字未动**）：

| 旧显示名 | 新显示名 |
|---|---|
| DSH Tauri | SmartBoBo |
| DSH Tauri UI | SmartBoBo UI |
| DSH Tauri Mobile UI | SmartBoBo Mobile UI |
| DSH Tauri Worktree | SmartBoBo Worktree |
| DSH Tauri Extension | SmartBoBo Extension |
| DSH Tauri Scheduler | SmartBoBo Scheduler |
| DSH Tauri Archive | SmartBoBo Archive |
| DSH Tauri Pet | SmartBoBo Pet |
| DSH Tauri Rightclick Menu | SmartBoBo Rightclick Menu |
| DSH Tauri Model | SmartBoBo Model |
| DSH Tauri SSH | SmartBoBo SSH |
| DSH Tauri Notification | SmartBoBo Notification |

`id`/`spec`（包名）与 `repo` URL 不动；`dsh-tauri-brand` 本就叫「SmartBoBo Brand」无需改。

### 2.3 内核打包 JS 产品义文案（brand 补丁扩展）

新增 `KERNEL_COPY` 策展替换表（`brand.rs` 与 `scripts/apply-brand-patch.mjs` 同源），只收「主语是产品名」的 UI 串，逐文件一次读写：

| 内核包（相对 `%APPDATA%\dsh-tauri\dependencies\dsh\`） | 替换 |
|---|---|
| `…/dsh-client-ui-layout/lib/client.js` | `productTitle = "DeepSeek Harness"` → `"SmartBoBo Agent"` |
| `…/dsh-client-ui-plugin-manager/lib/client.js` | 插件警告 zh/en 两句：「可能损坏 DeepSeek Harness」→「可能损坏 SmartBoBo Agent」 |
| `…/dsh-client-ui-sidebar-documentpreview/lib/client.js` | 「请在运行 DeepSeek Harness 的主机上…」zh/en → SmartBoBo Agent |
| `…/dsh-client-ui-settings-account/lib/client.js` | `onboardingBrand`（zh+en 双 locale，需 replace-all）、「返回/Back to DeepSeek Harness」、产品能力描述两句（「不会影响…工作能力」「works in a local folder / 会以本地文件夹作为工作区」） |

**账号页刻意保留的串**（供应商语境）：「当前未登录 DeepSeek Harness 账号」「登录 DeepSeek Harness 账号获取专属 API Key」「You are not signed in to DeepSeek Harness」「Sign in to DeepSeek Harness…」「登录 DeepSeek 账号以开始使用」「已登录 DeepSeek」等——登录跳转、余额、API Key 都是 DeepSeek 的真实服务。

**其他内核串不动**：`dsh-system-prompt` 的 "powered by DeepSeek Harness"（模型可见身份行，改了影响模型自我认知）；`dsh-sdk-app`/`dsh-web-app` 的 JSDoc 描述（非 UI）。

新机制（`brand.rs`）：

- `KERNEL_COPY: &[(&str, &str, &str)]`——(相对路径, 原文, 新文) 三元组表；
- `patch_copy_pairs`：任一原文命中即产出 Patched（**逐对 replace-all**，同一文件多 locale 同串要全替换）；全缺席时新文在场判 AlreadyPatched，否则 AnchorMissing；
- `apply_kernel_copy[_at]`：按路径分组，同一文件多条替换合并一次读写；
- 幂等：重跑跳过；内核更新改写原文时告警跳过，界面回退官方文案，功能不受影响。

### 2.4 启动.cmd 路径

`scripts/apply-brand-patch.mjs` 同步加了 `KERNEL_COPY` 表与同一替换逻辑；`启动.cmd`/`启动.sh` 每次启动前自动执行，无需额外操作。

## 三、验证记录（本轮已执行）

```powershell
# i18n JSON 合法性（替换脚本内嵌 json.loads 校验，通过）
# 豁免项抽查：CLI/DSH_HOME/@deepseek-ai/dsh/dsh plugin 均完好 ✅

# 受影响单测
node node_modules/vitest/vitest.mjs run --project unit `
  test/plugin-presets.test.ts src/ui/dialog/about.test.tsx test/notification-icon.test.ts
# → 3 files / 11 tests 全过 ✅

# 内核实机补丁
node scripts\apply-brand-patch.mjs
# → layout / plugin-manager / documentpreview / settings-account 四包 patched ✅
# → onboardingBrand 双 locale 均已替换（replace-all 修正后复测）✅
# → 账号语境保留串完好 ✅

# brand.rs copy_pairs 纯逻辑（rustc 独立测试）3/3 过 ✅
# cargo test 因本机 dlltool 沙箱限制未全量编译，建议正常终端补跑：
#   cargo test --lib service::patch::brand
```

运行时验证（重启桌面端 / 重启 `启动.cmd` 后强刷）：

1. 更新弹窗：「发现 BoBo 新版本」。
2. 关于页：「由社区 & SmartBoBo Agent 驱动」。
3. 壳层插件页：内置插件显示名均为 SmartBoBo 家族；插件市场内容不变。
4. iframe 内：插件安装警告、文档预览提示、账号 onboarding 品牌行显示 SmartBoBo Agent；**登录/充值/已登录仍显示 DeepSeek**（预期行为）。
5. 错误/恢复界面：「Agent 服务」「重启 Agent」等。

## 四、已知限制与回退

| 项 | 说明 |
|---|---|
| 账号页残留 DeepSeek Harness | 有意保留（供应商语境：未登录提示、API Key 登录引导）。若未来自建账号体系再统一。 |
| system-prompt 身份行 | "powered by DeepSeek Harness" 影响模型自我认知，不动。 |
| CLI 显示 | 「启用 dsh 命令」等保留 dsh 字面量；如要彻底改名需同步改 CLI shim 二进制（独立工程）。 |
| 同一文件多 locale 同串 | `patch_copy_pairs` 必须 replace-all（首版 replacen(1) 漏改 en 侧 onboardingBrand，已修）；后续加表时同串多处务必注意。 |
| 内核更新 | 原文锚点失配 → 告警跳过、回退官方文案；`启动.cmd` 与桌面端下次启动自动重打。 |
| 回退 | i18n/manifest 按 git diff 逆向；`KERNEL_COPY` 表清空即停（补丁框架对已打文件无副作用）；实机已打文件等内核重装或桌面端重新下载后自然还原。 |

## 五、与第一轮的关系

- 第一轮（01 号指南）：图标/字标/标语/boot 字标/productName——「壳与形」。
- 第二轮（本指南）：文字表述里的品牌残留——「话语」。两轮共用 brand 补丁框架（`brand.rs` + `apply-brand-patch.mjs`）与 `启动.cmd` 自愈链路，无新增机制。
