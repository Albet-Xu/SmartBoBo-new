# SmartBoBo 前端去打扰操作指南（第三轮 · 修订版）

> 前置：`01-`（图标/字标）、`02-`（文案品牌统一）。本轮目标：**关闭两处 DeepSeek API 打扰入口**——
> 1. 首启弹窗：刚打开项目（浏览器模式）时自动弹出的「填写 DeepSeek API」引导对话框；
> 2. 提供商行卡片：设置页「模型」栏目里内置的「DeepSeek ● 编辑」行卡片（见用户截图圈红处）。
>
> 只关闭**自动引导**，手动配置能力（设置 → 模型 → 添加供应商 / 编辑）与「模型」栏目本身完全保留。
>
> **修订说明**：初版曾把 web profile 的 `dsh-tauri-model` 接到仓内构建，导致整个「模型」栏目消失（原因见第二节 2.1）。已回退并改用对现网构建的定点补丁，本文件为最终方案。

## 一、机制说明

### 1.1 首启弹窗 = `DeepSeekOnboardingDialog`

- 注册位置：`dsh-tauri-model` 插件 client 侧（`settings.onboarding` 槽，id `deepseek-official`）。
- 显示条件：`automatic || explicit` 才渲染，否则立即 `complete()`。
- `automatic` = `(value ?? true) === true && !isDesktopCarrier()`：
  - **桌面载体**（存在 `dshDesktop` 全局）下恒为 false——桌面端本来就不自动弹。
  - **浏览器模式**（`启动.cmd`）下由全局 `__DSH_MODELS_ONBOARDING__.credentialOnboarding` 决定，宿主默认 `true`，故首启必弹。
- 宿主注入点：`packages/dsh-tauri-model/src/host/apply.ts` 的 `config?.credentialOnboarding ?? true`。
- **配置可覆盖**：宿主读 `Config.credentialOnboarding`，profile 的 `cordis.patch.yml` 可按插件 id 下发 config——这是关闭弹窗的无损手段，旧构建也认。

### 1.2 设置卡片 = `ModelsSection` 的 setupCard

- `needsSetup(row, anyUsable)`：未配置任何可用供应商时返回 true → 渲染默认填写卡片。
- 桌面端也会显示（无载体判断）。手动关闭只是会话内状态，刷新又回来。

## 二、为什么不能把 profile 接到仓内构建（重要教训）

`启动.cmd` 用的内核是打包版 `@deepseek-ai/dsh` 0.2.0-rc.2；web profile 里 `dsh-tauri-model` 原本 link 到**桌面端安装包自带的同版本构建**。仓内 `packages/dsh-tauri-model` 源码比它**新一个大版本**：

| 差异点 | 安装包构建（与 0.2.0-rc.2 内核配套，已迁至 vendor/dsh-resources） | 仓内源码构建 |
|---|---|---|
| 宿主服务定义 | `routes(ctx)` + `setCurrentHostInstance` | `defineWebServer`（来自新依赖 `dsh-h3`） |
| dependencies | 仅 `dsh-tauri` / `dsh-tauri-ui` | 多了 `dsh-h3`、`h3` |

把 junction 切到仓内构建后，宿主侧在旧内核上加载失败 → 插件整体不生效 → **整个「模型」栏目消失**（该 fork 与官方 `ui-settings-models` 互斥，官方入口已被关掉，于是模型页整个没了）。

**结论**：与内核配套的运行时必须用安装包构建（现已整体 vendored 至 `vendor/dsh-resources/node_modules`，不再依赖原安装目录）；仓内源码的改动（`?? false`、`needsSetup` 恒 false）作为**源码基线**保留，等将来整体升级内核时随包发布，不接到当前 profile。

## 三、最终改动清单（生效路径）

### 3.1 关闭首启弹窗 — profile 配置覆盖

`.dsh/profiles/web/cordis.patch.yml`（对旧构建立即生效）：

```yaml
- id: dsh-tauri-model
  config:
    credentialOnboarding: false
```

实机注入验证：页面全局 `__DSH_MODELS_ONBOARDING__"] = {"credentialOnboarding":false}`。

### 3.2 关闭设置卡片 — 定点补丁现网 client 产物

