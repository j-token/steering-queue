// 안내 줄에 보여 줄 들어가기·빠져나오기 키
export type KeyHints = { enter: string; leave: string }

export type QueuedPrompt = { id: string; text: string }

// 현재 작업에 넣은 스티어링 메시지. pending: 모델이 아직 읽지 않음, read: 다음 요청에 실림
export type SteerEntry = { id: string; text: string; status: 'pending' | 'read' }

// 밴드에서 방향키가 하는 일: 행 사이 이동, 한 항목의 동작 고르기, 항목 옮기기
export type KeyboardMode = { kind: 'list' } | { kind: 'actions'; id: string } | { kind: 'grab'; id: string }

declare module 'claude-code' {
  interface PluginState {
    'steering-queue': {
      queue: QueuedPrompt[]
      activeTurnId: string | null
      steered: SteerEntry[]
      selected: string | null
      mode: KeyboardMode
      keys: KeyHints
    }
  }
}
