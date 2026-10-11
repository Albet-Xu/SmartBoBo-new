#!/usr/bin/env node
/**
 * 对打包内核应用 SmartBoBo 品牌补丁（与 src-tauri/src/service/patch/brand.rs 同源逻辑）。
 * 幂等：锚点缺失或已打过都安全跳过。桌面端启动时 Rust 会再打一次，互不冲突。
 *
 * 用法：node scripts/apply-brand-patch.mjs [内核根目录]
 * 默认内核根：%APPDATA%\dsh-tauri\dependencies\dsh
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const HEADLINE_ZH_ORIGINAL = '"hero.headline": "探索未至之境"'
const HEADLINE_ZH_PATCHED = '"hero.headline": "万物皆可得"'
const HEADLINE_EN_ORIGINAL = '"hero.headline": "Into the Unknown"'
const HEADLINE_EN_PATCHED = '"hero.headline": "Everything is obtainable"'
const PREVIEW_BADGE_RENDER = 'children: t("hero.preview")'
const PREVIEW_BADGE_ORIGINAL = '[(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") }), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tclassName: HeroShell_module_css_default.previewBadge,\n\t\t\t\t\t\t\t\tchildren: t("hero.preview")\n\t\t\t\t\t\t\t})]'
const PREVIEW_BADGE_PATCHED = '(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") })'
const BOOT_ORIGINAL = 'wordmark,"HARNESS")'
const BOOT_PATCHED = 'wordmark,"AGENT")'
const FAVICON_MARKER = '<!-- smartbobo-pineapple -->'
const WHALE_ANCHOR = 'M48.8354 10.0479C48.3232'
const TITLE_ORIGINAL = '<title>DeepSeek Harness</title>'
const TITLE_PATCHED = '<title>SmartBoBo</title>'
const MANIFEST_NAME_ORIGINAL = '"name": "DeepSeek Harness"'
const MANIFEST_NAME_PATCHED = '"name": "SmartBoBo"'
const MANIFEST_SHORT_ORIGINAL = '"short_name": "DSH"'
const MANIFEST_SHORT_PATCHED = '"short_name": "BoBo"'

const PINEAPPLE_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="50.000000" height="50.000000" viewBox="0 0 50 50" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <!-- smartbobo-pineapple -->
  <style>
    @media (prefers-color-scheme: dark) {
      svg { stroke: #fff; }
    }
  </style>
  <path d="M25 22 Q24 12 22 5 Q21.5 1 20 3" stroke-width="2.8" />
  <path d="M25 22 Q27 10 31 4 Q33 1 31 4" stroke-width="2.8" />
  <path d="M25 22 Q18 15 11 9 Q9 7 10 10" stroke-width="2.5" />
  <path d="M25 22 Q32 15 39 9 Q41 7 40 10" stroke-width="2.5" />
  <path d="M25 22 Q17 17 9 13" stroke-width="2.2" />
  <path d="M25 22 Q33 17 41 13" stroke-width="2.2" />
  <path d="M25 24 Q8 24 7.5 37 Q7.2 44 17 48 Q22.5 50 25 50 Q27.5 50 33 48 Q42.8 44 42.5 37 Q42 24 25 24 Z" stroke-width="3.5" fill="none" />
  <path d="M17.5 29 L12.5 49" stroke-width="1.2" fill="none" />
  <path d="M25 27 L25 50" stroke-width="1.2" fill="none" />
  <path d="M32.5 29 L37.5 49" stroke-width="1.2" fill="none" />
  <path d="M8 32 L42 32" stroke-width="1.2" fill="none" />
  <path d="M7.5 39 L42.5 39" stroke-width="1.2" fill="none" />
  <path d="M8.5 46 L41.5 46" stroke-width="1.2" fill="none" />
</svg>
`

// 内核打包 JS 里纯产品义文案的策展替换表（与 brand.rs 的 KERNEL_COPY 同源）。
// 只收「主语是产品名」的 UI 串；登录/账号/模型供应商语境不进表。
const KERNEL_COPY = [
  ['node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js', [
    ['productTitle = "DeepSeek Harness"', 'productTitle = "SmartBoBo Agent"'],
  ]],
  ['node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js', [
    ['可能损坏 DeepSeek Harness，或读取和泄露你的数据', '可能损坏 SmartBoBo Agent，或读取和泄露你的数据'],
    ['can damage DeepSeek Harness or leak your data', 'can damage SmartBoBo Agent or leak your data'],
  ]],
  ['node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js', [
    ['请在运行 DeepSeek Harness 的主机上', '请在运行 SmartBoBo Agent 的主机上'],
    ['on the computer running DeepSeek Harness', 'on the computer running SmartBoBo Agent'],
  ]],
  ['node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js', [
    ['onboardingBrand: "DeepSeek Harness"', 'onboardingBrand: "SmartBoBo Agent"'],
    ['返回 DeepSeek Harness', '返回 SmartBoBo Agent'],
    ['Back to DeepSeek Harness', 'Back to SmartBoBo Agent'],
    ['不会影响 DeepSeek Harness 的工作能力', '不会影响 SmartBoBo Agent 的工作能力'],
    ['not what DeepSeek Harness can do', 'not what SmartBoBo Agent can do'],
    ['DeepSeek Harness works in a local folder', 'SmartBoBo Agent works in a local folder'],
    ['DeepSeek Harness 会以本地文件夹作为工作区', 'SmartBoBo Agent 会以本地文件夹作为工作区'],
  ]],
]

const root = process.argv[2]
  ?? join(process.env.APPDATA ?? '', 'dsh-tauri', 'dependencies', 'dsh')

if (!existsSync(root)) {
  console.error(`[brand-patch] 内核根不存在：${root}`)
  process.exit(1)
}

function patch(rel, transform) {
  const path = join(root, rel)
  if (!existsSync(path)) {
    console.log(`[brand-patch] skip (missing): ${rel}`)
    return
  }
  const source = readFileSync(path, 'utf8')
  const result = transform(source)
  if (result === null) {
    console.log(`[brand-patch] skip (already/anchor): ${rel}`)
    return
  }
  writeFileSync(path, result)
  console.log(`[brand-patch] patched: ${rel}`)
}

patch('node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', (s) => {
  const hasHeadline = s.includes(HEADLINE_ZH_ORIGINAL) || s.includes(HEADLINE_EN_ORIGINAL)
  const hasPreview = s.includes(PREVIEW_BADGE_ORIGINAL)
  if (!hasHeadline && !hasPreview) return null
  let out = s
  if (out.includes(HEADLINE_ZH_ORIGINAL)) out = out.replace(HEADLINE_ZH_ORIGINAL, HEADLINE_ZH_PATCHED)
  if (out.includes(HEADLINE_EN_ORIGINAL)) out = out.replace(HEADLINE_EN_ORIGINAL, HEADLINE_EN_PATCHED)
  if (out.includes(PREVIEW_BADGE_ORIGINAL)) out = out.replace(PREVIEW_BADGE_ORIGINAL, PREVIEW_BADGE_PATCHED)
  return out
})

const assetsDir = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
if (existsSync(assetsDir)) {
  for (const name of readdirSync(assetsDir)) {
    if (!name.startsWith('index-') || !name.endsWith('.js')) continue
    patch(`node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/${name}`, (s) => {
      if (s.includes(BOOT_PATCHED) || !s.includes(BOOT_ORIGINAL)) return null
      return s.replace(BOOT_ORIGINAL, BOOT_PATCHED)
    })
  }
}

for (const fav of ['favicon.svg', 'favicon-dark.svg']) {
  patch(`node_modules/@deepseek-ai/dsh-web-frontend/dist/${fav}`, (s) => {
    if (s.includes(FAVICON_MARKER) || !s.includes(WHALE_ANCHOR)) return null
    return PINEAPPLE_FAVICON
  })
}

patch('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html', (s) => {
  if (!s.includes(TITLE_ORIGINAL)) return null
  return s.replace(TITLE_ORIGINAL, TITLE_PATCHED)
})

patch('node_modules/@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest', (s) => {
  if (!s.includes(MANIFEST_NAME_ORIGINAL) || !s.includes(MANIFEST_SHORT_ORIGINAL)) return null
  return s
    .replace(MANIFEST_NAME_ORIGINAL, MANIFEST_NAME_PATCHED)
    .replace(MANIFEST_SHORT_ORIGINAL, MANIFEST_SHORT_PATCHED)
})

for (const [rel, pairs] of KERNEL_COPY) {
  patch(rel, (s) => {
    const hasAny = pairs.some(([original]) => s.includes(original))
    if (!hasAny) return null
    let out = s
    for (const [original, next] of pairs) {
      if (out.includes(original)) out = out.replaceAll(original, next)
    }
    return out
  })
}

console.log('[brand-patch] done')
