# SmartBoBo 前端品牌替换操作指南

> 参考项目：`E:\BoBo-Handyman`（品牌源：`dsh/packages/bobo/ui-brand-bobo`、`docs/说明文档/前端修改/02-前端品牌替换说明.md`）
> 目标：把 SmartBoBo 桌面端的界面品牌统一为「SmartBoBo + AGENT 徽章 + 菠萝图标 + 万物皆可得标语」。

## 一、架构背景（为什么不能照抄参考项目）

两个项目的内核承载方式不同，直接照搬会全部失效：

| | 参考项目 BoBo-Handyman | SmartBoBo |
|---|---|---|
| `dsh/` 的身份 | 完整的 deepseek-harness monorepo（自建内核） | Tauri 桌面壳（dsh-tauri 仓库） |
| 内核源码 | 自己维护，可直接改上游文件 | `dsh/source/deepseek-harness/` 是**只读对照基线**（git submodule，禁止择优采纳） |
| 运行时内核 | 从源码构建 | 从 GitHub Release 下载的打包发行版（`%APPDATA%\dsh-tauri\dependencies\dsh\`） |
| 品牌注入方式 | 改上游源码 + 上游白名单 | 三条通道：**dsh-tauri 插件槽位**、**Rust 幂等补丁**、**壳层自有资产** |

因此 SmartBoBo 的品牌替换分三层实施：

1. **dsh-tauri-brand 插件**（`packages/dsh-tauri-brand/`）：通过内核公开的槽位 API 接管侧栏与会话 Hero 的品牌位，不改内核源码。
2. **Rust 品牌补丁**（`src-tauri/src/service/patch/brand.rs`）：启动时对打包内核的 JS 产物做幂等文本替换（标语、boot 字标、favicon、标题、manifest）。
3. **壳层资产**：标题栏、favicon、图标源、i18n、关于页、桌宠窗口、productName 等桌面壳自有文件。

## 二、改动清单

### 2.1 新插件包 `packages/dsh-tauri-brand/`

```
packages/dsh-tauri-brand/
├── package.json              # dsh.client 注入声明 + bundle patch
├── cordis.patch.yml          # insert 本插件
├── tsdown.config.ts
└── src/
    ├── index.ts              # 宿主半区（无操作）
    ├── shared/constants.ts   # PLUGIN_ID = 'dsh-tauri-brand'
    └── client/
        ├── index.ts          # 装配：locale.registerLocale + brandFeature
        ├── locales/index.ts  # defineLocale：wordmarkName=SmartBoBo / wordmarkBadge=AGENT
        ├── components/
        │   ├── pineapple-mark.tsx   # 菠萝线稿 SVG（30×34，currentColor）
        │   ├── brand-mark.tsx       # 侧栏 mark 槽occupant
        │   ├── hero-brand-mark.tsx  # 会话 Hero mark 槽occupant
        │   └── brand-name.tsx       # 侧栏 name 槽：SmartBoBo + AGENT 徽章字标
        └── register/brand.ts        # defineRegister：三槽位注入，priority=-1 顶掉官方
