# SmartBoBo Windows 安装包打包规范

> 借鉴对象：deepseek-harness-desktop（本地克隆 `dsh/`；安装成品 `E:\垃圾箱\Deepseek Harness Desktop`；上游 <https://github.com/dsh-tauri/deepseek-harness-desktop>）
> 关联文档：`docs/前端界面/01-SmartBoBo前端品牌替换操作指南.md`（品牌补丁与 tauri.conf 对照）
> 状态：**v0.5.4 已实施**（2026-10-15）。瘦安装包 41.4MB + 云端托管依赖 + 窗口秒开 + browse 工作区选择器 + token 认证 + 托盘一键更新 + profile 迁移器 + 预设分层（内置4/选装8）+ opencode 隐私剥离 + 内置浏览器后台补装 + 数据出 C 盘，见 `03-瘦安装包与云端依赖分发操作指南.md` 与 `04-软件更新操作指南.md`。实施与问题记录见 §十一。

---

## 一、借鉴对象：dsh-desktop 打包链路

### 1.1 结论

dsh-desktop 是 **Tauri 2 项目，打包完全由 Tauri CLI 完成**，没有 electron-builder / Inno Setup。Windows 上同时产出 **NSIS 安装 exe** 和 **WiX MSI**（`bundle.targets: "all"`），发布与离线包走 GitHub Actions。

链路（一条命令到安装包）：

```
pnpm install
  └─ pnpm tauri build
       ├─ beforeBuildCommand: pnpm build
       │    ├─ build:plugins   → 内置插件 pnpm deploy 进 src-tauri/resources/node_modules/
       │    └─ tsc && vite build → dist/（前端，编译进 exe）
       ├─ cargo release        → 主程序 exe
       └─ Tauri bundler        → fork 的 templates/installer.nsi 出 NSIS 安装包
                                （targets:"all" 时另出 WiX MSI）
中间产物：src-tauri/target/release/bundle/{nsis,msi}/
CI 改名：scripts/rename-release-assets.mjs → 发 GitHub Release
```

### 1.2 关键配置位置（dsh/ 内）

| 文件 | 作用 |
|---|---|
| `src-tauri/tauri.conf.json` | bundle 全部配置：`targets`、`resources`、NSIS 模板与语言、图标、license |
| `src-tauri/templates/installer.nsi` | fork 自 tauri-bundler v2.9.4 的 NSIS 模板（约 1022 行），定制核心 |
| `src-tauri/resources/manifest.jsonc` | 依赖托管清单：`managedRoot` 支持 `$AppData/`、`$Resources/`、绝对路径 |
| `src-tauri/windows/fragments/autostart-cleanup.wxs` | WiX 自定义片段：清理旧注册表记录与快捷方式 |
| `.github/workflows/build-windows.yml` | 正式构建：`pnpm tauri build` → 上传 nsis/msi artifact |
| `.github/workflows/build-bundle-windows.yml` | 离线 `_Bundle` 包：先把 Node/pnpm/内核解进 `resources/` 再 `--bundles nsis` |
| `scripts/rename-release-assets.mjs` | 统一产物命名为 `Deepseek.Harness.Desktop_<ver>_x64-setup.exe` |

### 1.3 六项核心实践（本规范要搬走的东西）

1. **双轨分发**：常规包（小，依赖首启在线下载）+ 离线 `_Bundle` 包（运行时全内置，只出 NSIS 不出 MSI）。MSI 有 2GB cab 上限且数万文件极慢，离线包一律 `--bundles nsis`。
2. **清单驱动的依赖托管**：依赖放哪由 `manifest.jsonc` 的 `managedRoot` 决定，在线/离线切换**只改清单，不动代码**。
3. **fork 的 NSIS 模板**：中英双语（隐藏语言选择器）、跨版本升级直接覆盖安装（`$UpdateMode` + `/UPDATE`）、自定义"数据存放目录"页写 `HKCU\Environment` 并广播 `WM_SETTINGCHANGE`、卸载页可选删应用数据、`/P` `/NS` `/R` 静默参数。
4. **程序/数据分离**：程序装 `$LOCALAPPDATA\<产品名>`，数据经环境变量外置，规避 Program Files 不可写。
5. **体积取舍**：不内置 WebView2 离线安装器（省约 200MB），缺时用 `downloadBootstrapper` 拉 2MB 引导器。
6. **自研 updater**：不用 Tauri 官方 updater。前端 + Rust 桥从 GitHub Release 下载安装包，SHA-256 校验后系统打开覆盖安装；Windows **优先选 `*-x86_64-setup.exe`（NSIS）而非 MSI**（避免 MSI RestartManager 强杀进程）。

