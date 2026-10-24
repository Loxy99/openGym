// @vitest-environment happy-dom
// Synthetic in CI; OPENGYM_SOURCE optionally exercises a private snapshot locally.
import { test, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { convertAllenamento, reconcileAllenamento } from '../../../tools/migration/allenamento.mjs'
import { boundPort } from '../../../api/test/helpers.mjs'

const remote = vi.hoisted(() => ({ base: '', uid: '', secret: '' }))
vi.mock('../lib/api.js', () => ({
  setRemoteAuth: vi.fn(),
  api: async (p, opts = {}) => {
    const payload = `${remote.uid}:${Date.now() + 600000}:0:b`
    const token = payload + '.' + crypto.createHmac('sha256', remote.secret).update(payload).digest('base64url')
    const r = await fetch(remote.base + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) })
    const data = await r.json()
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status, data })
    return data
  }
}))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
import { DEF, useStore } from './useStore.js'
import { readBackupFile } from '../lib/backup-media.js'

const synthetic = {
  users: [{ id: 'example', display_name: 'Example' }],
  programs: [{ id: 'p', user_id: 'example', name: 'Example' }],
  routines: [{ id: 'r', program_id: 'p', name: 'Routine', sort_order: 0 }],
  routine_exercises: [], exercises: [{ id: 'e', name: 'Example', equipment: 'barbell', muscles: ['Quadricipiti'] }],
  workout_sessions: [1, 2].map(id => ({ id, client_id: 's' + id, user_id: 'example', routine_id: 'r', routine_name: 'Routine', started_at: '2026-09-01T16:00:00Z', completed_at: '2026-09-01T17:00:00Z', duration_seconds: 3600, completed_exercises: 1, total_exercises: 1 })),
  workout_sets: [{ id: 1, session_id: 2, exercise_id: 'e', set_number: 1, weight_kg: null, reps: 8, rir: 2, completed: true }]
}

test('Allenamento backup survives actual store import, real API, repeated import and a server restart', async () => {
  const source = process.env.OPENGYM_SOURCE ? JSON.parse(fs.readFileSync(process.env.OPENGYM_SOURCE, 'utf8')) : synthetic
  const converted = convertAllenamento(source)
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'opengym-roundtrip-'))
  const clone = v => JSON.parse(JSON.stringify(v))
  remote.secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(path.join(dir, 'secret'), remote.secret, { mode: 0o600 })
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: converted.profiles.map(p => ({ id: p.sourceUserId, name: p.name, created: new Date().toISOString() })), creds: [], subs: [], invites: [] }))
  let child
  const boot = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../api'), env: { ...process.env, DATA_DIR: dir, PORT: '0', COACH_DISABLED: '1', ORIGIN: 'http://localhost:8080' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''; child.stdout.on('data', d => { log += d }); child.stderr.on('data', d => { log += d })
    remote.base = 'http://127.0.0.1:' + await boundPort(child, () => log)
  }
  const stop = async () => { if (child?.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done } }
  const collected = []
  try {
    await boot()
    for (const p of converted.profiles) {
      localStorage.clear(); remote.uid = p.sourceUserId
      useStore.setState({ S: clone(DEF), user: { id: remote.uid }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
      const file = new File([JSON.stringify(p.state)], 'backup.json', { type: 'application/json' })
      const { state } = await readBackupFile(file)
      for (let n = 0; n < 2; n++) {
        await useStore.getState().importConflict(state)
        useStore.getState().importBackup(state)
        await useStore.getState().pushState()
      }
      const stored = JSON.parse(fs.readFileSync(path.join(dir, 'state-' + remote.uid + '.json'), 'utf8'))
      collected.push({ ...p, state: stored })
      expect(stored.workouts.length).toBe(p.state.workouts.length)
    }
    expect(reconcileAllenamento(source, { profiles: collected })).toMatchObject({ ok: true, errors: [] })
    await stop(); await boot()
    for (const p of collected) {
      // A fresh device has neither the previous device's revision nor fingerprint.
      localStorage.clear()
      remote.uid = p.sourceUserId
      useStore.setState({ S: clone(DEF), user: { id: remote.uid }, ready: true })
      await useStore.getState().pullState()
      expect(reconcileAllenamento(source, { profiles: collected.map(x => x === p ? { ...p, state: useStore.getState().S } : x) }).errors).toEqual([])
    }
    if (process.env.OPENGYM_REPORT) fs.writeFileSync(process.env.OPENGYM_REPORT, JSON.stringify(reconcileAllenamento(source, { profiles: collected }), null, 2), { mode: 0o600 })
  } finally {
    await stop(); useStore.setState({ S: clone(DEF), user: null, ready: false }); localStorage.clear(); fs.rmSync(dir, { recursive: true, force: true })
  }
}, 120000)
