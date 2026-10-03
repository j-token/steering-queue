import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptSubmitInput, SessionAppendInput } from 'claude-code'

type Seen = { submits: PromptSubmitInput[]; appends: SessionAppendInput[]; toasts: string[]; filled: string[] }

// 엔진 자리에 서는 훅: 들어온 프롬프트·행·알림·입력창 채우기를 기록한다
function engineBelow(on: On): Seen {
  const seen: Seen = { submits: [], appends: [], toasts: [], filled: [] }
  on('prompt.submit', ($, e) => {
    seen.submits.push(e)

    return { text: e.text }
  })
  on('session.append', ($, e) => {
    seen.appends.push(e)

    return { message: e.message, uuid: e.uuid }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.fill', ($, e) => {
    seen.filled.push(e.text)

    return { isFilled: true }
  })
  on('ui.focus', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return seen
}

const BAND = 'band'
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const COMPLETE = { answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' } as const

async function typeMidTurn($: Engine, text: string) {
  return $.prompt.submit({ text, turnId: 't1', wait: false, origin: { kind: 'composer' } })
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

async function startWith($: Engine, texts: string[]) {
  await $.turn.start({ text: 'first', turnId: 't1' })
  for (const text of texts) await typeMidTurn($, text)
}

async function mountBand($: Engine, props: Partial<typeof BAND_PROPS> = {}, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({
    plugin: 'steering-queue',
    surface,
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, ...props },
    requestId: BAND,
  })
  await ui.resize({ columns: 60, rows: 5, in: 'queue-drag' })

  return ui
}

type Band = Awaited<ReturnType<typeof mountBand>>

async function shownOrder(ui: Band) {
  return (await ui.findAll({ type: 'Text', in: 'queue-drag' })).map(t => t.text)
}

// 행 앵커는 대기열 순서대로 그려진다
async function rowKeys(ui: Band) {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(key => key.startsWith('row-'))
}

async function selectedRow(ui: Band) {
  const rows = await ui.findAll({ type: 'Button' })

  return rows.filter(b => b.key?.startsWith('row-')).findIndex(b => b.text === '›')
}

// 사람이 방향키로 링을 옮기는 것처럼 ui.focus를 일으킨다
async function arrowTo($: Engine, element: string) {
  return $.ui.focus({ component: 'AbovePrompt', requestId: BAND, plugin: 'steering-queue', element, origin: { kind: 'person' } })
}

async function openActions(ui: Band, index: number) {
  await ui.press({ key: (await rowKeys(ui))[index]! })
}

test('작업 중 입력한 프롬프트는 대기열에 들어가고 엔진에 전달되지 않는다', async ($, on) => {
  const seen = engineBelow(on)
  await $.turn.start({ text: 'first', turnId: 't1' })

  const result = await typeMidTurn($, 'check provider switching')

  expect(result.drop).toContain('Queued (#1)')
  expect(seen.submits).toHaveLength(0)
})

test('유휴 상태의 프롬프트와 알림은 그대로 통과한다', async ($, on) => {
  const seen = engineBelow(on)

  await $.prompt.submit({ text: 'idle', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'note', turnId: 't1', wait: false, origin: { kind: 'task-notification' } })

  expect(seen.submits.map(s => s.text)).toEqual(['idle', 'note'])
})

test('메인 턴이 끝나면 대기열 첫 항목 하나만 보내고 알린다', async ($, on) => {
  const seen = engineBelow(on)
  await startWith($, ['A', 'B'])

  await $.turn.complete({ ...COMPLETE, turnId: 't1' })
  await settle()

  expect(seen.submits.map(s => s.text)).toEqual(['A'])
  expect(seen.submits[0]?.origin).toEqual({ kind: 'plugin', name: 'steering-queue', asUser: true })
  expect(seen.toasts.join()).toContain('Queue: sending next message (1 left)')
})

test('서브에이전트 턴 종료나 중단된 턴은 대기열을 보내지 않는다', async ($, on) => {
  const seen = engineBelow(on)
  await startWith($, ['A'])

  await $.turn.complete({ ...COMPLETE, turnId: 'sub', agentId: 'agent-1' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', reason: 'aborted', isAborted: true })
  await settle()

  expect(seen.submits).toHaveLength(0)
})

test('밴드는 영어로 짧게 상태와 들어가는 키를 보여 준다', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A', 'B'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountBand($, {}, surface)
    expect(await ui.find({ type: 'Text', text: 'Queue 2 · sends when this turn ends · ctrl+x tab to manage' })).toBeDefined()
    expect(await shownOrder(ui)).toEqual(['A', 'B'])
    // 스티어링한 메시지가 없으면 그 구역은 없다
    expect(await ui.find({ type: 'Text', text: 'Steering' })).toBeUndefined()
    // 평소엔 행 앵커 말고 다른 버튼이 없다
    expect((await ui.findAll({ type: 'Button' })).every(b => b.key?.startsWith('row-'))).toBe(true)
    await ui.unmount()
  }

  const idle = await mountBand($, { isWorking: false })
  expect(await idle.find({ type: 'Text', text: /Queue 2 · paused/ })).toBeDefined()
  await idle.unmount()
})

test('행에서 Enter를 누르면 동작 줄이 열린다', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A'])
  const ui = await mountBand($)

  await openActions(ui, 0)
  const labels = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('act-')).map(b => b.text)
  expect(labels).toEqual(['Steer now', 'Move', 'Edit', 'Delete', 'Cancel'])
  expect(await ui.find({ type: 'Text', text: /←→ choose · enter run/ })).toBeDefined()

  await ui.press({ key: 'act-back' })
  expect(await ui.find({ type: 'Button', key: 'act-grab' })).toBeUndefined()
  await ui.unmount()
})

