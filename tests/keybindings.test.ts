import { describe, expect, mock, test } from 'claude-code/testing'

import { mergeKeybindings, removeKeybindings } from '../hooks/keybindings'

type Block = { context: string; bindings: Record<string, string | null> }

function blocksOf(text: string): Block[] {
  return JSON.parse(text).bindings
}

function bindingOf(text: string, context: string, key: string) {
  return blocksOf(text)
    .filter(block => block.context === context)
    .reduce<string | null | undefined>((found, block) => (key in block.bindings ? block.bindings[key] : found), undefined)
}

describe('mergeKeybindings', () => {
  test('파일이 없으면 shift+↑·shift+↓로 대체한 설정을 새로 만든다', () => {
    const result = mergeKeybindings(undefined)
    if (result.kind !== 'changed') throw new Error(result.kind)

    expect(bindingOf(result.text, 'Chat', 'shift+up')).toBe('abovePrompt:focus')
    expect(bindingOf(result.text, 'Chat', 'ctrl+x tab')).toBe(null)
    expect(bindingOf(result.text, 'AbovePrompt', 'shift+down')).toBe('abovePrompt:leave')
    expect(bindingOf(result.text, 'AbovePrompt', 'escape')).toBe(null)
    expect(JSON.parse(result.text).$schema).toContain('claude-code-keybindings')
    expect(result.hints).toEqual({ enter: 'shift+↑', leave: 'shift+↓' })
  })

  test('기존 설정은 남기고 필요한 키만 더한다', () => {
    const existing = JSON.stringify({
      bindings: [
        { context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor', 'shift+up': 'abovePrompt:focus' } },
        { context: 'Global', bindings: { 'ctrl+k ctrl+t': 'app:toggleTodos' } },
      ],
    })
    const result = mergeKeybindings(existing)
    if (result.kind !== 'changed') throw new Error(result.kind)

    expect(bindingOf(result.text, 'Chat', 'ctrl+e')).toBe('chat:externalEditor')
    expect(bindingOf(result.text, 'Global', 'ctrl+k ctrl+t')).toBe('app:toggleTodos')
    expect(bindingOf(result.text, 'Chat', 'ctrl+x tab')).toBe(null)
    expect(blocksOf(result.text).filter(block => block.context === 'Chat')).toHaveLength(1)
  })

  test('이미 설치되어 있으면 쓰지 않는다', () => {
    const first = mergeKeybindings(undefined)
    if (first.kind !== 'changed') throw new Error(first.kind)

    expect(mergeKeybindings(first.text).kind).toBe('unchanged')
  })

  test('사용자가 같은 키를 다른 동작에 쓰면 덮어쓰지 않고 알린다', () => {
    const existing = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'shift+up': 'history:previous' } }] })
    const result = mergeKeybindings(existing)
    if (result.kind !== 'changed') throw new Error(result.kind)

    expect(bindingOf(result.text, 'Chat', 'shift+up')).toBe('history:previous')
    expect(result.conflicts.join()).toContain('shift+up')
    // 들어가는 키는 설치되지 않았으므로 안내는 기본 키를 보여 준다
    expect(result.hints.enter).toBe('ctrl+x tab')
  })

  test('제거는 플러그인이 넣은 값과 같은 키만 뺀다', () => {
    const installed = mergeKeybindings(JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'shift+up': 'history:previous' } }] }))
    if (installed.kind !== 'changed') throw new Error(installed.kind)
    const removed = removeKeybindings(installed.text)
    if (removed.kind !== 'changed') throw new Error(removed.kind)

    // 사용자가 바꿔 둔 shift+up은 남는다
    expect(bindingOf(removed.text, 'Chat', 'shift+up')).toBe('history:previous')
    expect(bindingOf(removed.text, 'Chat', 'ctrl+x tab')).toBeUndefined()
    expect(removeKeybindings(removed.text).kind).toBe('unchanged')
  })

  test('JSON이 아니면 손대지 않는다', () => {
    expect(mergeKeybindings('{ broken').kind).toBe('unreadable')
    expect(mergeKeybindings('{"bindings": {}}').kind).toBe('unreadable')
    expect(removeKeybindings('{ broken').kind).toBe('unreadable')
  })
})

