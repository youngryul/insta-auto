# 📸 인스타 댓글 → 자동 DM → ❤️ 좋아요

게시물에 댓글이 달리면 **댓글 작성자에게 DM을 보내고**, 성공하면 **그 댓글에 좋아요**를 눌러 처리 여부를 표시합니다.
비공식 로그인·크롤링 없이 Meta 공식 API만 사용합니다.

> ⚠️ **일반 팔로워의 댓글에 동작하려면 앱 검수가 필요합니다.** Standard Access(개발 단계)에서는 앱에 역할이 등록된 사람의 데이터만 다룰 수 있습니다. 아래 3단계를 먼저 확인하세요.

> 💡 인스타 앱에서 **❤️ 있는 댓글 = DM 보낸 댓글**, **❤️ 없는 댓글 = 아직 안 보냈거나 실패한 댓글**로 한눈에 구분됩니다.

---

## 🔄 동작 흐름

```
댓글 작성 ──▶ Meta 웹훅 ──▶ 이 서버
                              │
                              ├─ 건너뛰기: 내 댓글 / 대댓글 / 키워드 없음 / 대상 게시물 아님 / 7일 지남
                              │
                              ├─ 1️⃣ 비공개 답장(DM) 전송   POST /{IG_USER_ID}/messages
                              │        └─ 실패하면 여기서 멈춤 (좋아요 X)
                              │
                              └─ 2️⃣ 댓글 좋아요            POST /{IG_USER_ID}/likes
```

처리 기록은 `data/processed.json`에 남습니다. (인스타 API는 "내가 좋아요 눌렀는지"를 조회할 수 없어서 따로 기록해요.)

---

## ✅ 준비물

| | 내용 |
|---|---|
| 📱 인스타 계정 | **비즈니스** 또는 **크리에이터** 계정 |
| 📘 페이스북 페이지 | 인스타 계정과 **연결된** 페이지 (좋아요 API가 이 방식에서만 지원됨) |
| 🛠️ Meta 개발자 앱 | developers.facebook.com 에서 생성 (유형: 비즈니스) |
| 🖥️ 서버 | Node.js 18 이상, 외부에서 접속 가능한 **HTTPS 주소** |

> 📦 외부 패키지가 없어서 `npm install` 없이 바로 실행됩니다.

---

## 🧭 설정 순서

### 1. 인스타 메시지 접근 허용 💬
인스타 앱 → **설정 → 메시지 및 스토리 답장 → 메시지 컨트롤 → 연결된 도구** → **메시지 접근 허용** 켜기
(이걸 안 켜면 DM API가 거부됩니다)

### 2. Meta 앱 만들기 🛠️
1. developers.facebook.com → **내 앱 → 앱 만들기** (비즈니스 유형)
2. 제품 추가: **Instagram** (Facebook 로그인 방식의 API 설정) + **Webhooks**
3. **앱 설정 → 기본 설정**에서 `앱 시크릿 코드` 복사 → `APP_SECRET`

### 3. 권한 받기 🔑
아래 권한을 포함해 토큰을 발급합니다.

| 권한 | 용도 |
|---|---|
| `instagram_basic` | 계정 정보 |
| `instagram_manage_comments` | 댓글 웹훅·조회 |
| `instagram_manage_messages`, `pages_messaging` | DM 전송 |
| `instagram_manage_engagement` | ❤️ 댓글 좋아요 (2026년 4월 신규) |
| `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_read_user_content` | 페이지 연결·웹훅 구독 |

> 🧪 **테스트 단계 (Standard Access)**: 앱의 관리자·개발자·테스터로 등록된 계정이 단 댓글로만 시험할 수 있습니다.
> 🌍 **일반 팔로워 대상 운영 (내 계정 하나만 써도 해당)**: 위 권한의 **Advanced Access**가 필요하며, **앱 검수(App Review)** 와 비즈니스 인증을 통과해야 합니다. 메시지 쪽은 Human Agent 기능도 요구됩니다.

### 4. 토큰과 ID 구하기 🎟️
**Graph API 탐색기**(developers.facebook.com/tools/explorer)에서:

1. 내 앱 선택 → 위 권한 체크 → **사용자 액세스 토큰 생성**
2. 장기 토큰으로 교환
   ```
   GET /oauth/access_token?grant_type=fb_exchange_token
       &client_id={앱ID}&client_secret={앱시크릿}&fb_exchange_token={단기토큰}
   ```
3. 페이지 토큰과 인스타 계정 ID 확인
   ```
   GET /me/accounts?fields=name,access_token,instagram_business_account
   ```
   - `access_token` → `PAGE_ACCESS_TOKEN` (장기 사용자 토큰으로 받은 페이지 토큰은 만료되지 않음 ♾️)
   - `instagram_business_account.id` → `IG_USER_ID`
   - 페이지 `id`는 다음 단계에서 사용
4. 2번에서 받은 **장기 사용자 토큰** → `LIKE_ACCESS_TOKEN`
   - ⏰ 사용자 토큰은 약 60일 뒤 만료됩니다. 만료되면 DM은 나가도 ❤️가 실패하니 미리 다시 발급하세요.

### 5. `.env` 작성 📝
```bash
cp .env.example .env
```
`APP_SECRET`, `VERIFY_TOKEN`, `IG_USER_ID`, `PAGE_ACCESS_TOKEN`, `LIKE_ACCESS_TOKEN`, `DM_MESSAGE` 를 채웁니다.