对 `E:\SmartBoBo\vendor\dsh-resources\node_modules\dsh-tauri-model\dist\client.cjs` 做两处定点替换（补丁前依次自动备份为 `client.cjs.bak-before-needsSetup`、`client.cjs.bak-before-hide-deepseek`；改后 `node --check` 语法自检通过）（原位于垃圾箱安装目录，已随 2026-10-12 资源迁移整体复制到 vendor/，补丁状态随之保留）：

**补丁 a — 隐藏 DeepSeek 提供商行卡片**（用户圈红的那张「DeepSeek ● 编辑」行）：

```js
// 补丁前（列表行 = 所有 configured 提供商）
ne=d.rows.filter(e=>e.configured)
// 补丁后：排除内置 DeepSeek 官方路由
ne=d.rows.filter(e=>e.configured&&e.entry.provider!==`deepseek-official`)
```

**补丁 b — needsSetup 恒 false**（防止其他未配置供应商弹默认填写卡）：

```js
// 补丁前（编译后的 needsSetup）
function Mt(e,t){return t||e.entry.provider===`deepseek-account`||e.entry.settingsPath.length>0?!1:e.credential?.configured!==!0}
// 补丁后
function Mt(e,t){return!1}
```

与 `apply-brand-patch.mjs` 对内核做幂等皮肤补丁同一思路：只改显示逻辑，不动任何功能代码。若 vendor 内产物被原始构建覆盖，重跑上述两处替换即可（全文均唯一匹配）。

### 3.3 仓内源码基线（不接入当前 profile，供未来升级）

- `packages/dsh-tauri-model/src/host/apply.ts`：`credentialOnboarding ?? false`（弹窗默认关）。
- `packages/dsh-tauri-model/src/client/models/ModelsSection.tsx`：`needsSetup` 恒 false（导出签名保留）。
- `THIRD_PARTY_NOTICES.md` 第 35 行描述同步。
- 单测 145/145 过。仓内包**不要** `pnpm --filter dsh-tauri-model build` 后接到当前 web profile——宿主 API 不兼容（见第二节）。

### 3.4 profile 接线保持原样

`.dsh/profiles/web/package.json` 的 `dsh-tauri-model` 保持指向 vendored 构建：

```
"dsh-tauri-model": "link:../../../vendor/dsh-resources/node_modules/dsh-tauri-model"
```

`node_modules/dsh-tauri-model` junction 同样指回该目录（重建：在 `.dsh/profiles/web` 下重跑 `pnpm install` 即可）。

## 四、验证记录

1. junction 解析：`profiles/web/node_modules/dsh-tauri-model` → `E:\SmartBoBo\vendor\dsh-resources\node_modules\dsh-tauri-model\`（迁移后），其 `dist/client.cjs` 含 `function Mt(e,t){return!1}`。
2. 实机启动（`node <kernel> --profile web --port 7075 --no-open`）：
   - 启动日志无 error/fail，`dsh-tauri-model` 正常加载（页面出现 5 处注册痕迹）；
   - 页面注入 `__DSH_MODELS_ONBOARDING__ = {"credentialOnboarding":false}`；
   - 200 返回完整 HTML（41KB）；
   - `client.cjs` 两处补丁均在位，`node --check` 语法自检通过。
3. 用户操作后确认：「模型」栏目保留，DeepSeek 行卡片不再显示，首启弹窗不再弹。

## 五、回退方式

1. 弹窗：删掉 `cordis.patch.yml` 中 `id: dsh-tauri-model` 的覆盖块。
2. DeepSeek 行卡片 + needsSetup：把 `E:\SmartBoBo\vendor\dsh-resources\node_modules\dsh-tauri-model\dist\` 中的 `client.cjs.bak-before-needsSetup` 覆盖回 `client.cjs`（该备份是两处补丁前的原始产物）；若只回退行卡片，用同目录的 `client.cjs.bak-before-hide-deepseek` 覆盖。
3. 重启 `启动.cmd`。

## 六、刻意不动

- `WelcomeNotice`（内测声明）：用户未要求关闭。
- 手动配置入口：设置 → 模型的「添加 / 编辑」、`ProviderEditor` 本身。
- 官方 `ui-settings-models` 的互斥关闭：该 fork 的既定设计，动了会槽位冲突。
- 插件市场（dshmarket）：与前两轮一致，排除。