### 1.4 安装后布局（NSIS 标准形态，本项目的目标参照）

```
<安装目录>/
├── <主程序>.exe               # 前端 dist 内嵌
├── icons/                     # bundle.resources 平铺
├── resources/                 # bundle.resources 平铺（清单、内置插件……）
└── uninstall.exe              # NSIS WriteUninstaller 生成
```

对照 `E:\垃圾箱\Deepseek Harness Desktop` 即此布局。

---

## 二、选型决策

### 2.1 形态差异（为什么不能照抄）

| | dsh-desktop | SmartBoBo |
|---|---|---|
| 应用形态 | Tauri 桌面窗口 | Node 内核 web 服务（`node bin.js --profile web --port 7075`，浏览器访问） |
| Python | 无 | uv 管理的 `.venv` 附属运行时（cloakserve、MCP、脚本） |
| 前端 | vite 构建进 exe | 打包版 dsh 内核自带（从 Release 下载，非本仓构建） |
| 内核来源 | 内置 | 依赖 dsh-desktop 首启下载到 `%APPDATA%\dsh-tauri\dependencies\dsh\` |

### 2.2 路线：薄 Tauri 壳（路线 A，本规范采用）

新建一个 **Tauri 壳项目**，完整复用 dsh 的 bundle 体系（tauri.conf.json 结构、fork 的 `installer.nsi`、`manifest.jsonc` 托管机制、CI 骨架）。壳 exe 职责：

1. 首启编排：校验/准备依赖（对应现有 `启动.cmd` 的两步幂等流程）；
2. 启动本地服务（内核 + Python 附属）；
3. 打开浏览器（或内嵌 WebView2）访问 `127.0.0.1:7075`。

**备选路线 B（纯 NSIS 脚本，不引 Rust）**：抽出 `installer.nsi` 写独立 `.nsi`，轻量，但丢掉"程序更新自己"的载体，后续要 updater 还得补壳——除非明确放弃桌面化，否则不选。

> 注意：若直接拿 `dsh/` 克隆试打包，`tauri.conf.json` 的 `productName` 已被品牌补丁改为 `SmartBoBo`，但 `mainBinaryName` 未设置会回退 Cargo 包名，exe 仍是 `deepseek-harness-desktop.exe`——正式壳项目必须显式设置 `productName` + `mainBinaryName` + `identifier` + WiX `upgradeCode`。

### 2.3 分发形态：常规包 + 离线包（双轨，照搬 dsh）

| | 常规包（主推） | 离线 `_Bundle` 包 |
|---|---|---|
| 内置内容 | 应用文件 + Node + dsh 内核 + 清单 | 另含 `.venv`、uv、playwright 浏览器等全部运行时 |
| 体积量级 | 目标 ≤ 300MB | 预估 1.2GB+ |
| 依赖获取 | 首启按 manifest 在线下载 | 构建期解进 `resources/`，`managedRoot` 改 `$Resources/` |
| 适用 | 默认发布 | 无网/内网交付 |

体积最终取舍见 §10 待定项。

---

## 三、打包硬前提：路径解耦（阶段 0，不做则装机即断）

### 3.1 现存绝对路径问题清单

| 位置 | 问题 |
|---|---|
| `.dsh/profiles/web/cordis.patch.yml` | 全部 MCP 行写死 `E:\SmartBoBo\...`（python.exe、scripts、DSH_HOME、BOBO_ROOT） |
| `.dsh/.agent-presets/*/agent.cordis.yml` | 全部 `file:///E:/SmartBoBo/...` 直挂 |
| `.dsh/profiles/web/package.json` | `link:E:/SmartBoBo/...` 绝对链接 |
| `bobo/ensure-deps.ps1` | `$dest='E:\SmartBoBo\bobo\node_modules'` 写死 |
| `启动.cmd` | `set PATH=D:\Application\node.js` 写死本机 Node 路径 |
| `bobo/node_modules` | 4 个 junction 指向内核，打包拷贝会带出链接语义问题 |

### 3.2 解耦规范

1. **根定位唯一入口**：一律经 `BOBO_ROOT` 环境变量 → `find_bobo_root()`（`scripts/gen_env_manifest.py`，根标记 `dbx-runtime` / `dbx` 兼容两种布局）向上探测。禁止在配置里写死盘符路径。
2. **运行时路径唯一事实来源**：`dbx-runtime/env-manifest.json` 由 `gen_env_manifest.py` 在**安装目录**幂等刷新（本身是生成物，不进包）。技能与脚本读它，不再各自解析。
3. **相对路径约定收口**：MCP 行按 `../.venv/Scripts/python.exe` 相对 cwd 解析的前提（cwd = 内核子目录）必须在壳的启动编排里显式保证，不允许依赖调用方巧合。
4. **junction → 实体复制**：打包构建期把 `bobo/node_modules` 的 junction 物化为真实目录（dsh 的 `materializeTree` 是现成参考）。
5. **Node 定位**：优先 PATH，其次 manifest 托管的 `$Resources/node`，最后才提示用户安装——删除硬编码。

---

## 四、资源分层与安装布局

### 4.1 进包清单（随安装包分发）

| 目录/文件 | 说明 |
|---|---|
| `scripts/` | 全部运行脚本（含 `acceptance.py`、`gen_env_manifest.py` 等） |
| `bobo/` | 各子模块源 + `lib/` 产物；`node_modules` 改为构建期复制（不带 junction） |
| `cloak/bin/`、`cloak/plugin/` | cloakserve 脚本 + 插件 |
| `dbx/` | DBX 插件与技能 |
| `dbx-runtime/dbx-web.exe`、`dbx-runtime/dist/` | 约 129MB，DBX Web 控制台本体 |
| `vendor/dsh-resources/` | vendored 插件运行时产物 |
| `skills/`、`experience-pool/` | 技能与经验池资产（`readiness.json` 除外，见 4.2） |
| `pyproject.toml`、`uv.lock`、`.python-version` | Python 环境声明（离线包则换为预构建 `.venv`） |
| `启动.cmd` / `启动.sh` | 启动入口（内容需按 §3 改造） |
| `.dsh/profiles/web/` 与 `.dsh/.agent-presets/` 的**模板** | 去绝对路径后的模板，首启实例化 |

### 4.2 首启/构建时生成（不进包）

`.venv`（或 `uv sync` 拉起）、profile `node_modules`、`env-manifest.json`、`dbx-runtime/data/`（首启 `dbx_ai_seed.py` 播种）、`cloak/data/`、`bobo/node_modules`（`ensure-deps.ps1` 产物）、ms-playwright 浏览器缓存、`experience-pool/readiness.json`、`.temp/`。

### 4.3 明确不进包

`dsh/`（开发工作区，1.9G）、`cloak/venv/`（旧残留 147M，现行流程用根 `.venv`）、`dbx-runtime/data/`（用户数据 74M）、`.git`、`.pytest_cache`、`docs/`（可选，建议不进）。

### 4.4 目标安装布局

沿用参考项目 BoBo-Handyman 已验证的布局（`scripts/literature_common.py::_packaged_data_root` 已支持）：

```
<安装目录>/
└── <应用名>/
    ├── SmartBoBo.exe            # Tauri 壳主程序
    ├── resources/
    │   ├── runtime/             # 运行时束（打包布局里 dbx-runtime 改名 dbx）
    │   │   ├── dbx/  (原 dbx-runtime：dbx-web.exe + dist)
    │   │   ├── scripts/  bobo/  cloak/  dbx/  vendor/  skills/ ...
    │   │   └── (离线包) node/  venv/  ...
    │   └── manifest.jsonc       # 依赖托管清单
    ├── icons/  uninstall.exe
    └── ...

<安装目录>/
└── BoBoData/                   # 数据根：安装束上一级的同级目录
    ├── dbx/  cloak/  experience-pool/  .dsh profile 数据 ...
```

**规则**：安装目录内只读；一切可写数据进 `BoBoData`（或安装器"数据目录"页用户自选的路径）。`find_bobo_root` 的根标记顺序（`dbx-runtime` → `dbx`）已为该布局准备好，无需改代码。

---

## 五、依赖托管：manifest 驱动（借 dsh 模式）

### 5.1 机制

壳项目 `resources/manifest.jsonc` 声明每个托管依赖：来源（URL/sha256）、目标 `managedRoot`（`$AppData/` 在线 / `$Resources/` 离线 / 绝对路径兜底）。启动编排按清单落盘与校验，**在线 ↔ 离线只改清单**。

### 5.2 各依赖托管策略

| 依赖 | 常规包 | 离线包 |
|---|---|---|
| Node.js ≥22 | manifest 托管下载到 `$AppData`（免用户自装） | 内置 `$Resources/node` |
| dsh 打包内核 | manifest 下载（不再假定用户装过 dsh-desktop；sha256 校验） | 内置 `$Resources/dsh` |
| Python `.venv`（377M） | 首启 `uv sync`（uv 本身走 manifest 托管） | 预构建内置 |
| CloakBrowser Chromium（690M） | 首启 `python -m cloakbrowser install`（共享缓存） | 内置或交付说明单独离线包 |
| uv | manifest 托管 | 内置 |
| profile 依赖 | 首启 pnpm 装 | 预生成内置 |

> Chromium 690M 是离线包最大单体，允许单独出"浏览器离线扩展包"，不强塞主安装包。

---

## 六、NSIS 安装器规范

以 `dsh/src-tauri/templates/installer.nsi` 为基底 fork，保留/必做定制：

1. **多语言**：`English + SimpChinese`，`displayLanguageSelector: false`。
2. **升级覆盖**：检测到旧安装时跳过"是否卸载"页直接覆盖（`$UpdateMode`），配合 `/UPDATE` 命令行——自研 updater 依赖此行为。
3. **数据目录页**：选择写 `HKCU\Environment`（变量名待定，如 `BOBO_HOME`）并广播 `WM_SETTINGCHANGE`；强制绝对路径校验（盘符或 `\\` 开头）。
4. **卸载**：卸载页加"删除应用数据"复选框；支持 `/P`（passive）`/NS` `/R` 静默参数。
5. **品牌与升级码**：`productName`、`mainBinaryName`、`identifier`、WiX `upgradeCode` 四件套在壳项目里显式写死，此后不随品牌补丁变动（upgradeCode 变更 = 升级链断裂）。
6. **WebView2**：`downloadBootstrapper`，不内置离线安装器。
7. **资源平铺**：`bundle.resources` 对应 4.4 的 `resources/` 布局，用清单而非改 Rust 解析路径。

---

## 七、构建命令与 CI

### 7.1 本机构建（壳项目就位后）

```bash
pnpm install --frozen-lockfile
pnpm tauri build                  # 全量：nsis + msi
pnpm tauri build --bundles nsis   # 只出安装 exe（日常用这个）
# 输出：src-tauri/target/release/bundle/nsis/*-x64-setup.exe
```

离线包：先跑 `prepare-bundle-resources`（解压 Node/内核/venv 进 `resources/` 并改写 manifest 为 `$Resources/`），再 `pnpm tauri build --bundles nsis`。

### 7.2 CI 骨架（照搬 dsh 工作流结构）

- `build-windows.yml`：windows-latest → install → rust-toolchain → `pnpm tauri build`（版本号临时 config 覆盖，WiX 只收纯数字版本）→ rename → 上传 artifact。
- `build-bundle-windows.yml`：正式发布成功后触发，composite action 下载并 sha256 校验运行时 → `--bundles nsis` → 上传离线包。
- `release.yml`：tag `v*` 触发，汇总单一 writer 上传 GitHub Release。

### 7.3 产物命名

统一为 `SmartBoBo_<版本>_x64-setup.exe`（离线包后缀 `-bundle`），由独立 rename 脚本在上传前改写，不依赖 bundler 默认命名。

---

## 八、验收标准

安装包验收 = 现有 `scripts/acceptance.py` 七组检查的**安装后形态执行**：

1. 干净虚拟机（或移除 `BOBO_ROOT`/环境变量的机器）安装 → 双击启动 → 浏览器自动开 `127.0.0.1:7075`；
2. `acceptance.py`：内核起 → 预设挂载 → 技能发现 → 交叉一致性 → pytest 全绿；
3. 升级路径：旧版本装好并产生数据 → 覆盖安装 → 数据无损、无残留旧快捷方式/注册表项；
4. 卸载：默认卸载保留数据；勾选"删除应用数据"后 `BoBoData` 清除；
5. 静默安装 `setup.exe /S`（及 `/P`）在无人值守下成功；
6. 离线包在断网机器完成 1-2；
7. 路径摆位：安装到含空格、非 `C:\`、深路径的目录仍可用。

---

## 九、实施路线

| 阶段 | 内容 | 出口判据 |
|---|---|---|
| 0 路径解耦 | §3 清单逐项消除绝对路径；junction 物化；`启动.cmd` 去硬编码 | 开发仓在任意克隆路径下全功能可用 |
| 1 壳项目 | 建薄 Tauri 壳（启动编排 + 开浏览器），fork installer.nsi，四件套品牌配置 | `pnpm tauri build --bundles nsis` 出包，本机安装可跑 |
| 2 资源分层 | 按 §4 落安装布局；`resources/runtime` 物化；数据根切 `BoBoData` | 装机后 `find_bobo_root`、`_packaged_data_root` 自动命中 |
| 3 依赖托管 | manifest.jsonc + 启动编排接入；Node/内核/uv 在线托管 | 常规包在干净机器首启自举成功 |
| 4 离线包 | `prepare-bundle-resources` 等价脚本 + 离线构建 | 断网机器安装可用 |
| 5 CI 与验收 | 三条工作流 + §7.3 命名 + §8 验收七项 | tag 一键出包并发 Release |

阶段 0 与 1 可并行；阶段 3 之前不碰体积优化。

---

## 十、决策记录与待定项

| 项 | 状态 | 说明 |
|---|---|---|
| 路线 A（薄 Tauri 壳） | **v0 未启用** | 构建机无 MSVC（T1），v0 实际落地路线 B（纯 NSIS + PyInstaller 启动器）；布局与 NSIS 结构不变，后续换壳即可升级到 A |
| 路线 B（纯 NSIS + PyInstaller） | **v0.2 已实施** | `packaging/` 全套脚手架；产物 **274MB**（§11）；v0.2 起 pywebview 原生窗口 + pnpm 随包首启装 profile 依赖 |
| 双轨分发（常规 + 离线） | 已定 | v0 为常规包变体（内核随包、Python/浏览器首启拉取）；完整离线包为后续阶段 |
| 数据根 `BoBoData` | **已实施** | `$INSTDIR\BoBoData`，卸载保留；经验池种子首启补拷（D6） |
| 常规包体积目标 | 达成 229MB | 目标 ≤300MB；payload 907MB → lzma 23.8% |
| Chromium 690M 是否进离线主包 | 待拍板 | v0 不进包，首启按需装 |
| `.venv` 377M 进离线包 | 待拍板 | v0 不进包，首启 `uv sync`（需联网） |
| 数据目录环境变量名 | **已定 DSH_HOME** | 沿用 `DSH_HOME`（代码已适配 parent 推导），不另设 BOBO_HOME |
| MSI 是否保留 | 不保留 | v0 仅 NSIS |
| updater | 后置 | 未做 |

---

## 十一、v0 实施记录与问题清单（2026-10-14）

v0 实际落地为**路线 B（纯 NSIS + PyInstaller 启动器）**，脚手架在 `packaging/`：

| 文件 | 职责 |
|---|---|
| `packaging/build_payload.py` | 组装 payload（仓内文件 + 内核 + node + uv + `.dsh-template` 占位符改写 + 品牌插件 vendored + bobo junction 物化） |
| `packaging/launcher/launcher.py` | 启动器源码：首启初始化 BoBoData、uv sync、env manifest、dbx 播种、品牌补丁、起内核、开浏览器 |
| `packaging/launcher/build_launcher.py` | PyInstaller onefile 打包为 `SmartBoBo.exe`（图标 `docs/bobo.ico`） |
| `packaging/nsis/smartbobo.nsi` | NSIS 安装脚本（MUI2、中英双语、免管理员、卸载保数据） |
| `packaging/build_installer.cmd` | 一键：payload → launcher → makensis |
| `packaging/test/install_smoke.cmd` | 安装/启动/卸载冒烟测试 |
| `packaging/toolchain/` | 免安装 NSIS 3.0.4.2（`nsis-extract/Bin/makensis.exe`）+ 7zr.exe（gitignored） |

安装布局按 §4.4：`$LOCALAPPDATA\SmartBoBo\{SmartBoBo.exe, resources\runtime\…, BoBoData\}`。
v0.1.0 产物：`packaging/dist/SmartBoBo_0.1.0_x64-setup.exe`，**229MB**（payload 907MB，lzma 非 solid，压缩率 23.8%）。

### 11.1 工具链问题（构建机环境）

| # | 问题 | 原因 | 规避（已落地） |
|---|---|---|---|
| T1 | `pnpm tauri build` 不可行 | 构建机 Rust host 为 `x86_64-pc-windows-gnu`，无 VS Build Tools / MSVC（Tauri Windows 硬依赖 MSVC 链接 WebView2）；装 MSVC 需提权重型安装 | 启用备选路线 B：纯 NSIS + PyInstaller 启动器。后续上 Tauri 只需换壳、NSIS 布局不变 |
| T2 | 下载 NSIS 官方包失败 | SourceForge 主站返回重定向 HTML、全部 dl.* 镜像 DNS 失败、fossies 不可达 | 改用 GitHub `electron-userland/electron-builder-binaries` release 的 `nsis-3.0.4.2.7z`（electron-builder 自带的 NSIS 发行版） |
| T3 | py7zr 解压 nsis.7z 报 `UnsupportedCompressionMethodError (BCJ2)` | Windows 版 7z 常用 BCJ2 过滤器，py7zr 不支持 | 下载 7-zip 官方单文件 `7zr.exe`（免安装）解压；`packaging/toolchain/` 固定此布局 |
| T4 | makensis 报 `Bad text encoding`（.nsi 第 2 行） | 无 BOM 的 .nsi 按系统 ANSI 码页读取，UTF-8 中文注释是非法字节序列；`Unicode true` 只管安装时字符串，不管脚本源编码 | **.nsi 源文件必须纯 ASCII**（注释用英文）；此约束已写入 `smartbobo.nsi` 文件头 |
| T5 | Git Bash 调 `cmd //c` 路径错乱 | `cmd //c packaging\build_installer.cmd` 中反斜杠被 bash 吃掉成 `packagingbuild_installer.cmd`；引号内正斜杠又被 cmd 解析异常 | 用绝对路径 + 直接调用：`cmd //c E:/SmartBoBo/packaging/build_installer.cmd`；传 makensis 参数时经 `cmd //c "…"` 二层引用并用正斜杠路径 |
| T6 | 冒烟脚本 `timeout /t N` 秒失败；`find /i` 报 `No such file or directory` | Git Bash 的 GNU coreutils（`timeout`、`find`）按 PATH 顺序遮蔽 Windows 同名命令；cmd 从 bash 继承 PATH | 测试脚本统一用 `ping -n N 127.0.0.1` 当 sleep；避免 `find`，等待/判断改用 `start /wait` 语义或 PowerShell |
| T7 | .cmd 脚本内一个 em-dash（—）导致 cmd 解析碎裂（报 `'m' is not recognized`、`'tlocal'`） | cmd 按 ANSI 码页读 .cmd；UTF-8 多字节标点使行中断错乱 | **所有 .cmd 严格纯 ASCII**（连注释里的破折号/中文标点都不能留）；改完可用 `python -c` 扫非 ASCII 字符自检 |
| T8 | 打进包的 `pnpm.exe` 只有 133 字节，装机后 `WinError 216`（与 Windows 不兼容） | ① 构建兜底逻辑用了 `shutil.which("pnpm")`——Windows 上命中的是 npm 的 **`pnpm.cmd` 垫片**（@ECHO off 批处理）而非真二进制；② GitHub release zip 里的真身是 50MB PE，与垫片同名 | 打包校验 **体积 >1MB 且 MZ 头** 才收；**禁止 which 兜底**；toolchain 缺失直接报错并提示恢复步骤 |
| T9 | 冒烟脚本 if 块内 `echo ... (dshmarket present)` 把块提前关闭，误报失败 | cmd 中括号是块定界符，echo 文本里的裸 `)` 会提前闭合 | **多行 if 块内的 echo 文本禁用圆括号**；单行 `if exist (...) else (...)` 形式不受影响 |

### 11.2 打包设计问题（装机即断类）

| # | 问题 | 原因 | 规避（已落地） |
|---|---|---|---|
| D1 | profile `package.json` 的 14 条 `link:../../../{cloak,dbx,vendor}/…` 装机后断裂 | pnpm 相对 link 以 package.json 所在目录为基准；开发机 `.dsh/profiles/web/../../../`= 仓库根，装机后 = `BoBoData/`（实体在 `resources\runtime`） | `build_payload.py` 构建期把 `link:../../../` 全部改写为 `link:{{RUNTIME_FS}}/` 绝对路径（package.json 与 pnpm-lock 同步） |
| D2 | `LITERATURE_DATA_DIR` 指向 runtime，卸载即丢数据 | 原值 `E:\SmartBoBo\literature` 被兜底规则改到 RUNTIME；NSIS 卸载 `RMDir /r resources` | 新增专门规则：literature → `{{DATA}}\literature`（BoBoData 数据根），先于兜底规则执行 |
| D3 | 预设里 `file:///C:/Users/<user>/…/dsh-tauri/dependencies/dsh/…` 内核绝对路径装机不存在 | 预设直接引用开发机 %APPDATA% 内核 | 规则 5：该模式改写为 `{{RUNTIME_FS}}/dsh/…`（随包内核） |
| D4 | `cordis.patch.yml` 的 `name: '../../../bobo/…'` 相对插件路径断裂 | 同 D1：模板实例化到 BoBoData 后 `../../../` 不再指向含 bobo 的根 | 规则 6：insert 条目此类 name 改写为 `file:///{{RUNTIME_FS}}/…` 绝对 URL |
| D5 | 首启初始化中断后无法续跑 | 原以 `BoBoData/.dsh 目录存在` 判定首启，崩溃留下半成品目录即永久跳过 | 改为 `.dsh/.bobo-initialized` 标记文件判定；占位符替换幂等（已替换文件无 `{{}}`），重跑安全 |
| D6 | 经验池配置装机后读不到 | 代码只读 `parent(DSH_HOME)/experience-pool/experience-pool.json`（= BoBoData），payload 种子却在 runtime | 启动器首启把 `runtime/experience-pool/experience-pool.json` 补拷到 `BoBoData/experience-pool/`（已存在则不覆盖） |
| D7 | junction 无法随包复制 | `bobo/node_modules` 4 个 junction 指向开发机内核，拷贝会带链接语义或断链 | `build_payload.py` 从内核 node_modules **实体复制**（物化），与 4 个常规复制包一致处理 |
| D8 | `/SOLID lzma` 在 907MB payload 上构建/解压过慢 | solid 压缩需整包单流，时间随体积超线性 | 改 `SetCompressor lzma`（非 solid）：构建分钟级，压缩率仍有 23.8%（962MB→229MB） |

### 11.3 验收测试暴露的问题

| # | 问题 | 原因 | 规避（已落地） |
|---|---|---|---|
| V1 | 冒烟测试判定"服务未起"，实际服务已起 | Web UI 未登录返回 **HTTP 401**，`Invoke-WebRequest` 把非 2xx 当异常 | HTTP 探活接受任意状态码（有响应 = 服务活着）；401 是正常未登录态 |
| V2 | 首启 HTTP 等待超时过短 | 首启含 uv sync（~15s）+ 内核 profile 依赖自装（分钟级），4.5min 不够且 sleep 失效时空转 | 等待上限提至 ~7.5min；sleep 修好后按真实节奏轮询（见 T6） |
| V3 | （设计确认）内核首启自装 profile 依赖 | 内核 profile-boot 自带依赖安装，无需启动器代劳；装完后 7075 起服 | 不干预，文档化"首启需联网"限制（离线包阶段再预置） |
| V4 | 卸载后 `SmartBoBo.exe` 残留 | ① 应用进程未杀净（node 子进程持锁，`Delete` 静默失败）；② 输出被管道重定向时 cmd `start /wait` 提前返回，检查跑在 `RMDir /r`（~15s）完成前 | 冒烟脚本：独立 `kill_smoke.ps1` 杀进程；卸载改 PowerShell `Start-Process -Wait`（重定向下可靠），实测卸载器 15s 完成 |
| V5 | Git Bash 里内联 PowerShell 的 `$_` 被展开成路径 | bash 双引号内 `$_` 展开为上一命令末参，再被 MSYS 转成 `/e/SmartBoBo` 形态 | bash 侧不写内联 PS；进程清理落到 `kill_smoke.ps1` 文件，仅经 `powershell -File` 调用 |

### 11.4 已验证 / 未验证

**已验证（v0.2.0，本机干净安装测试，2026-10-14，`install_smoke.cmd` 全绿）**：
- 静默安装 `/S` 布局正确（`SmartBoBo.exe` / `resources\runtime`（含 `tools/pnpm.exe` 真二进制）/ `BoBoData` / 卸载器）；
- 首启模板复制 + 占位符替换零残留、零开发机绝对路径泄漏；`.bobo-initialized` 标记落位；
- `uv sync` 建 venv；**`pnpm install` 装齐 web profile 依赖（node_modules 221 包，`dshmarket` 在场，`.bobo-deps-ok` 标记）**；
- 经验池种子落位；env manifest 刷新；内核起服 `127.0.0.1:7075`；
- 进程清理后静默卸载：程序文件全部清除，`BoBoData` 按设计保留。

**用户侧待验收**：双击 `SmartBoBo.exe` 出 **pywebview 原生窗口**（splash → 加载 `:7075` UI）；侧栏/设置页/市场预设等扩展功能与开发机一致（GUI 效果自动化脚本无法完全替代人眼，装机后请人工确认一次）。

**未验证 / 已知限制（v0.2）**：
- "干净机器"以本机隔离安装目录模拟；真实干净 VM 未测；
- 覆盖安装（旧版上装新版）未单独测；
- 首启需联网且较久（uv sync + pnpm 拉 200+ 包，约 5–15 分钟）；离线包为后续阶段；
- CloakBrowser/Playwright 浏览器二进制（~690MB）不随包；
- `apply-brand-patch.mjs` 的 dsh-tauri-ui 子补丁装机后自动跳过（内核复制时通常已打过）；
- updater、多版本升级链、MSI：未做（见 §10）。

### 11.5 复现命令

```bat
:: 一键构建（需本机已按 packaging/README.md 备好 toolchain 与 pyinstaller）
packaging\build_installer.cmd

:: 冒烟测试
packaging\test\install_smoke.cmd packaging\dist\SmartBoBo_0.1.0_x64-setup.exe
```

### 11.6 v0.2 修复记录：首版安装后的三个问题（2026-10-14）

v0.1 装机后用户实测反馈三问题，根因分析与修复如下（产物 `SmartBoBo_0.2.0_x64-setup.exe`，260MB）。

#### P1 界面不在软件窗口里，而是开浏览器网页

**根因**：v0.1 路线 B 的启动器没有 GUI 壳——职责就是起 web 服务后 `webbrowser.open()`（与开发机 `启动.cmd` 同体验）。"窗口里嵌 UI"需要 GUI 壳，属路线 A 范畴。

**修复（v0.2）**：启动器集成 **pywebview**（EdgeChromium/WebView2 后端，免 MSVC）：
- 双击即出原生窗口（1280×840，品牌 splash 页），内核在后台线程启动；
- 就绪后 `window.load_url('http://127.0.0.1:7075')` 把 UI 装进窗口；
- 关闭窗口即终止内核进程；
- pywebview 不可用时回退系统浏览器；`BOBO_HEADLESS=1` 跳过 GUI（自动化测试用）。

> 经验：**web 服务型应用做桌面壳，pywebview 是免 MSVC 的最快路径**；比 Electron 轻一个数量级，比装 VS Build Tools + Tauri 快得多。后续要更强的壳（托盘、多窗口、自定义标题栏）再升级 Tauri。

#### P2 装机后扩展功能全无，界面回退原版 DeepSeek Harness

**根因**（实测取证）：装机后 `BoBoData/.dsh/profiles/web/node_modules` **为空**（开发机有 221 个包）。查内核源码（`dsh-app-boot` / `bin.js`）确认：

1. **内核启动不会自动 `pnpm install`**——bundle 解析失败只调 `reportSkippedBundles()` 打一行 stderr 然后**跳过继续启动**；
2. 装依赖的入口是显式的 `dsh plugin --profile web add …`（转发 pnpm）或应用内插件市场；
3. 开发机 node_modules 是历史上经桌面端/市场逐步装出来的；打包只带了 package.json 声明。

→ dsh-tauri 全家、cloak、dbx、市场插件、品牌插件全部 skip → 只剩内核自带 base 层 = stock 界面。**品牌补丁其实已在内核资产里**（payload grep 可证），但界面骨架全丢，字符串补丁救不回观感。

**修复（v0.2）**：
1. **pnpm 随包**：`packaging/toolchain/pnpm-extract/pnpm.exe`（GitHub `pnpm/pnpm` release 的 `pnpm-win32-x64.zip` 独立版，~22MB）打进 `resources/runtime/tools/`；
2. **启动器首启显式安装**：`ensure_profile_deps()` 在起内核**之前**于 web profile 目录跑 `pnpm install`；成功后写 `.bobo-deps-ok` 标记 + 探测 `node_modules/dshmarket/package.json`，幂等可重跑；
3. 冒烟测试新增断言：`node_modules/dshmarket` 存在才算过（防回归）。

> 经验：**"依赖声明随包" ≠ "依赖可用"**。dsh 内核是"skip 不装"哲学，桌面端 shell（dsh-desktop）承担依赖落盘职责——凡借鉴 dsh 打包，必须自己补上 profile 依赖安装这一步。pnpm 12 官方 npm 包是 native-binary 下载器形态，**打包应直接用 GitHub release 的独立 exe**，不要指望 npm 包里的文件。

#### P3 双击出来是终端黑窗口

**根因**：v0.1 用 PyInstaller `--console` 构建（调试期故意留日志窗口）。

**修复（v0.2）**：改 `--windowed`；日志统一写 `BoBoData/logs/launcher.log`（GUI 模式下 stdout 不可用）。首启进度显示在 splash 页的 `#status`（`window.boboStatus()` 由后台线程 `evaluate_js` 更新）。

#### v0.2 其他配套改动

| 改动 | 说明 |
|---|---|
| `build_payload.py` | 新增 tools/pnpm.exe 打包（toolchain 缺失时报错并提示恢复步骤） |
| `launcher.py` | 架构调整：GUI 主线程 + boot 后台线程；首启重活（uv sync / pnpm install）移入 boot 线程，窗口秒开、进度可视化 |
| `install_smoke.cmd` | 启动加 `BOBO_HEADLESS=1`；等待上限 20min（pnpm 拉 200+ 包）；新增 profile 依赖与 pnpm 随包断言 |
| 版本 | 0.1.0 → **0.2.0** |

#### v0.2 验收结论

以 `install_smoke.cmd` 对 `SmartBoBo_0.2.0_x64-setup.exe` 干净安装实测为准（结果见 §11.4 更新）。用户验收要点：双击出 **SmartBoBo 窗口**（非终端、非浏览器标签）；侧栏/设置页/市场预设等扩展功能与开发机一致。