### 6. 서버 실행 & 공개 주소 연결 🚀
```bash
npm start
```
- 🧪 테스트: `ngrok http 3000` → 나온 `https://xxxx.ngrok-free.app` 사용
- 🏭 운영: Render, Railway, Fly.io, 개인 서버 등 (24시간 켜져 있어야 함)
  - ⚠️ 디스크가 초기화되는 호스팅이면 `DATA_FILE`을 영구 저장 경로로 지정하세요.

### 7. 웹훅 등록 🔗
1. 앱 대시보드 → **Webhooks** → 객체 **Instagram** 선택
2. 콜백 URL: `https://내주소/webhook`, 확인 토큰: `.env`의 `VERIFY_TOKEN` → **확인 및 저장**
3. 필드 목록에서 **`comments`** 구독 ✔️
4. 페이지에 앱 구독 연결 (페이지 토큰 사용)
   ```
   POST /{페이지ID}/subscribed_apps?subscribed_fields=feed
   ```

### 8. 테스트 🧪
1. 처음엔 `.env`에서 `DRY_RUN=true` 로 켜고, **다른 계정**으로 댓글 달기 → 로그에 `🧪 (DRY_RUN)` 이 찍히면 웹훅 연결 성공
2. `DRY_RUN=false` 로 바꾸고 재시작 → 실제 DM과 ❤️ 확인
3. `https://내주소/health` 에서 처리 현황 확인

---

## ⚙️ 옵션

| 변수 | 설명 | 예시 |
|---|---|---|
| `DM_MESSAGE` | 보낼 DM. `{username}` 치환, `\n` 줄바꿈 | `@{username}님 링크예요!\nhttps://...` |
| `KEYWORDS` | 이 단어가 들어간 댓글에만 반응 (비우면 전부) | `정보,링크,link` |
| `TARGET_MEDIA_IDS` | 특정 게시물만 (비우면 전부) | `1789...,1790...` |
| `INCLUDE_REPLIES` | 대댓글에도 반응 | `false` |
| `DRY_RUN` | 실제 호출 없이 로그만 | `true` |
| `PAGE_ID` | DM이 `IG_USER_ID` 경로에서 거부될 때 페이지 ID로 전송 | `1234...` |

---

## 🩹 놓친 댓글 보정

서버가 꺼져 있었거나 오류가 났던 댓글을 다시 처리합니다. (최근 7일 이내 댓글만)
```bash
npm run backfill         # 최근 게시물 10개
npm run backfill -- 25   # 최근 게시물 25개
```
- 이미 ❤️까지 끝난 댓글은 건너뜁니다.
- DM은 성공했는데 좋아요만 실패한 댓글은 **좋아요만** 다시 시도합니다.
- ⚠️ 서버와 보정 스크립트가 같은 기록 파일을 덮어쓰므로, **서버를 끈 상태에서** 실행하세요.

---

## ⚠️ 알아둘 제약

- ✉️ **DM은 댓글당 1번**, 댓글 작성 후 **7일 이내**에만 보낼 수 있어요.
- 📥 상대가 내 계정을 팔로우하지 않으면 DM이 **메시지 요청함**으로 갑니다.
- 💬 DM 이후 추가 메시지는 상대가 답장해야 보낼 수 있어요 (답장 후 24시간 이내).
- ❤️ 좋아요는 **비공개 계정이 단 댓글**과 **스토리**에는 안 돼요. 이런 댓글은 DM이 나갔어도 ❤️가 없고 기록에 오류로 남습니다.
- ⏱️ 좋아요를 5초에 50번 넘게 호출하면 1시간 잠겨서, 서버가 댓글을 한 건씩 간격을 두고 처리합니다.
- 🔗 비공개 답장에는 댓글을 단 게시물 링크가 함께 붙습니다.
- 🙋 내 계정이 단 댓글(답글 포함)은 자동으로 건너뜁니다.
- 🔁 오류 기록은 `data/processed.json`의 `error` 항목에서 확인할 수 있어요.

---

## 🧯 자주 나는 오류

| 증상 | 확인할 것 |
|---|---|
| 웹훅 "확인 및 저장" 실패 | 서버가 켜져 있는지, URL 끝이 `/webhook`인지, `VERIFY_TOKEN` 일치 |
| 로그에 아무것도 안 찍힘 | `comments` 필드 구독, `subscribed_apps` 연결, 댓글 단 계정의 앱 역할(Standard Access) |
| `🚫 서명이 맞지 않는 요청` | `APP_SECRET`이 해당 앱의 것인지 |
| DM 실패 (권한 오류) | 1단계 "메시지 접근 허용", `instagram_manage_messages`·`pages_messaging` 권한, `PAGE_ID` 설정 |
| 좋아요만 실패 | `instagram_manage_engagement` 권한, `LIKE_ACCESS_TOKEN`이 만료되지 않은 사용자 토큰인지 |

---

## 📁 파일 구조

```
server.js              웹훅 서버
src/config.js          .env 설정
src/processor.js       댓글 필터 → DM → 좋아요
src/graph.js           Meta Graph API 호출 (재시도 포함)
src/store.js           처리 기록 (data/processed.json)
scripts/backfill.js    놓친 댓글 보정
test/flow.test.js      가짜 Graph 서버로 전체 흐름 테스트 (npm test)
```
