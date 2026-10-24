import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, onAuthRequired, resetAuthRequired } from '../../src/api'

const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
let fn
beforeEach(() => { resetAuthRequired(); fn = vi.fn(async () => reply(200, {})); vi.stubGlobal('fetch', fn) })
afterEach(() => vi.unstubAllGlobals())
const sentHeaders = () => new Headers(fn.mock.calls.at(-1)[1].headers)

test('the header is added to GET and POST for object, Headers and pair-array inputs', async () => {
  await apiFetch('/api/x')
  expect(sentHeaders().get('X-Requested-With')).toBe('ArrView')
  await apiFetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  expect(sentHeaders().get('X-Requested-With')).toBe('ArrView')
  expect(sentHeaders().get('Content-Type')).toBe('application/json')
  await apiFetch('/api/x', { headers: new Headers({ 'X-Other': '1' }) })
  expect(sentHeaders().get('X-Other')).toBe('1')
  expect(sentHeaders().get('X-Requested-With')).toBe('ArrView')
  await apiFetch('/api/x', { headers: [['X-Pair', '2']] })
  expect(sentHeaders().get('X-Pair')).toBe('2')
  expect(sentHeaders().get('X-Requested-With')).toBe('ArrView')
})

test('other options are kept and a caller-supplied X-Requested-With is replaced', async () => {
  const signal = new AbortController().signal
  await apiFetch('/api/x', { method: 'PUT', body: 'b', signal, cache: 'no-store', headers: { 'X-Requested-With': 'x' } })
  const [url, options] = fn.mock.calls.at(-1)
  expect(url).toBe('/api/x')
  expect(options).toMatchObject({ method: 'PUT', body: 'b', signal, cache: 'no-store' })
  expect(new Headers(options.headers).get('X-Requested-With')).toBe('ArrView')
})

test('a 401 with auth:true notifies once per episode, even for concurrent 401s, and the body stays readable', async () => {
  fn.mockImplementation(async () => reply(401, { error: 'Authentication required', auth: true }))
  const listener = vi.fn()
  onAuthRequired(listener)
  const responses = await Promise.all([apiFetch('/api/a'), apiFetch('/api/b'), apiFetch('/api/c')])
  expect(listener).toHaveBeenCalledTimes(1)
  expect(await responses[0].json()).toEqual({ error: 'Authentication required', auth: true })
  await apiFetch('/api/d')
  expect(listener).toHaveBeenCalledTimes(1)
  resetAuthRequired()
  await apiFetch('/api/e')
  expect(listener).toHaveBeenCalledTimes(2)
})

test('other responses do not notify and do not throw', async () => {
  const listener = vi.fn()
  onAuthRequired(listener)
  for (const response of [reply(401, { error: 'Incorrect password' }), reply(403, { auth: true }), reply(500, { auth: true }), reply(401, 'not json'), { ok: true }, { status: 401 }]) {
    fn.mockResolvedValueOnce(response)
    await expect(apiFetch('/api/x')).resolves.toBe(response)
  }
  expect(listener).not.toHaveBeenCalled()
})

test('unsubscribe stops notifications', async () => {
  fn.mockImplementation(async () => reply(401, { auth: true }))
  const listener = vi.fn()
  const off = onAuthRequired(listener)
  off()
  await apiFetch('/api/x')
  expect(listener).not.toHaveBeenCalled()
})