```

要点：

- 槽位：`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`（rc.2 内核均公开声明）。
- `priority: -1`：官方品牌包默认 0，槽位按「最低者渲染」排序，-1 稳定胜出；官方注册仍在场，可随时回退。
- 侧栏 mark+name 用嵌套 `slots.inject` 原子注册，避免半品牌侧栏。
- 所有图元 `stroke="currentColor"`，自动适配深浅色。

### 2.2 插件注册

| 文件 | 改动 |
|---|---|
| `packages/dsh-tauri-bundle/package.json` | dependencies 增加 `"dsh-tauri-brand": "workspace:*"` |
| `src-tauri/resources/manifest.jsonc` | `plugins.built-in` 增加 dsh-tauri-brand 条目 |

### 2.3 Rust 品牌补丁 `src-tauri/src/service/patch/brand.rs`

启动链（`workflow/launch.rs`）在 composer 补丁后执行，全部幂等、锚点缺失只告警：

| 目标（相对打包内核根） | 替换 |
|---|---|
| `…/dsh-client-ui-conversation/lib/client.js` | `"hero.headline": "探索未至之境"` → `"万物皆可得"`；`"Into the Unknown"` → `"Everything is obtainable"`；同时移除 Hero 标语后的「预览版/Preview」徽章（压缩产物里的 `previewBadge` 渲染节点整段删掉） |
| `…/dsh-web-frontend/dist/assets/index-*.js`（目录扫描，文件名带哈希） | boot 字标 `wordmark,"HARNESS")` → `wordmark,"AGENT")` |
| `…/dsh-web-frontend/dist/favicon.svg` / `favicon-dark.svg` | 鲸鱼整文件换菠萝（标记 `<!-- smartbobo-pineapple -->` 幂等） |
| `…/dsh-web-frontend/dist/index.html` | `<title>DeepSeek Harness</title>` → `<title>SmartBoBo</title>` |
| `…/dsh-web-frontend/dist/manifest.webmanifest` | name → SmartBoBo，short_name → BoBo |

配套修改：

- `src-tauri/src/service/patch/mod.rs`：注册 `brand` 模块，`apply_all_at` 数组 11→12。
- `src-tauri/src/service/workflow/launch.rs`：补丁链插入 `brand::apply`。
- `src-tauri/src/utils/mod.rs`：`active_core_install_dir` 改为 `pub(crate)`（brand 的目录扫描需要）。
- `src-tauri/src/desktop/plugin_boot.js.inc`：splash 识别从硬编码 `HARNESS` 改为接受 `['HARNESS','AGENT']` 双字标——补丁失败时宿主探测不坏。

#### 预览徽章移除的锚点设计（后续维护必读）

「预览版」徽章在压缩产物里不是独立语句，而是 hero 标题 `children` 数组的第二个元素：

```js
children: [(…jsx)("span", { children: t("hero.headline") }), (…jsx)("span", {
    className: …previewBadge,
    children: t("hero.preview")
})]
```

补丁把整个数组替换成单个 span（即只留标题），涉及三个常量（`brand.rs` 与 `apply-brand-patch.mjs` 同名同值）：

| 常量 | 角色 |
|---|---|
| `PREVIEW_BADGE_ORIGINAL` | 完整数组原文（含制表符缩进），替换锚点 |
| `PREVIEW_BADGE_PATCHED` | 只留标题 span 的新文 |
| `PREVIEW_BADGE_RENDER` | `children: t("hero.preview")`，**幂等判据**：它缺席才算已打过 |

注意两点：

- 字典条目 `"hero.preview": "预览版"/"Preview"` **故意保留**——它们是死条目，删它们要多一个锚点，收益为零。
- `patch_headline_source` 现在同时负责标语替换与徽章移除（同文件一次读写）；「已打过」的判定是「标语已是新文 **且** 徽章渲染已缺席」，任一不满足就继续尝试替换、锚点全丢才报 AnchorMissing。
- 单测：`removes_preview_badge_and_is_idempotent`（`brand.rs` tests 模块）。

### 2.4 壳层全局身份

| 文件 | 改动 |
|---|---|
| `index.html` | `<title>SmartBoBo</title>` |
| `pet.html` | `<title>SmartBoBo Pet</title>` |
| `src-tauri/src/desktop/pet.rs` | 桌宠窗口 `.title("SmartBoBo Pet")` |
| `public/favicon.svg` | 换参考项目菠萝 favicon（带深色媒体查询） |
| `src/i18n/locales/zh-CN.json` / `en-US.json` | `app.wordmark`: HARNESS→AGENT；`app.open_editor`、`status.updating` → SmartBoBo |
| `src/ui/dialog/about.tsx` | poweredBy 兜底 `DeepSeek Harness Desktop` → `SmartBoBo` |

**保持不动的文案**（描述内核服务而非产品品牌）：`errors.*`、`status.loading_process`、`menu.harness_feedback`、`about.powered_by`（内核归属声明）、`ui.dsh_version`。

### 2.5 productName 改名与安装器

| 文件 | 改动 |
|---|---|
| `src-tauri/tauri.conf.json` | productName `DSH Tauri` → `SmartBoBo`；copyright、shortDescription、longDescription 同步 |
| `src-tauri/tauri.nightly.conf.json` | productName → `SmartBoBo Nightly` |
| `src-tauri/windows/fragments/autostart-cleanup.wxs` | 注册表标记键 → `Software\dsh-tauri\SmartBoBo`；登录启动清理覆盖三代产品名：保留 `Deepseek Harness Desktop`（卸载时清）、新增 `DSH Tauri`（**升级时也清**——exe 已改名 SmartBoBo.exe，旧 Run 项必然失效）、新增 `SmartBoBo`（卸载时清） |
| `src-tauri/windows/fragments/autostart-cleanup-nightly.wxs` | 标记键 → `…\SmartBoBo Nightly`；清理 `DSH Tauri Nightly` + `SmartBoBo Nightly` |

**保持不动**：`identifier`（dsh-tauri / dsh-tauri-nightly，数据目录与升级连续性）、`mainBinaryName`（nightly exe 名）、deep-link schemes、WiX upgradeCode、`installer.nsi` 的 `REGISTRYPRODUCTNAME`（读旧装机位置用的历史名）、deb conflicts（历史包名）。

配套测试：

- `test/notification-icon.test.ts`：productName 断言 → SmartBoBo / SmartBoBo Nightly。
- `test/msi-upgrade-path.test.ts`：nightly 标记键断言更新；stable/nightly 增加新清理动作的断言。
- `test/e2e/support/desktop.ts`：`APP_TITLE` → `SmartBoBo`。

### 2.6 图标源

| 文件 | 内容 |
|---|---|
| `public/deepseek-harness-desktop-tauri.svg` | 白底圆角 + 黑菠萝线稿（64×64） |
| `public/deepseek-harness-desktop-tauri-nightly.svg` | 黑底 + 白菠萝 |
| `public/deepseek-harness-desktop-tauri-square.svg` | 直角白底 + 黑菠萝 |
| `assets/macos.svg` | macOS 1024 模板（菠萝） |
| `assets/macos-tray.svg` | 托盘模板（纯黑菠萝，加粗描边） |

## 三、`启动.cmd`（7075 浏览器模式）的品牌链路

`启动.cmd` / `启动.sh` 不经过桌面壳，因此桌面端的 Rust 补丁与内置插件自愈都不会执行——首次实测双击启动后界面仍是官方品牌，根因即在于此。为此品牌链路补了两环：

1. **`scripts/apply-brand-patch.mjs`**：Node 版内核品牌补丁（与 `brand.rs` 同源逻辑，幂等）。启动器在拉起内核前调用它；失败只告警不阻断。
2. **profile 接入**：`dsh-tauri-brand` 已注册进 `E:\SmartBoBo\.dsh\profiles\web`——
   - `package.json` dependencies 增加 `"dsh-tauri-brand": "link:E:/SmartBoBo/dsh/packages/dsh-tauri-brand"`，
   - `dsh.profile.bundles` 增加 `dsh-tauri-brand`（插在 `dsh-tauri-ui` 之后），
   - `node_modules/dsh-tauri-brand` junction 指向仓库内插件目录（Windows 下用 `New-Item -ItemType Junction`，cmd `mklink /J` 对部分路径形态会报卷标语法错误）。

内核更新（桌面端重新下载）后无需手动处理：下一次 `启动.cmd` 会自动重打补丁；profile 接线是持久的。若删除 `.dsh` 目录则需按上面三步重接。

排障对照（首次实测记录）：

| 现象 | 原因 | 处置 |
|---|---|---|
| 7075 页面标题/ favicon / 标语全是官方原版 | 打包内核文件从未被打过补丁（桌面壳没启动过新版） | 手动执行一次 `node scripts\apply-brand-patch.mjs`，或重启 `启动.cmd`（现在每次都会自动打） |
| 内核文件已是品牌版，但侧栏/Hero 仍无菠萝 | `dsh-tauri-brand` 未接入 web profile | 按上面第 2 步接线，然后重启 `启动.cmd` |
| 文件与 profile 都就绪，浏览器仍显示旧页面 | 静态资源被浏览器缓存 | Ctrl+Shift+R 强刷 |

## 四、验证步骤

```powershell
cd E:\SmartBoBo\dsh

