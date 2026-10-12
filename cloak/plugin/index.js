import { cloakRuntime } from './service.js'
import { cloakFetchTool } from './tools/cloak-fetch.js'
import { SessionProxyMode } from './proxy.js'

export const name = 'dsh-cloakbrowser'

export const inject = ['tools']

export function apply(ctx, config = {}) {
  const runtime = cloakRuntime(config)
  const proxyMode = new SessionProxyMode(ctx)
  const settings = () => ctx.get('settings')
  ctx.tools.register(cloakFetchTool(runtime, { proxyMode, settings }))
  ctx.effect(() => () => runtime.dispose(), 'dsh-cloakbrowser: service')
  console.log(`[dsh-cloakbrowser] cloak_fetch registered, endpoint ${runtime.endpoint}, data ${runtime.dataDir}`)
}
