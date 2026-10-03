import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { KeyboardMode, QueuedPrompt, SteerEntry } from '../types'
import { DEFAULT_HINTS, mergeKeybindings } from './keybindings'

const queue = atom({ plugin: 'steering-queue', key: 'queue' } as const, [])
const activeTurnId = atom({ plugin: 'steering-queue', key: 'activeTurnId' } as const, null)
// 이번 작업에 넣은 스티어링 메시지와 모델이 읽었는지 여부
const steered = atom({ plugin: 'steering-queue', key: 'steered' } as const, [] as SteerEntry[])
// 키보드 단축키가 다룰 항목. 목록에 없으면 첫 항목으로 본다
const selected = atom({ plugin: 'steering-queue', key: 'selected' } as const, null)
const keys = atom({ plugin: 'steering-queue', key: 'keys' } as const, DEFAULT_HINTS)
const mode = atom({ plugin: 'steering-queue', key: 'mode' } as const, { kind: 'list' } as KeyboardMode)

const DRAG_LIST = 'queue-drag'
// 스티어링은 대기열과 다른 색으로 구분한다
const STEER_COLOR = 'cyan'
const STEER_FRAME = '[The user sent this while you were working. Apply it to the current task now.]'
const STEER_NUDGE = 'Continue the task, applying the instruction the user just sent.'

// 대기열에서 id에 해당하는 항목을 꺼내 돌려준다. 이미 없으면 undefined.
async function take($: EngineInterface, id: string): Promise<QueuedPrompt | undefined> {
  let taken: QueuedPrompt | undefined
  await update($, queue, list => {
    taken = list.find(item => item.id === id)

    return list.filter(item => item.id !== id)
  })

  return taken
}

// id 항목을 대기열의 to번째 자리로 옮긴다
async function reorder($: EngineInterface, id: string, to: number) {
  await update($, queue, list => {
    const item = list.find(one => one.id === id)
    if (item === undefined) return list

    const rest = list.filter(one => one.id !== id)
    rest.splice(Math.max(0, Math.min(rest.length, Math.trunc(to))), 0, item)

    return rest
  })
}

function selectedIn(list: QueuedPrompt[], id: string | null) {
  return list.find(item => item.id === id) ?? list[0]
}

// 항목이 사라졌으면 목록 모드로 본다
function modeIn(list: QueuedPrompt[], current: KeyboardMode): KeyboardMode {
  if (current.kind === 'list' || list.some(item => item.id === current.id)) return current

  return { kind: 'list' }
}

// 모드를 바꾸고 포커스 링을 그 모드의 첫 요소로 옮긴다
async function enterMode($: EngineInterface, requestId: string, next: KeyboardMode) {
  const list = await read($, queue)
  const target = next.kind === 'list' ? selectedIn(list, await read($, selected)) : list.find(one => one.id === next.id)
  await update($, mode, () => next)
  if (target === undefined) return

  await update($, selected, () => target.id)
  const key = next.kind === 'actions' ? 'act-send' : `row-${target.id}`
  await $.ui.focus({ requestId, key }).catch(() => undefined)
}

// 행 앵커에서 Enter: 옮기는 중이면 내려놓고, 아니면 그 항목의 동작 목록을 연다
async function pressRow($: EngineInterface, requestId: string, id: string) {
  const current = modeIn(await read($, queue), await read($, mode))
  const next: KeyboardMode = current.kind === 'grab' && current.id === id ? { kind: 'list' } : { kind: 'actions', id }
  await enterMode($, requestId, next)
}

// 동작 목록에서 고른 동작을 실행하고 목록으로 돌아간다
async function runAction($: EngineInterface, requestId: string, action: Promise<unknown>) {
  await action
  await enterMode($, requestId, { kind: 'list' })
}