# 0. 若 npm 官方源超时，先切镜像（本次实施时 @tauri-apps/cli 等大包在官源反复超时）
#    pnpm install --registry https://registry.npmmirror.com

# 1. 链接新 workspace 包
pnpm install

# 2. TS 类型检查（含新插件 src）
pnpm typecheck

# 3. Rust 补丁单测 + 编译检查
cd src-tauri
cargo test --lib service::patch::brand
cargo test --lib desktop::plugin_boot
cargo check

# 4. 受影响的前端单测
cd ..
node node_modules/vitest/vitest.mjs run --project unit test/notification-icon.test.ts
node node_modules/vitest/vitest.mjs run --project unit test/msi-upgrade-path.test.ts
node node_modules/vitest/vitest.mjs run --project unit test/plugin-boot.test.ts
node node_modules/vitest/vitest.mjs run --project unit src/ui/dialog/about.test.tsx

# 5. 构建插件产物（本次已执行：publint 无问题，dist/client.cjs 已带 ModuleLoader 封装）
pnpm --filter dsh-tauri-brand build
# 或全量：pnpm build:plugins

# 6. 重新生成平台图标（本次已执行：stable/nightly/macOS 托盘图标均已重生成）
pnpm icons
```

> 本次实施已完成 1–4、5、6 的验证：`pnpm typecheck` 零错误；26 个受影响单测
> （notification-icon / msi-upgrade-path / plugin-boot / about）全过；brand 补丁
> 纯逻辑 8 个断言全过；插件构建 + publint 通过；`pnpm icons` 重建成功。
> `cargo test` 因本机 GNU 工具链 dlltool 沙箱限制未能全量编译（既有
> `target/debug` 产物证明正常终端可编译），建议在正常终端补跑一次
> `cargo test --lib service::patch::brand` 与 `cargo check`。

运行时验证（重启桌面端后）：

1. 侧栏顶部：菠萝 + `SmartBoBo` + `AGENT` 徽章（深浅色各看一次）。
2. 新建空白会话 Hero：菠萝 + 「万物皆可得」/「Everything is obtainable」，且标语后**无**「预览版/Preview」徽章。
3. 启动闪屏：boot 页字标应为 AGENT（补丁生效时）。
4. 浏览器/WebView 标签：标题 SmartBoBo，favicon 菠萝。
5. 关于对话框：名称 SmartBoBo + 菠萝 logo。
6. 桌宠窗口标题：SmartBoBo Pet。
7. `启动.cmd` 模式（7075）：重复上面 2/3/4 项检查；侧栏/Hero 菠萝需 profile 接线生效。

## 五、已知限制与回退

| 项 | 说明 |
|---|---|
| `brand.localBuild`（「DSH 本地构建」） | 内核 locale 包字符串，槽位被品牌插件占据后不再渲染；插件加载失败时作为降级文案出现，属可接受的技术性回退。 |
| `hero.preview` 死条目 | 预览徽章渲染已删，但字典条目 `"hero.preview": "预览版"/"Preview"` 保留在内核 locale 里——无引用的死数据，不值得为它多打一个锚点。 |
| 插件构建产物 | 本仓库约定插件 dev 热重载期间不执行构建；新插件需跑一次 `pnpm --filter dsh-tauri-brand build` 才会出现在 `dist/` 并被 `build:plugins` 打包。 |
| 升级断点 | 从「DSH Tauri」旧版升级后，登录启动项由 wxs 的 `RemovePrevDshAutostart*` 清理；如用户曾手动改过启动项名则残留，需手动清理。 |
| 内核更新 | 品牌补丁每次启动幂等重打；内核升级改写锚点（如压缩变量名变化）时补丁跳过并告警，界面回退官方品牌，功能不受影响。boot 探测因双字标兼容不会坏。 |
| 压缩锚点脆弱性 | 预览徽章锚点绑定 rc.2 压缩产物的精确缩进（制表符数量）；内核换版本若重排压缩格式，该锚点失配——标语替换仍生效，仅徽章可能回来。属已知可接受退化。 |
| 回退方式 | 删 `packages/dsh-tauri-brand` + bundle/manifest 两条注册；`brand.rs` 从 `mod.rs`/`launch.rs` 摘除；壳层文件按本清单逆向恢复；`.dsh/profiles\web` 三处接线逆向删除。补丁本身可直接删（幂等设计，无需反向补丁）。 |

## 六、与参考项目的差异点（有意为之）

1. **boot 字标**：参考项目直改内核源码；SmartBoBo 走 Rust 补丁 + 宿主双字标兼容（内核是下载的发行版，不能改源码）。
2. **标语**：参考项目改 `ui-conversation` 源码 locale；SmartBoBo 用 Rust 补丁替换打包 JS 里的字典字符串，效果等价。
3. **预览徽章**：参考项目保留「预览版」徽章；SmartBoBo 按需求在补丁层整段移除其渲染节点（字典死条目保留）。
4. **上游白名单**：参考项目有 `scripts/upstream-whitelist.txt` 跟踪改过的上游文件；SmartBoBo 不改内核源码，无需白名单，改用 Rust 补丁的锚点测试守护。
5. **`hero.headline` 覆盖**：内核 `locale.register` 对同命名空间重复注册会抛错，无法用插件语言包覆盖 conversation 命名空间——故标语只能走补丁，不能走插件。
