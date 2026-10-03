// ~/.claude/keybindings.json에 이 플러그인의 키를 병합한다.
// 대기열 목록으로 들어가기 ctrl+x tab → shift+up, 빠져나오기 escape → shift+down 으로 바꾼다.

import type { KeyHints } from '../types'

type Bindings = Record<string, string | null>
type Block = { context: string; bindings: Bindings }

// 각 맥락에 넣을 키. null은 기본 키를 끄는 것이다
const WANTED: { context: string; key: string; action: string | null }[] = [
  { context: 'Chat', key: 'shift+up', action: 'abovePrompt:focus' },
  { context: 'Chat', key: 'ctrl+x tab', action: null },
  { context: 'AbovePrompt', key: 'shift+down', action: 'abovePrompt:leave' },
  { context: 'AbovePrompt', key: 'escape', action: null },
]

export type MergeResult =
  | { kind: 'unchanged'; hints: KeyHints }
  | { kind: 'changed'; text: string; hints: KeyHints; conflicts: string[] }
  | { kind: 'unreadable'; hints: KeyHints }

export const DEFAULT_HINTS: KeyHints = { enter: 'ctrl+x tab', leave: 'esc' }

function isBlock(value: unknown): value is Block {
  if (typeof value !== 'object' || value === null) return false
  const block = value as { context?: unknown; bindings?: unknown }

  return typeof block.context === 'string' && typeof block.bindings === 'object' && block.bindings !== null
}

// 병합한 뒤 실제로 쓰이는 키를 안내 문구용으로 돌려준다
function hintsOf(blocks: Block[]): KeyHints {
  const actionOf = (context: string, key: string) =>
    blocks.filter(block => block.context === context).reduce<string | null | undefined>((found, block) => {
      return key in block.bindings ? block.bindings[key] : found
    }, undefined)
  const enter = actionOf('Chat', 'shift+up') === 'abovePrompt:focus'
  const leave = actionOf('AbovePrompt', 'shift+down') === 'abovePrompt:leave'
  const keepsEscape = actionOf('AbovePrompt', 'escape') !== null

  return {
    enter: enter ? 'shift+↑' : DEFAULT_HINTS.enter,
    leave: leave ? (keepsEscape ? 'shift+↓ or esc' : 'shift+↓') : DEFAULT_HINTS.leave,
  }
}

/**
 * 기존 파일 내용(없으면 undefined)에 이 플러그인의 키를 넣는다.
 * 사용자가 같은 키를 다른 동작에 이미 쓰고 있으면 덮어쓰지 않고 conflicts에 남긴다.
 * 파일을 읽을 수 없는 형식이면 손대지 않는다.
 */
export function mergeKeybindings(existing: string | undefined): MergeResult {
  let root: { bindings?: unknown; [field: string]: unknown }
  try {
    root = existing === undefined || existing.trim() === '' ? {} : JSON.parse(existing)
  } catch {
    return { kind: 'unreadable', hints: DEFAULT_HINTS }
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return { kind: 'unreadable', hints: DEFAULT_HINTS }
  if (root.bindings !== undefined && !Array.isArray(root.bindings)) return { kind: 'unreadable', hints: DEFAULT_HINTS }

  const blocks = ((root.bindings as unknown[] | undefined) ?? []).filter(isBlock).map(block => ({
    context: block.context,
    bindings: { ...block.bindings },
  }))
  const others = ((root.bindings as unknown[] | undefined) ?? []).filter(value => !isBlock(value))
  const conflicts: string[] = []
  let isChanged = false

  for (const { context, key, action } of WANTED) {
    const owner = blocks.filter(block => block.context === context && key in block.bindings).at(-1)
    if (owner !== undefined) {
      const current = owner.bindings[key]
      if (current !== action) conflicts.push(`${context} ${key} → ${current ?? '해제'}`)
      continue
    }

    let block = blocks.find(one => one.context === context)
    if (block === undefined) {
      block = { context, bindings: {} }
      blocks.push(block)
    }
    block.bindings[key] = action
    isChanged = true
  }

  const hints = hintsOf(blocks)
  if (!isChanged) return { kind: 'unchanged', hints }

  const next = {
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    ...root,
    bindings: [...blocks, ...others],
  }

  return { kind: 'changed', text: `${JSON.stringify(next, null, 2)}\n`, hints, conflicts }
}
