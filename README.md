# steering-queue

**한국어** | [English](README.en.md)

Claude Code 플러그인입니다. Claude가 작업하는 동안 입력한 메시지는 **대기열**에 쌓였다가, 턴이 끝날 때마다 하나씩 전송됩니다. 진행 중인 턴에 바로 넣는 **스티어링**은 직접 고를 때만 합니다.

```
Steering
↪ check the session bug                                  pending
Queue 2 · sends when this turn ends · shift+↑ to manage
› fix provider switching
· workspace switch loses the session
  Steer now  Move  Edit  Delete  Cancel
```

화면 문구는 영어로 표시됩니다.

## 동작 방식

- **기본은 대기열**: 턴 도중 입력한 메시지는 입력창 위 대기열에 들어갑니다. 턴이 끝나면 첫 번째 메시지가 전송되고 알림이 뜹니다.
- **스티어링은 원할 때만**: 항목을 열고 **Steer now**를 고르면 진행 중인 턴에 넣습니다. 스티어링한 메시지는 색이 다른 별도 구역에 `pending`으로 표시되고, Claude가 읽으면 `applied`로 바뀝니다.
- **순서 변경·편집·삭제**: 마우스로 끌거나 키보드로 순서를 바꿉니다. **Edit**를 고르면 항목이 입력창으로 돌아갑니다.
- **메시지를 잃지 않음**: 전송·스티어링·편집이 실패하면 항목이 대기열 맨 앞으로 돌아갑니다.

## 키

| 키 | 동작 |
|---|---|
| `shift+↑` | 입력창에서 대기열로 들어가기 |
| `shift+↓` | 입력창으로 돌아가기 |
| `↑` `↓` | 항목 고르기 |
| `enter` | 항목의 동작 열기: Steer now(멈춰 있을 때는 Send now), Move, Edit, Delete, Cancel |
| `←` `→` / `↑` `↓` | 동작 고르기 |
| **Move** 후 `↑` `↓`, 그다음 `enter` | 항목을 옮긴 뒤 내려놓기 |

마우스: 행을 끌어 순서를 바꾸거나, 행을 클릭해 동작을 엽니다.

### 키 설정 자동 설치

플러그인은 세션을 시작할 때 아래 설정을 `~/.claude/keybindings.json`(또는 `$CLAUDE_CONFIG_DIR/keybindings.json`)에 병합합니다. 기본 키인 `ctrl+x tab`과 `esc`를 대체합니다.

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "shift+up": "abovePrompt:focus", "ctrl+x tab": null } },
    { "context": "AbovePrompt", "bindings": { "shift+down": "abovePrompt:leave", "escape": null } }
  ]
}
```

- 다른 키 설정은 그대로 둡니다. 같은 키를 이미 다른 동작에 쓰고 있으면 덮어쓰지 않고 알림으로 알려 줍니다.
- 파일이 올바른 JSON이 아니면 건드리지 않습니다.
- Claude Code는 시작할 때 키 설정을 읽으므로, 처음 설치한 뒤 한 번 다시 시작하세요.
- 터미널이 `shift+↑` / `shift+↓`를 별도 키로 보내 주지 않으면, 아래 방법으로 자동 설치를 끄고 위 네 줄을 지우세요.

자동 설치를 끄려면 `/plugin configure steering-queue@steering-queue`에서 `installKeybindings`를 `false`로 바꾸거나, `~/.claude/settings.json`에 다음을 넣습니다.

```json
{ "pluginConfigs": { "steering-queue@steering-queue": { "options": { "installKeybindings": false } } } }
```

## 설치

함수 훅(function hooks) 플러그인을 지원하는 Claude Code가 필요합니다(2.1.288에서 만들고 테스트했습니다). 이 API는 얼리 액세스라 버전에 따라 바뀔 수 있습니다.

### GitHub에서

```
/plugin marketplace add j-token/steering-queue
/plugin install steering-queue@steering-queue
```

셸에서는:

```sh
claude plugin marketplace add j-token/steering-queue
claude plugin install steering-queue@steering-queue
```

### 로컬 폴더에서

```sh
git clone https://github.com/j-token/steering-queue.git steering-queue
claude --plugin-dir ./steering-queue
```

같은 플러그인을 두 번 로드하지 마세요(예: 설치본과 `--plugin-dir`를 동시에 사용). 두 사본이 모두 메시지를 대기열에 넣습니다.

## 규칙

- 대기열에 들어가는 것은 턴 도중 입력창(또는 Remote Control)에서 보낸 일반 메시지뿐입니다. 첨부가 있는 메시지, `/` 명령, 알림, 다른 세션의 메시지는 원래대로 동작합니다.
- 턴이 중단되거나 오류로 끝나면 대기열은 기다립니다. 항목을 열고 **Send now**를 고르세요.
- Claude가 마지막 답변을 쓰는 중에 스티어링해서 Claude가 읽기 전에 턴이 끝나면, 플러그인이 그 메시지를 반영해 이어가 달라고 요청합니다.
- 대기열 메시지는 일반 텍스트로 다시 보내므로 `@파일` 멘션은 펼쳐지지 않습니다.

## 알려진 제한

- 마우스 드래그는 터미널이 마우스 이벤트를 보내 줄 때(보통 전체 화면 레이아웃)만 됩니다.
- 스티어링이 성공하는 경로와 질문·플랜 승인 창이 떠 있을 때의 동작은 테스트 키트로 다룰 수 없어 덜 검증되었습니다.

## 개발

```
.claude-plugin/plugin.json       매니페스트
.claude-plugin/marketplace.json  마켓플레이스 항목 (이 저장소가 곧 마켓플레이스)
hooks/hooks.json                 훅 모듈 목록
hooks/register.tsx               대기열, 스티어링, 밴드 UI, 키보드
hooks/queue-list.tsx             드래그 앤 드롭 목록 (Client 모듈)
hooks/keybindings.ts             keybindings.json 병합
types/index.d.ts                 플러그인 상태 타입
tests/                           테스트
```

```sh
claude plugin validate .
claude plugin test .
```

`tsconfig.json`은 Claude Code가 폴더에서 플러그인을 불러올 때 만드는 `.claude-plugin/types/tsconfig.json`을 확장합니다(git에서는 제외). `--plugin-dir`로 한 번 불러온 뒤 `tsc -p .`를 실행하세요.
