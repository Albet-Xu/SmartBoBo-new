import { cloakRuntime } from './service.js'
import { cloakFetchTool } from './tools/cloak-fetch.js'

export const name = 'dsh-cloakbrowser'

export const inject = ['tools']

export function apply(ctx, config = {}) {
  const runtime = cloakRuntime(config)
  ctx.tools.register(cloakFetchTool(runtime))
  ctx.effect(() => () => runtime.dispose(), 'dsh-cloakbrowser: service')
  console.log(`[dsh-cloakbrowser] cloak_fetch registered, endpoint ${runtime.endpoint}, data ${runtime.dataDir}`)
}