// ~/.claude/keybindings.json에 shift+↑(들어가기)·shift+↓(빠져나오기)를 넣고 ctrl+x tab·esc를 끈다
async function installKeybindings($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home === undefined ? undefined : `${home}/.claude`)
  if (configDir === undefined) return

  const path = `${configDir.replace(/[\\/]+$/, '')}/keybindings.json`
  const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  const merged = mergeKeybindings(existing)
  await update($, keys, () => merged.hints)

  if (merged.kind === 'unreadable') {
    $.ui.toast('Queue: could not read keybindings.json, keys not installed')

    return
  }
  if (merged.kind === 'unchanged') return

  await $.fs.write(path, merged.text)
  const conflict = merged.conflicts.length > 0 ? ` (kept your existing: ${merged.conflicts.join(', ')})` : ''
  $.ui.toast(`Queue keys installed: ${merged.hints.enter} to open, ${merged.hints.leave} to leave${conflict}`)
}

async function restore($: EngineInterface, item: QueuedPrompt, reason: string) {
  await update($, queue, list => [item, ...list.filter(one => one.id !== item.id)])
  $.ui.toast(`${reason}. Moved back to the queue.`)
}

// 턴이 끝나기 전에 resolve되지 않으므로 기다리지 않고, 실패하면 항목을 되돌린다
function submitLater($: EngineInterface, item: QueuedPrompt) {
  void $.prompt
    .submit({ text: item.text, asUser: true })
    .then(result => (result.drop === undefined ? undefined : restore($, item, result.drop)))
    .catch(() => restore($, item, 'Could not send'))
}

function nudgeLater($: EngineInterface) {
  void $.prompt.submit({ text: STEER_NUDGE }).catch(() => $.ui.toast('Could not ask Claude to continue'))
}

async function steer($: EngineInterface, id: string) {
  const turnId = await read($, activeTurnId)
  const item = await take($, id)
  if (item === undefined) return

  // 실행 중인 작업이 없으면 바로 새 턴으로 보낸다
  if (turnId === null) {
    submitLater($, item)

    return
  }

  try {
    const appended = await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `${STEER_FRAME}\n\n${item.text}` }] },
    })
    if (appended.deny !== undefined) {
      await restore($, item, `Steer refused: ${appended.deny}`)

      return
    }
  } catch {
    await restore($, item, 'Could not steer')

    return
  }

  await update($, steered, list => [...list, { id: item.id, text: item.text, status: 'pending' as const }])
  try {
    await $.session.append({
      message: { type: 'system', content: [{ type: 'text', text: `↪ Steered: ${item.text}` }] },
    })
  } catch {
    $.ui.toast('Steered into the current turn')
  }
}

async function sendNow($: EngineInterface, id: string) {
  const item = await take($, id)
  if (item !== undefined) submitLater($, item)
}

