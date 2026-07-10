# 画面設計書

spec.md 4章に対応する画面一覧と、各画面の表示項目・操作・呼び出す Server Action をまとめる。認可条件の詳細は [04-authorization.md](04-authorization.md) を参照。

## 画面一覧

| # | 画面 | パス | 主なファイル | アクセス可能なロール |
|---|---|---|---|---|
| 1 | ログイン | `/login` | `src/app/login/page.tsx` | 未ログインのみ |
| 2 | 社員一覧 | `/employees` | `src/app/employees/page.tsx`, `employee-row.tsx` | 管理者のみ |
| 3 | 社員詳細/マイページ | `/employees/{id}` | `src/app/employees/[id]/page.tsx` | 管理者(全員)、社員(本人のみ) |
| 4 | 社員新規登録 | `/employees/new` | `src/app/employees/new/page.tsx`, `new-employee-form.tsx` | 管理者のみ |
| 5 | 社員情報編集・退職処理 | `/employees/{id}/edit` | `src/app/employees/[id]/edit/page.tsx`, `edit-employee-form.tsx`, `terminate-section.tsx` | 管理者のみ |

## 1. ログイン(`/login`)

Server Component ではなく Client Component。`next-auth/react` の `signIn("credentials", { redirect: false })` を直接呼び出し、成功時に `router.push("/")` へ遷移する(NextAuthの標準リダイレクトを使わず、エラーメッセージをその場に表示するための実装)。

- 入力項目: メールアドレス, パスワード
- 失敗時表示: 「メールアドレスまたはパスワードが正しくありません」(アカウント不存在・パスワード不一致・退職済みアカウントのいずれも同一メッセージにまとめ、アカウントの存在有無を漏らさない)

## 2. 社員一覧(`/employees`)

spec.md 4.2。データ取得は `getEmployeeSummaries()`([03-business-logic.md](03-business-logic.md) 参照)。

表示項目(社員ごとの1行):

| 列 | 内容 |
|---|---|
| 氏名 | 退職済みの場合は「(退職済み)」を併記 |
| 有給残日数 | 有効な付与枠の残日数合計 |
| 次回有給付与年月 | 退職済みは表示しない(`-`) |
| (バッジ) | `pending` の申請がある社員の行に「申請中」バッジを表示し、行全体をハイライト |

操作: 各行クリックで社員詳細へ遷移。画面右上の「社員を新規登録」ボタンで `/employees/new` へ。

## 3. 社員詳細/マイページ(`/employees/{id}`)

spec.md 4.3。データ取得は `getEmployeeDetail(id)`。管理者から見れば「社員詳細」、社員本人が自分のIDでアクセスすれば「マイページ」として機能する(画面もServer Actionも共通)。

### ヘッダー

- 氏名(退職済みは「(退職済み)」併記)、メールアドレス、入社日
- 管理者が見ている場合のみ: 「← 社員一覧に戻る」リンク、「社員情報を編集・退職処理」リンク(`/employees/{id}/edit`)

### サマリー

- 有給残日数、次回有給付与年月(2カラムのカード表示)

### 有給申請フォーム(本人が自分のページを見ている場合のみ表示)

`LeaveRequestForm`(Client Component、`useActionState` + `submitLeaveRequestAction`)。

- 入力項目: 対象日(`type="date"`, 必須)、区分(`select`: 全休/午前半休/午後半休)
- 送信 → `submitLeaveRequestAction` → 重複申請・1日上限チェック([03-business-logic.md](03-business-logic.md) 参照)→ 成功時は一覧・詳細ページを再検証(`revalidatePath`)

### 有給取得履歴テーブル

- 列: 対象日、区分、ステータス(バッジ表示。`STATUS_LABELS`/`STATUS_BADGE_CLASSES` で色分け)、理由(却下理由・取消理由・退職時自動取消の注記)、操作
- **年タブによる絞り込み**: `?year=YYYY` クエリパラメータで年別フィルタ。年タブの選択肢は当該社員の申請に含まれる年をユニーク抽出して降順に並べたもの(別テーブルやインデックスは持たず、取得済みデータをメモリ上でフィルタ)
- 「操作」列に表示されるボタンは行ごとの `status` と閲覧者の権限で出し分け:

  | 申請の状態 | 本人が閲覧 | 管理者が閲覧(本人以外) |
  |---|---|---|
  | `pending` | 取消ボタン(`CancelRequestButton`) | 承認/却下ボタン(`ApproveRequestButton`/`RejectRequestButton`) |
  | `approved` かつ対象日3日以上先 | 取り下げボタン(`WithdrawRequestButton`) | (操作なし) |
  | `approved` かつ対象日3日未満 | 「取得日の3日前を過ぎたため取り下げ不可」の注記 | (操作なし) |
  | `rejected` / `cancelled` | 操作なし(理由列に経緯を表示) | 操作なし |

### 有給付与履歴テーブル

- 列: 付与日、付与日数、失効予定日。全期間分をそのまま表示(フィルタなし)。

## 4. 社員新規登録(`/employees/new`)

spec.md 4.4。`NewEmployeeForm`(Client Component)→ `createEmployeeAction` → 成功時 `/employees/{新規id}` へリダイレクト。

- 入力項目: 氏名、メールアドレス、初期パスワード(8文字以上、`minLength=8` をクライアント側にも設定)、入社日、権限(社員/管理者、デフォルト社員)
- 画面注記: 「登録対象はフルタイム(週所定労働日数5日、または年間所定労働日数217日以上)勤務者に限ります」(spec.md の対象範囲の注記をそのままUIに表示)
- サーバー側バリデーション(`createEmployeeAction`): 氏名・メールアドレス必須、パスワード8文字以上、入社日必須、権限が `admin`/`employee` のいずれか。メール重複は `EmailAlreadyExistsError`。

## 5. 社員情報編集・退職処理(`/employees/{id}/edit`)

spec.md 4.4。データ取得は `getEmployeeForEdit(id)` と `hasAnyGrant(id)`。

### 編集フォーム(`EditEmployeeForm`)

- 入力項目: 氏名、メールアドレス、入社日
- **入社日は `hasAnyGrant(id)` が true(＝LeaveGrantが1件でも存在)の場合、`disabled` になり編集不可**。画面にも「有給付与が発生済みのため入社日は編集できません」と注記(`updateEmployee` のサーバー側チェックと二重で担保)
- 送信 → `updateEmployeeAction` → 成功時 `/employees/{id}` へリダイレクト

### 退職処理セクション(`TerminateSection`。在職中の社員のみ表示)

2段階UI: 初期表示は説明文と「退職処理を行う」ボタンのみ。クリックすると退職日入力フォーム(`type="date"`, 必須)と「退職処理を確定する」/「キャンセル」ボタンが表示される(誤操作防止のための確認ステップ。ブラウザの `confirm()` は使わず、Reactのローカル state で表示切り替え)。

- 画面注記: 「アカウントを無効化し、以降のログイン・有給付与を停止します。申請中の申請は自動的に却下、退職日より後の承認済み申請は自動的に取消されます(データは履歴として保持されます)」
- 送信 → `terminateEmployeeAction` → `terminateEmployee`([03-business-logic.md](03-business-logic.md) 5節)→ 成功時 `/employees/{id}` へリダイレクト
