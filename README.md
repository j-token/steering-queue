# steering-queue

**한국어** | [English](README.en.md)

Claude가 작업하는 동안 입력한 메시지를 대기열에 모아 두는 Claude Code 플러그인입니다. 턴이 하나 끝날 때마다 대기열 맨 앞 메시지가 전송됩니다. 진행 중인 턴에 메시지를 바로 끼워 넣으려면(스티어링) 해당 항목에서 **Steer now**를 고르면 됩니다.

```
Steering
↪ check the session bug                                  pending
Queue 2 · sends when this turn ends · shift+↑ to manage
› fix provider switching
· workspace switch loses the session
  Steer now  Move  Edit  Delete  Cancel
```

화면 문구는 영어입니다.

## 쓰는 법

작업 중에 Enter를 누르면 메시지가 입력창 위 목록으로 갑니다. 턴이 끝나면 첫 항목이 전송되고 `Queue: sending next message` 알림이 뜹니다.

`shift+↑`로 목록에 들어가 `↑` `↓`로 항목을 고르고 `enter`를 누르면 동작 줄이 열립니다. `←` `→`(또는 `↑` `↓`)로 동작을 고르고 `enter`로 실행합니다. 입력창으로 돌아갈 때는 `shift+↓`를 누릅니다.

| 동작 | 하는 일 |
|---|---|
| Steer now | 진행 중인 턴에 넣습니다. 멈춰 있을 때는 Send now로 바뀌어 새 턴으로 보냅니다 |
| Move | `↑` `↓`로 옮기고 `enter`로 내려놓습니다 |
| Edit | 입력창으로 돌려보냅니다. 쓰던 글이 있으면 그 뒤에 붙습니다 |
| Delete | 지웁니다 |
| Cancel | 동작 줄을 닫습니다 |

마우스로 행을 끌면 순서가 바뀌고, 클릭하면 동작 줄이 열립니다.

스티어링한 메시지는 목록 위 청록색 `Steering` 구역에 `pending`으로 나타납니다. Claude가 읽으면 `applied`로 바뀝니다. 전송·스티어링·편집이 실패한 항목은 대기열 맨 앞으로 돌아오므로 메시지를 잃지 않습니다.

## 키 설정

Claude Code 플러그인은 키 바인딩을 직접 등록할 수 없습니다. 매니페스트에 그런 항목이 없고, 플러그인 `settings.json`에서는 `agent`와 `subagentStatusLine`만 적용됩니다([문서](https://code.claude.com/docs/en/plugins/components.md)). 그래서 이 플러그인은 세션이 시작될 때 `~/.claude/keybindings.json`(`CLAUDE_CONFIG_DIR`가 있으면 그 폴더의 파일)에 아래 내용을 직접 합칩니다.

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "shift+up": "abovePrompt:focus", "ctrl+x tab": null } },
    { "context": "AbovePrompt", "bindings": { "shift+down": "abovePrompt:leave", "escape": null } }
  ]
}
```

기본 키 `ctrl+x tab`과 `esc`는 꺼집니다. 다른 키 설정은 건드리지 않고, 같은 키를 이미 다른 동작에 쓰고 있으면 그대로 두고 알림만 띄웁니다. 파일이 올바른 JSON이 아니면 손대지 않습니다. 키 설정은 Claude Code가 시작할 때 읽으므로 처음 설치한 뒤 한 번 다시 시작해야 합니다.

### `/steering-key-install`

키 설정을 직접 다룰 때 씁니다. 작업 중에도 바로 실행됩니다.

| 명령어 | 하는 일 |
|---|---|
| `/steering-key-install` | 키를 설치하고 자동 설치를 켭니다 |
| `/steering-key-install remove` | 이 플러그인이 넣은 키만 빼고 자동 설치를 끕니다. `ctrl+x tab`과 `esc`가 돌아옵니다 |
| `/steering-key-install status` | 지금 쓰이는 키와 파일 경로를 보여 줍니다 |

이미 설치되어 있으면 이렇게 나옵니다.

```
> /steering-key-install
  ⎿  steering-queue: Queue keys already installed: shift+↑ to open, shift+↓ to leave.
```

터미널이 `shift+↑` / `shift+↓`를 따로 구분해 보내지 않으면 `/steering-key-install remove`로 되돌리세요. 자동 설치만 끄려면 `/plugin configure steering-queue@steering-queue`에서 `installKeybindings`를 `false`로 바꾸거나 `~/.claude/settings.json`에 다음을 넣습니다.

```json
{ "pluginConfigs": { "steering-queue@steering-queue": { "options": { "installKeybindings": false } } } }
```

## 설치

함수 훅(function hooks) 플러그인을 지원하는 Claude Code가 필요합니다. 2.1.288에서 만들고 테스트했습니다. 이 API는 얼리 액세스라 버전에 따라 바뀔 수 있습니다.

```
/plugin marketplace add j-token/steering-queue
/plugin install steering-queue@steering-queue
```

셸에서 `claude plugin marketplace add j-token/steering-queue`와 `claude plugin install steering-queue@steering-queue`를 실행해도 됩니다. 저장소를 받아서 바로 쓰려면:

```sh
git clone https://github.com/j-token/steering-queue.git steering-queue
claude --plugin-dir ./steering-queue
```

설치본과 `--plugin-dir`를 함께 켜면 두 사본이 같은 메시지를 각각 대기열에 넣습니다. 하나만 쓰세요.

## 규칙과 제한

턴 도중 입력창이나 Remote Control에서 보낸 일반 메시지만 대기열에 들어갑니다. 첨부가 있는 메시지, `/` 명령, 알림, 다른 세션의 메시지는 원래대로 처리됩니다.

턴이 중단되거나 오류로 끝나면 대기열은 그대로 기다립니다. 이어서 보내려면 항목을 열고 Send now를 고르세요.

Claude가 마지막 답을 쓰는 사이에 스티어링해서 Claude가 읽기 전에 턴이 끝나면, 플러그인이 그 메시지를 반영해 이어가 달라고 요청합니다.

대기열 메시지는 일반 텍스트로 다시 보내기 때문에 `@파일` 멘션이 펼쳐지지 않습니다. 마우스 드래그는 터미널이 마우스 이벤트를 넘겨줄 때(보통 전체 화면 레이아웃)만 됩니다. 스티어링이 성공하는 경로와 질문·플랜 승인 창이 떠 있을 때의 동작은 테스트 키트로 재현할 수 없어서 검증이 덜 되었습니다.

## 개발

```
.claude-plugin/plugin.json       매니페스트
.claude-plugin/marketplace.json  마켓플레이스 항목 (저장소가 곧 마켓플레이스)
hooks/hooks.json                 훅 모듈 목록
hooks/register.tsx               대기열, 스티어링, 목록 UI, 키보드, 명령어
hooks/queue-list.tsx             드래그 앤 드롭 목록 (Client 모듈)
hooks/keybindings.ts             keybindings.json 병합과 제거
types/index.d.ts                 플러그인 상태 타입
tests/                           테스트
```

```sh
claude plugin validate .
claude plugin test .
```

`tsconfig.json`은 `.claude-plugin/types/tsconfig.json`을 확장합니다. 이 파일은 Claude Code가 폴더에서 플러그인을 불러올 때 만들고, git에서는 제외됩니다. `--plugin-dir`로 한 번 불러온 뒤 `tsc -p .`를 실행하세요.