async function edit($: EngineInterface, id: string) {
  const item = await take($, id)
  if (item === undefined) return

  // 입력 중인 초안이 있으면 지우지 않고 뒤에 붙인다
  const draft = await $.prompt.read().catch(() => ({ text: '' }))
  const isEmpty = draft.text.trim() === ''
  const filled = await $.prompt
    .fill({ text: isEmpty ? item.text : `\n${item.text}`, mode: isEmpty ? 'replace' : 'append' })
    .catch(() => ({ isFilled: false }))
  if (!filled.isFilled) await restore($, item, 'Could not put it in the prompt')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    if (options.installKeybindings !== false) {
      await installKeybindings($).catch(() => $.ui.toast('Queue: could not install keys'))
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 입력창에서 제출했다는 것은 밴드를 빠져나왔다는 뜻이다. 열어 둔 메뉴를 닫는다
    if (e.origin.kind === 'composer') await update($, mode, () => ({ kind: 'list' }) as KeyboardMode)

    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const hasAttachments = (e.attachments?.length ?? 0) > 0
    const isCommand = e.text.trimStart().startsWith('/')

    // 작업 중 사람이 입력한 일반 프롬프트만 대기열로 보낸다.
    // 첨부가 있는 프롬프트, 명령, 알림·피어 메시지 등은 엔진 기본 동작을 따른다.
    if (e.turnId === undefined || !isPerson || hasAttachments || isCommand) {
      return next(e)
    }

    const item: QueuedPrompt = { id: crypto.randomUUID(), text: e.text }
    let position = 0
    await update($, queue, list => {
      position = list.length + 1

      return [...list, item]
    })

    return { drop: `Queued (#${position}). Sends when the current turn ends.` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, activeTurnId, () => e.turnId)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // 메인 루프의 다음 요청에 스티어링 메시지가 실린다
    if (e.agentId === undefined && (await read($, steered)).some(entry => entry.status === 'pending')) {
      await update($, steered, list => list.map(entry => ({ ...entry, status: 'read' as const })))
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    await update($, activeTurnId, () => null)
    const hadUnreadSteer = (await read($, steered)).some(entry => entry.status === 'pending')
    // 끝난 작업의 스티어링 표시는 지운다. 읽히지 않은 것은 이어가기 요청이 읽을 때까지 남긴다
    const keepsUnread = e.reason === 'answer' && hadUnreadSteer
    await update($, steered, list => (keepsUnread ? list.filter(entry => entry.status === 'pending') : []))

    // 중단·오류로 끝난 턴 뒤에는 대기열을 보내지 않고 그대로 둔다
    if (e.reason !== 'answer') return next(e)

    // 모델이 스티어링 메시지를 읽기 전에 턴이 끝났으면 이어가기를 먼저 요청한다
    if (hadUnreadSteer) {
      nudgeLater($)

      return next(e)
    }

    const list = await read($, queue)
    const first = list[0]
    if (first !== undefined) {
      const item = await take($, first.id)
      if (item !== undefined) {
        submitLater($, item)
        // 대기열에서 나간 것임을 알려, 바로 실행된 것처럼 보이지 않게 한다
        $.ui.toast(`Queue: sending next message (${list.length - 1} left)`)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, queue)
    const steering = await read($, steered)
    if (e.props.hasSurvey || (list.length === 0 && steering.length === 0)) return next(e)
    // 드래그 목록(Client)은 터미널과 데스크톱에만 있다. 이 밴드도 그 둘에서만 그려진다.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)

    // 현재 작업에 이미 넣은 스티어링 메시지: 대기열과 다른 색, 모델이 읽었는지 표시
    const steerSection =
      steering.length === 0 ? null : (
        <Box key="steering" flexDirection="column">
          <Text color={STEER_COLOR} bold>
            Steering
          </Text>
          {steering.map(entry => (
            <Box key={`steered-${entry.id}`} flexDirection="row" gap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={STEER_COLOR} dimColor={entry.status === 'read'} wrap="truncate-end">
                  ↪ {entry.text.replace(/\s+/g, ' ')}
                </Text>
              </Box>
              <Text color={STEER_COLOR} dimColor={entry.status === 'read'}>
                {entry.status === 'pending' ? 'pending' : 'applied'}
              </Text>
            </Box>
          ))}
        </Box>
      )
    if (list.length === 0) return <Box flexDirection="column">{steerSection}</Box>

    const isWorking = e.props.isWorking
    const items = list.map(item => ({ id: item.id, text: item.text.replace(/\s+/g, ' ').slice(0, 300) }))
    const current = selectedIn(list, await read($, selected))!
    const keyboard = modeIn(list, await read($, mode))
    const grabbed = keyboard.kind === 'grab' ? keyboard.id : null
    const target = keyboard.kind === 'actions' ? list.find(item => item.id === keyboard.id) : undefined
    const { enter } = await read($, keys)
    const status = isWorking ? 'sends when this turn ends' : 'paused'
    const help =
      keyboard.kind === 'grab'
        ? '↑↓ move · enter drop'
        : keyboard.kind === 'actions'
          ? '←→ choose · enter run'
          : `${enter} to manage`

    // 왼쪽 한 칸은 방향키가 오가는 행 앵커, 오른쪽은 드래그 목록.
    // Enter로 연 동작은 한 줄로 그린다. 링은 순서대로 움직여 ↑↓도 ←→처럼 오간다.
    return (
      <Box flexDirection="column">
        {steerSection}
        <Text dimColor>
          Queue {list.length} · {status} · {help}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Box flexDirection="column">
            {list.map(item => (
              <Button
                key={`row-${item.id}`}
                label={item.id === grabbed ? '⇕' : item.id === current.id ? '›' : '·'}
                plain
                dimColor={item.id !== current.id}
                onPress={press => pressRow($, press.requestId, item.id)}
              />
            ))}
          </Box>
          <Client
            key={DRAG_LIST}
            module="./queue-list.tsx"
            props={{ items, selected: current.id, grabbed }}
            flexGrow={1}
            height={items.length}
          />
        </Box>
        {target !== undefined && (
          <Box flexDirection="row" columnGap={2} paddingLeft={2}>
            <Button
              key="act-send"
              label={isWorking ? 'Steer now' : 'Send now'}
              plain
              onPress={press => runAction($, press.requestId, isWorking ? steer($, target.id) : sendNow($, target.id))}
            />
            <Button
              key="act-grab"
              label="Move"
              plain
              onPress={press => enterMode($, press.requestId, { kind: 'grab', id: target.id })}
            />
            <Button key="act-edit" label="Edit" plain onPress={press => runAction($, press.requestId, edit($, target.id))} />
            <Button key="act-delete" label="Delete" plain onPress={press => runAction($, press.requestId, take($, target.id))} />
            <Button
              key="act-back"
              label="Cancel"
              plain
              dimColor
              onPress={press => enterMode($, press.requestId, { kind: 'list' })}
            />
          </Box>
        )}
      </Box>
    )
  })

  // 방향키로 포커스 링이 움직일 때, 모드마다 갈 수 있는 요소만 허락한다.
  // 링이 한 줄로 돌든 위치대로 움직이든, 허락된 요소가 세로 한 줄이라 ↑↓가 그대로 통한다.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    // 링이 이 밴드의 요소를 떠나면(엔진의 멈춤 자리) 열어 둔 메뉴를 닫는다
    if (e.element === undefined) {
      await update($, mode, () => ({ kind: 'list' }) as KeyboardMode)

      return next(e)
    }
    if (e.origin.kind !== 'person' || e.plugin !== 'steering-queue') return next(e)

    const list = await read($, queue)
    const keyboard = modeIn(list, await read($, mode))
    const element = e.element
    const rowId = element.startsWith('row-') ? element.slice(4) : null

    if (keyboard.kind === 'actions' && rowId === null) {
      return element.startsWith('act-') ? next(e) : { deny: 'inside the action row' }
    }

    if (keyboard.kind === 'grab') {
      const from = list.findIndex(item => item.id === keyboard.id)
      const to = list.findIndex(item => item.id === rowId)
      // 바로 옆 행으로 가려 하면 링은 잡은 항목에 두고 항목을 그 방향으로 한 칸 옮긴다
      if (from >= 0 && Math.abs(to - from) === 1) {
        await reorder($, keyboard.id, to)

        return { deny: 'moving an item' }
      }
      if (rowId === null) return { deny: 'moving an item' }
    }

    if (rowId === null) return { deny: 'rows only' }

    // 동작 목록이나 옮기기 중에 행으로 링이 들어오면(밴드에 다시 들어온 경우 등) 목록 모드로 돌아간다
    if (keyboard.kind !== 'list') await update($, mode, () => ({ kind: 'list' }) as KeyboardMode)

    const moved = await next(e)
    if (moved.deny === undefined) await update($, selected, () => rowId)

    return moved
  })

  on('ui.message', { element: DRAG_LIST }, async ($, e, next) => {
    const message = e.data as { type?: unknown; id?: unknown; to?: unknown } | null
    if (typeof message?.id !== 'string') return next(e)

    const id = message.id
    if (message.type === 'select') await update($, selected, () => id)
    // 마우스로 행을 클릭하면(끌지 않고) 그 행의 동작 줄을 연다
    if (message.type === 'open') await enterMode($, e.requestId, { kind: 'actions', id })
    if (message.type === 'move' && typeof message.to === 'number') {
      await update($, selected, () => id)
      await reorder($, id, message.to)
    }
    if (message.type === 'delete') await take($, id)

    return next(e)
  })
}