const HOME = 'C:/Users/tester'
const FILE = `${HOME}/.claude/keybindings.json`

test('세션이 시작되면 키 설정을 설치하고 안내를 띄운다', async ($, on) => {
  mock.env(on, { USERPROFILE: HOME })
  const written: { path: string; text: string }[] = []
  const toasts: string[] = []
  on('fs.exists', () => ({ value: false }))
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: HOME } as never)

  // 엔진이 경로 구분자를 운영체제 형식으로 바꿔 넘긴다
  expect(written.map(one => one.path.replace(/\\/g, '/'))).toEqual([FILE])
  expect(bindingOf(written[0]!.text, 'Chat', 'shift+up')).toBe('abovePrompt:focus')
  expect(toasts.join()).toContain('shift+↑')
})

test('설정에서 끄면 키 설정 파일을 건드리지 않는다', { options: { installKeybindings: false } }, async ($, on) => {
  mock.env(on, { USERPROFILE: HOME })
  const written: string[] = []
  on('fs.exists', () => ({ value: false }))
  on('fs.write', ($, e) => {
    written.push(e.path)

    return { value: undefined }
  })

  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: HOME } as never)

  expect(written).toHaveLength(0)
})

// 메모리 속 파일 하나와 /config 행 하나로 엔진 자리를 채운다
function fakeWorld(on: any, initial?: string) {
  const files = new Map<string, string>()
  if (initial !== undefined) files.set(FILE, initial)
  const configSets: { key: string; value: unknown }[] = []
  const norm = (path: string) => path.replace(/\\/g, '/')
  mock.env(on, { USERPROFILE: HOME })
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: files.has(norm(e.path)) }))
  on('fs.read', ($: unknown, e: { path: string }) => ({ value: files.get(norm(e.path)) }))
  on('fs.write', ($: unknown, e: { path: string; text: string }) => {
    files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('config.list', () => ({ value: [{ key: 'steering-queue.installKeybindings', label: 'Install queue keys', kind: 'boolean', value: true }] }))
  on('config.set', ($: unknown, e: { key: string; value: unknown }) => {
    configSets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  on('command.register', ($: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))

  return { files, configSets }
}

async function runKeys($: any, args: string) {
  const result = await $.command.run({ command: 'queue-keys', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  return result.text as string
}

test('/queue-keys로 설치·상태 확인·제거를 한다', async ($, on) => {
  const { files, configSets } = fakeWorld(on, JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } }] }))

  expect(await runKeys($, 'install')).toContain('Queue keys installed: shift+↑ to open, shift+↓ to leave')
  expect(bindingOf(files.get(FILE)!, 'Chat', 'shift+up')).toBe('abovePrompt:focus')
  expect(await runKeys($, 'status')).toContain('shift+↑ to open')
  expect(await runKeys($, '')).toContain('already installed')

  // 제거: 플러그인 키만 빠지고 사용자 키는 남으며, 자동 설치가 꺼진다
  expect(await runKeys($, 'remove')).toContain('Queue keys removed')
  const left = files.get(FILE)!
  expect(bindingOf(left, 'Chat', 'shift+up')).toBeUndefined()
  expect(bindingOf(left, 'Chat', 'ctrl+x tab')).toBeUndefined()
  expect(bindingOf(left, 'Chat', 'ctrl+e')).toBe('chat:externalEditor')
  expect(blocksOf(left).some(block => block.context === 'AbovePrompt')).toBe(false)
  expect(configSets.at(-1)).toEqual({ key: 'steering-queue.installKeybindings', value: false })
  expect(await runKeys($, 'status')).toContain('ctrl+x tab to open')

  expect(await runKeys($, 'nope')).toContain('Usage: /queue-keys')
})
