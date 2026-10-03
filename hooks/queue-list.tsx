import type { ClientModule } from 'claude-code'

export type QueueListProps = { items: { id: string; text: string }[]; selected: string; grabbed: string | null }

// 잡고 있는 항목과 놓일 위치. 선택 항목은 플러그인이 props로 내려준다
type DragState = {
  drag: { id: string; from: number; over: number } | null
}

const IDLE: DragState = { drag: null }

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max, value))
}

// 드래그 중이면 잡은 항목을 놓일 자리로 옮긴 미리보기 순서를 만든다
function preview(items: QueueListProps['items'], drag: DragState['drag']) {
  const dragged = drag === null ? undefined : items[drag.from]
  if (drag === null || dragged === undefined || drag.from === drag.over) return items

  const rest = items.filter(item => item.id !== drag.id)
  rest.splice(drag.over, 0, dragged)

  return rest
}

const QueueList: ClientModule<QueueListProps, DragState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { items } = props
  const state = surface.state ?? IDLE
  const last = items.length - 1

  // 리스너는 매 호출마다 다시 걸어 지금의 props와 state를 읽는다
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      const item = items[event.y]
      if (item !== undefined) {
        surface.setState({ drag: { id: item.id, from: event.y, over: event.y } })
        surface.post({ type: 'select', id: item.id })
      }

      return
    }

    if (state.drag === null) return

    if (event.type === 'move' && event.button !== undefined) {
      const over = clamp(event.y, last)
      if (over !== state.drag.over) surface.setState({ ...state, drag: { ...state.drag, over } })

      return
    }

    if (event.type === 'up') {
      const { id, from, over } = state.drag
      // 끌지 않고 놓으면 클릭: 그 행의 동작 줄을 연다
      surface.post(over !== from ? { type: 'move', id, to: over } : { type: 'open', id })
      surface.setState({ drag: null })
    }
  })

  // 클릭으로 목록에 포커스가 오면: ↑↓ 선택, shift+↑↓ 옮기기, Enter 동작 줄 열기, Delete 삭제
  surface.onKey(event => {
    const index = items.findIndex(item => item.id === props.selected)
    const item = items[index]
    if (item === undefined) return

    const step = event.key === 'up' ? -1 : event.key === 'down' ? 1 : 0
    const to = clamp(index + step, last)
    if (step !== 0 && to !== index) {
      surface.post(event.shift ? { type: 'move', id: item.id, to } : { type: 'select', id: items[to]!.id })
    }
    if (event.key === 'return') surface.post({ type: 'open', id: item.id })
    if (event.key === 'delete' || event.key === 'backspace') surface.post({ type: 'delete', id: item.id })
  })

  return (
    <Box flexDirection="column">
      {preview(items, state.drag).map(item => {
        const isDragged = state.drag === null ? props.grabbed === item.id : state.drag.id === item.id
        const isSelected = state.drag === null && props.selected === item.id

        return (
          <Text key={item.id} wrap="truncate-end" inverse={isDragged} bold={isSelected}>
            {item.text}
          </Text>
        )
      })}
    </Box>
  )
}

export default QueueList
