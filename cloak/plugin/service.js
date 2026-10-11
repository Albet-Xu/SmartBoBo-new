import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(pluginDir, '..')

export function cloakRuntime(config = {}) {
  const root = config.root ? path.resolve(config.root) : defaultRoot
  // Python venv is uv-managed at the project root (pyproject.toml + uv.lock):
  // the cloak dir's parent. Created by `uv sync` / cloak/ensure.ps1.
  const projectRoot = path.resolve(root, '..')
  const port = Number(config.port) > 0 ? Number(config.port) : 9333
  const dataDir = config.dataDir ? path.resolve(config.dataDir) : path.join(root, 'data')
  const readyTimeoutMs = Number(config.readyTimeoutMs) > 0 ? Number(config.readyTimeoutMs) : 120000
  const pythonBin = process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python')
  const cloakservePath = path.join(root, 'bin', 'cloakserve')
  const logPath = path.join(root, 'cloakserve.log')
  const endpoint = `http://127.0.0.1:${port}`

  let child = null
  let spawnedByUs = false
  let readyPromise = null

  function logTail(maxBytes = 4096) {
    try {
      const size = statSync(logPath).size
      const start = Math.max(0, size - maxBytes)
      const fd = openSync(logPath, 'r')
      try {
        const buf = Buffer.alloc(size - start)
        const { bytesRead } = readSync(fd, buf, 0, buf.length, start)
        return buf.subarray(0, bytesRead).toString('utf8')
      } finally {
        closeSync(fd)
      }
    } catch {
      return ''
    }
  }

  async function probe() {
    try {
      const res = await fetch(`${endpoint}/`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return false
      const body = await res.json()
      return body?.status === 'ok' && typeof body?.processes === 'object' && body.processes !== null
    } catch {
      return false
    }
  }

  function killTree(pid) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try { process.kill(pid, 'SIGKILL') } catch {}
      }
    }
  }

  async function cleanupStaleChrome() {
    const needle = dataDir.replace(/\//g, '\\')
    if (process.platform === 'win32') {
      const script = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${needle.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      await new Promise((resolve) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: 'ignore' })
        p.on('exit', resolve)
        p.on('error', resolve)
      })
    } else {
      await new Promise((resolve) => {
        const p = spawn('sh', ['-c', `pkill -f ${JSON.stringify(needle)} || true`], { stdio: 'ignore' })
        p.on('exit', resolve)
        p.on('error', resolve)
      })
    }
  }

  function startChild() {
    if (!existsSync(pythonBin)) {
      throw new Error(
        `CloakBrowser runtime not provisioned (missing ${pythonBin}). Run first: powershell -ExecutionPolicy Bypass -File "${path.join(root, 'ensure.ps1')}" (uv sync + browser install)`,
      )
    }
    const logFd = openSync(logPath, 'a')
    let proc
    try {
      proc = spawn(pythonBin, [cloakservePath, `--port=${port}`, `--data-dir=${dataDir}`], {
        cwd: root,
        windowsHide: true,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      })
    } finally {
      closeSync(logFd)
    }
    proc.on('error', () => {})
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (code !== 0 && signal !== 'SIGKILL') spawnedByUs = false
    })
    child = proc
    spawnedByUs = true
  }

  async function waitServer(deadline) {
    while (Date.now() < deadline) {
      if (await probe()) return
      if (child && child.exitCode !== null) {
        throw new Error(`cloakserve exited with code ${child.exitCode}. Log tail:\n${logTail()}`)
      }
      await sleep(400)
    }
    throw new Error(`cloakserve not ready within ${readyTimeoutMs}ms. Log tail:\n${logTail()}`)
  }

  async function warmChrome(deadline) {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(8000) })
        if (res.ok) return
      } catch {}
      if (child && child.exitCode !== null) {
        throw new Error(`cloakserve exited with code ${child.exitCode}. Log tail:\n${logTail()}`)
      }
      await sleep(500)
    }
    throw new Error(`chrome did not reach CDP within ${readyTimeoutMs}ms. Log tail:\n${logTail()}`)
  }

  async function ensureReady() {
    if (await probe()) {
      await warmChrome(Date.now() + Math.min(readyTimeoutMs, 30000))
      return { attached: true, started: false }
    }
    if (readyPromise) {
      await readyPromise
      return { attached: false, started: true }
    }
    readyPromise = (async () => {
      const deadline = Date.now() + readyTimeoutMs
      await cleanupStaleChrome()
      if (!child) startChild()
      await waitServer(deadline)
      await warmChrome(deadline)
    })()
    try {
      await readyPromise
      return { attached: false, started: true }
    } finally {
      readyPromise = null
    }
  }

  async function dispose() {
    if (child && spawnedByUs && child.exitCode === null) {
      const proc = child
      const exited = new Promise((resolve) => proc.once('exit', resolve))
      killTree(proc.pid)
      await Promise.race([exited, sleep(5000)])
      if (child === proc) child = null
    }
    spawnedByUs = false
  }

  return { ensureReady, probe, dispose, endpoint, port, root, dataDir }
}
