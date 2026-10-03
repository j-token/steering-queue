// ~/.claude/keybindings.json에 이 플러그인의 키를 넣거나 뺀다.
// 대기열 목록으로 들어가기 ctrl+x tab → shift+up, 빠져나오기 escape → shift+down 으로 바꾼다.

import type { KeyHints } from '../types'

type Bindings = Record<string, string | null>
type Block = { context: string; bindings: Bindings }
type Root = { bindings?: unknown; [field: string]: unknown }

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

export type RemoveResult =
  | { kind: 'unchanged'; hints: KeyHints }
  | { kind: 'changed'; text: string; hints: KeyHints }
  | { kind: 'unreadable'; hints: KeyHints }

export const DEFAULT_HINTS: KeyHints = { enter: 'ctrl+x tab', leave: 'esc' }

function isBlock(value: unknown): value is Block {
  if (typeof value !== 'object' || value === null) return false
  const block = value as { context?: unknown; bindings?: unknown }

  return typeof block.context === 'string' && typeof block.bindings === 'object' && block.bindings !== null
}

// 파일 내용을 맥락 블록과 그 밖의 항목으로 나눈다. 읽을 수 없는 형식이면 undefined
function parse(existing: string | undefined): { root: Root; blocks: Block[]; others: unknown[] } | undefined {
  let root: Root
  try {
    root = existing === undefined || existing.trim() === '' ? {} : JSON.parse(existing)
  } catch {
    return undefined
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return undefined
  if (root.bindings !== undefined && !Array.isArray(root.bindings)) return undefined

  const entries = (root.bindings as unknown[] | undefined) ?? []

  return {
    root,
    blocks: entries.filter(isBlock).map(block => ({ context: block.context, bindings: { ...block.bindings } })),
    others: entries.filter(value => !isBlock(value)),
  }
}

function serialize(root: Root, blocks: Block[], others: unknown[]) {
  const next = {
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    ...root,
    bindings: [...blocks, ...others],
  }

  return `${JSON.stringify(next, null, 2)}\n`
}

// 맥락에서 마지막으로 정해진 키의 동작. 정해지지 않았으면 undefined
function actionOf(blocks: Block[], context: string, key: string) {
  return blocks
    .filter(block => block.context === context)
    .reduce<string | null | undefined>((found, block) => (key in block.bindings ? block.bindings[key] : found), undefined)
}

// 실제로 쓰이는 키를 안내 문구용으로 돌려준다
function hintsOf(blocks: Block[]): KeyHints {
  const enter = actionOf(blocks, 'Chat', 'shift+up') === 'abovePrompt:focus'
  const leave = actionOf(blocks, 'AbovePrompt', 'shift+down') === 'abovePrompt:leave'
  const keepsEscape = actionOf(blocks, 'AbovePrompt', 'escape') !== null

  return {
    enter: enter ? 'shift+↑' : DEFAULT_HINTS.enter,
    leave: leave ? (keepsEscape ? 'shift+↓ or esc' : 'shift+↓') : DEFAULT_HINTS.leave,
  }
}

/** 파일 내용(없으면 undefined)에서 지금 쓰이는 키를 읽는다. */
export function readHints(existing: string | undefined): KeyHints {
  const parsed = parse(existing)

  return parsed === undefined ? DEFAULT_HINTS : hintsOf(parsed.blocks)
}

/**
 * 기존 파일 내용(없으면 undefined)에 이 플러그인의 키를 넣는다.
 * 사용자가 같은 키를 다른 동작에 이미 쓰고 있으면 덮어쓰지 않고 conflicts에 남긴다.
 * 파일을 읽을 수 없는 형식이면 손대지 않는다.
 */
export function mergeKeybindings(existing: string | undefined): MergeResult {
  const parsed = parse(existing)
  if (parsed === undefined) return { kind: 'unreadable', hints: DEFAULT_HINTS }

  const { root, blocks, others } = parsed
  const conflicts: string[] = []
  let isChanged = false

  for (const { context, key, action } of WANTED) {
    const owner = blocks.filter(block => block.context === context && key in block.bindings).at(-1)
    if (owner !== undefined) {
      const current = owner.bindings[key]
      if (current !== action) conflicts.push(`${context} ${key} → ${current ?? 'unbound'}`)
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

  return { kind: 'changed', text: serialize(root, blocks, others), hints, conflicts }
}

/**
 * 이 플러그인이 넣은 키(값까지 같은 것)만 뺀다. 그래서 비게 된 맥락 블록도 지운다.
 * 사용자가 같은 키를 다른 동작으로 바꿔 둔 것은 남긴다.
 */
export function removeKeybindings(existing: string | undefined): RemoveResult {
  const parsed = parse(existing)
  if (parsed === undefined) return { kind: 'unreadable', hints: DEFAULT_HINTS }

  const { root, others } = parsed
  let isChanged = false
  const blocks = parsed.blocks
    .map(block => {
      const bindings = { ...block.bindings }
      for (const { context, key, action } of WANTED) {
        if (block.context === context && key in bindings && bindings[key] === action) {
          delete bindings[key]
          isChanged = true
        }
      }

      return { block: { context: block.context, bindings }, wasEmpty: Object.keys(block.bindings).length === 0 }
    })
    .filter(({ block, wasEmpty }) => wasEmpty || Object.keys(block.bindings).length > 0)
    .map(({ block }) => block)

  const hints = hintsOf(blocks)
  if (!isChanged) return { kind: 'unchanged', hints }

  return { kind: 'changed', text: serialize(root, blocks, others), hints }
}