test('스티어링 행을 넣지 못하면 항목을 대기열로 되돌린다', async ($, on) => {
  const seen = engineBelow(on)
  await startWith($, ['check the session bug'])
  const ui = await mountBand($)

  // 이 빌드의 테스트 키트는 플러그인의 $.session.append를 테스트 훅으로 넘기지 않아 거부된다.
  // 그 거부를 스티어링 실패로 삼아 복원 경로를 확인한다.
  await openActions(ui, 0)
  await ui.press({ key: 'act-send' })

  expect(await shownOrder(ui)).toEqual(['check the session bug'])
  expect(seen.toasts.some(t => t.includes('Moved back to the queue'))).toBe(true)
  await ui.unmount()
})

test('작업이 멈춰 있으면 Send now가 새 턴으로 보낸다', async ($, on) => {
  const seen = engineBelow(on)
  await startWith($, ['B'])
  await $.turn.complete({ ...COMPLETE, turnId: 't1', reason: 'aborted', isAborted: true })
  const ui = await mountBand($, { isWorking: false })

  await openActions(ui, 0)
  expect((await ui.find({ type: 'Button', key: 'act-send' }))?.text).toBe('Send now')
  await ui.press({ key: 'act-send' })
  await settle()

  expect(seen.submits.map(s => s.text)).toEqual(['B'])
  await ui.unmount()
})

test('Edit은 입력창으로 돌려보내고 Delete는 지운다', async ($, on) => {
  const seen = engineBelow(on)
  await startWith($, ['A', 'B', 'C'])
  const ui = await mountBand($)

  await openActions(ui, 0)
  await ui.press({ key: 'act-edit' })
  expect(seen.filled).toEqual(['A'])
  await openActions(ui, 0)
  await ui.press({ key: 'act-delete' })

  expect(await shownOrder(ui)).toEqual(['C'])
  expect(await ui.find({ type: 'Button', key: 'act-grab' })).toBeUndefined()
  await ui.unmount()
})

test('목록에서 방향키는 행 사이만 오가며 선택을 바꾼다', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A', 'B', 'C'])
  const ui = await mountBand($)
  const [, rowB] = await rowKeys(ui)

  expect((await arrowTo($, rowB!)).deny).toBeUndefined()
  expect(await selectedRow(ui)).toBe(1)
  await ui.unmount()
})

