# 認可設計書

対応ファイル: `src/lib/auth/guards.ts`, `src/proxy.ts`, `src/auth.config.ts`, `src/auth.ts`。

spec.md 8章は「UIで隠すだけでなく、サーバーサイドで認可すること」「各ルート個別にチェックすること」を要求している。この実装ではその要求を **2段階の防御** として実現している。

## 1段目: `proxy.ts`(ルート単位のミドルウェア)

Next.js 16 で `middleware.ts` から改称された `src/proxy.ts` が、`config.matcher` にマッチする全リクエスト(`/api/auth/*`・静的アセットを除く)に対して以下を行う。

- 未認証かつ `/login` 以外へのアクセス → `/login` へリダイレクト
- 認証済みで `/login` へアクセス → `/` へリダイレクト

これはあくまで「ログインしているかどうか」だけを見る一次防御であり、**ロールや本人/他人の区別はここでは行わない**(Edge runtime かつ `auth.config.ts` ベースで動作するため、Prisma へのアクセスができない制約もある)。

## 2段目: 各ページ・各Server Actionでの個別チェック(`guards.ts`)

| 関数 | 用途 | 失敗時の挙動 |
|---|---|---|
| `requireSession()` | ページ用。ログイン済みかつ `User.status === active` であることを確認 | 未ログイン→`/login`へredirect。退職済みアカウント→`notFound()`(404) |
| `requireAdminPage()` | ページ用。`requireSession()` に加えて `role === admin` を要求 | admin以外は `/employees/{自分のid}` へredirect(社員一覧・社員管理画面はadmin専用) |
| `requireSelfOrAdminPage(targetUserId)` | ページ用。admin、またはアクセス対象と同一人物のみ許可 | それ以外は `notFound()`(**存在有無を漏らさないため403ではなく404**) |
| `requireSessionForAction()` | Server Action用。`requireSession()` のAction版 | `ActionError` を throw し、呼び出し元でフォームにエラーメッセージ表示 |
| `assertAdminForAction(session)` | Server Action用。admin以外は例外 | `ActionError` を throw |
| `isAdmin(session)` / `isSelf(session, userId)` | 画面側の表示分岐(ボタンの出し分け等)に使う純粋な判定関数 | - |

Server Component(`page.tsx`)側は `redirect`/`notFound` を直接使えるためこれらを呼ぶだけで済むが、Server Action(`actions.ts`)は例外(`ActionError`)を投げて呼び出し側でキャッチし、`{ error: string }` という `ActionState` としてフォームへ返す設計になっている(`try/catch` パターンは全 `actions.ts` で共通)。

## アクセス制御マトリクス

| 画面/操作 | 未ログイン | 社員(本人) | 社員(他人) | 管理者 |
|---|---|---|---|---|
| `/login` | ○ | ✕(`/`へredirect) | - | ✕(`/`へredirect) |
| `/employees`(社員一覧) | ✕(`/login`へ) | ✕(`/employees/自分`へredirect) | - | ○ |
| `/employees/{id}`(社員詳細) | ✕ | ○(自分のIDのみ) | ✕(404) | ○(全員) |
| `/employees/{id}` 内の有給申請フォーム | - | ○(自分のIDのみ表示) | - | 表示されない(本人のみ表示) |
| 申請の承認・却下 | - | ✕(自己承認/自己却下禁止) | - | ○(自分以外の申請のみ) |
| 申請の取消(pending) | - | ○(本人のみ) | ✕ | ✕(本人操作専用) |
| 承認済み申請の取り下げ | - | ○(本人のみ・対象日3日前まで) | ✕ | ✕ |
| `/employees/new`(新規登録) | ✕ | ✕(adminへredirect相当) | - | ○ |
| `/employees/{id}/edit`(編集・退職処理) | ✕ | ✕ | ✕ | ○(自分自身の退職処理は不可) |

補足:
- 「社員(他人)」が `/employees/{id}` に他人のIDでアクセスした場合、`notFound()` により404を返す。403ではなく404にしているのは、対象ユーザーIDの存在有無を第三者に漏らさないための設計判断(`guards.ts` のコメント参照)。
- 退職済みアカウント(`status: terminated`)は `requireSession`/`requireSessionForAction` の時点で弾かれるため、退職後は本人によるログイン後の操作も一切できなくなる(ログイン自体は `auth.ts` の `authorize` 内で `status === "terminated"` を弾いているため、そもそもログインできない)。

## セッション設計

- `strategy: "jwt"`(DBセッションではない)。`role` は認証成功時に一度だけ `jwt` コールバックでトークンへ埋め込み、以後は `session` コールバックでトークンから複製する。そのため **ログイン後にDB上でroleを変更しても、再ログインするまでセッション上のroleは更新されない**(現状の実装に変更操作(role変更)自体が無いため実害はないが、将来roleを変更する機能を追加する場合は注意が必要)。