test('Move를 고르면 방향키가 항목을 옮기고 Enter로 내려놓는다', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A', 'B', 'C'])
  const ui = await mountBand($)
  const [rowA, rowB, rowC] = (await rowKeys(ui)) as [string, string, string]

  await openActions(ui, 0)
  // 동작 줄 안에서는 act-* 사이만 오간다
  expect((await arrowTo($, 'act-edit')).deny).toBeUndefined()
  await ui.press({ key: 'act-grab' })
  expect(await ui.find({ type: 'Text', text: /↑↓ move · enter drop/ })).toBeDefined()

  // ↓ 두 번(링이 아래 행으로 가려 함): A가 맨 아래로, 링은 A에 남는다
  expect((await arrowTo($, rowB)).deny).toBeDefined()
  expect(await shownOrder(ui)).toEqual(['B', 'A', 'C'])
  await arrowTo($, rowC)
  expect(await shownOrder(ui)).toEqual(['B', 'C', 'A'])

  // 잡은 행에서 Enter → 내려놓고 목록으로
  await ui.press({ key: rowA })
  expect(await ui.find({ type: 'Text', text: /to manage/ })).toBeDefined()
  await ui.unmount()
})

test('항목을 끌어다 놓으면 순서가 바뀌고, 끌지 않고 클릭하면 동작 줄이 열린다', async ($, on) => {
  const seen = engineBelow(on)
  await startWith($, ['A', 'B', 'C'])
  const ui = await mountBand($)

  // C(2번 줄)를 잡아 맨 위로 끌어 올린다. 놓기 전에는 미리보기만 바뀐다
  await ui.pointer({ type: 'down', x: 1, y: 2, button: 'left', in: 'queue-drag' })
  await ui.pointer({ type: 'move', x: 1, y: 0, button: 'left', in: 'queue-drag' })
  expect(await shownOrder(ui)).toEqual(['C', 'A', 'B'])
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'queue-drag' })
  expect(await shownOrder(ui)).toEqual(['C', 'A', 'B'])
  expect(await ui.find({ type: 'Button', key: 'act-grab' })).toBeUndefined()

  // 클릭
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left', in: 'queue-drag' })
  await ui.pointer({ type: 'up', x: 1, y: 1, button: 'left', in: 'queue-drag' })
  expect(await ui.find({ type: 'Button', key: 'act-grab' })).toBeDefined()
  expect(await selectedRow(ui)).toBe(1)
  await ui.unmount()

  // 바뀐 순서대로 첫 항목이 나간다
  await $.turn.complete({ ...COMPLETE, turnId: 't1' })
  await settle()
  expect(seen.submits.map(s => s.text)).toEqual(['C'])
})

test('클릭한 목록에서 ↑↓는 선택, shift+↑↓는 옮기기, Delete는 삭제', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A', 'B'])
  const ui = await mountBand($)

  await ui.key({ key: 'down', in: 'queue-drag' })
  expect(await selectedRow(ui)).toBe(1)
  await ui.key({ key: 'up', shift: true, in: 'queue-drag' })
  expect(await shownOrder(ui)).toEqual(['B', 'A'])
  await ui.key({ key: 'delete', in: 'queue-drag' })
  expect(await shownOrder(ui)).toEqual(['A'])
  await ui.unmount()
})

test('포커스가 밴드를 떠나거나 입력창에서 제출하면 열어 둔 동작 줄이 닫힌다', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A', 'B'])
  const ui = await mountBand($)

  await openActions(ui, 0)
  await $.ui.focus({ component: 'AbovePrompt', requestId: BAND, origin: { kind: 'person' } })
  expect(await ui.find({ type: 'Button', key: 'act-grab' })).toBeUndefined()

  await openActions(ui, 0)
  await typeMidTurn($, 'C')
  expect(await ui.find({ type: 'Button', key: 'act-grab' })).toBeUndefined()
  await ui.unmount()
})

test('단축키에 숫자를 쓰지 않는다', async ($, on) => {
  engineBelow(on)
  await startWith($, ['A'])
  const ui = await mountBand($)
  await openActions(ui, 0)

  // 빈 입력창의 숫자 입력이 밴드 버튼으로 새지 않도록 한다
  expect(/"hotkey":"\d"/.test(JSON.stringify(await ui.drawn()))).toBe(false)
  await ui.unmount()
})
