# 実装計画 — コンプライアンス系優先 + UX改善

作成日: 2026-07-10（Phase 5 追記: 2026-07-13）
対象: `todo/improvement-ideas.md` のうち **①法令コンプライアンスの穴（年5日 / 管理簿 / 時間単位年休）**・**②自動付与バッチ**・**③運用を楽にする機能（期間一括申請）**
関連: `spec.md`（正式仕様） / `CLAUDE.md`（実装状況）

---

## 方針とフェーズ順序

### 実装順序の考え方

- **依存関係で並べる**。年5日管理・管理簿は「付与（LeaveGrant）と消化（LeaveConsumption）が正しく存在している」ことが前提。よって**自動付与バッチを先に固める**。
- **時間単位年休は最後**。残高計算・FEFO・重複チェック・年5日カウントすべてに波及する最も重い変更のため、他が安定してから着手する。
- **期間一括申請（Phase 5）はUX改善であり、法令コンプライアンス系（Phase 1〜4）とは独立**。Phase 0完了後であれば、他Phaseと並行、または前後どちらに挿入しても構わない。
- 各フェーズは「spec.md への追記 → マイグレーション → 純粋関数 → クエリ/ミューテーション → 画面 → テスト」の順で進める。

### フェーズ一覧

| フェーズ | 内容 | 規模感 | 依存 |
|---|---|---|---|
| Phase 0 | テスト基盤整備（vitest 導入・純粋関数のユニットテスト） | 小 | なし |
| Phase 1 | 自動付与バッチ（勤続マイルストーンで LeaveGrant 自動生成） | 中 | Phase 0 |
| Phase 2 | 年5日取得義務の管理 | 中 | Phase 1 |
| Phase 3 | 年次有給休暇管理簿の出力（Excel/PDF） | 小〜中 | Phase 1・2 |
| Phase 4 | 時間単位年休 | 大 | Phase 0〜3 |
| Phase 5 | 期間一括申請（複数日をまとめて申請できるようにする） | 中 | Phase 0 のみ |

Phase 5 は Phase 2・Phase 1・Phase 4 のいずれにも機能的な影響を与えない（`getAnnualObligation` は `target_date` ベースの日単位集計で、`LeaveGrant` のライフサイクルとも無関係。Phase 4 着手時は Phase 5 の一括申請に `hourly` を含めるか改めて判断する）。

### 全フェーズ共通の原則

- ロジックは既存の純粋関数レイヤ（`src/lib/leave/schedule.ts` / `balance.ts` / `request-rules.ts`）に寄せ、DB 依存を薄く保つ（テスト容易性のため）。
- 認可は必ずサーバー側（`src/lib/auth/guards.ts`）で強制（spec.md §8）。管理者操作は `assertAdminForAction`。
- 破壊的変更を伴う書き込みは既存同様 `prisma.$transaction` 内で行い、付与生成・消化はべき等に。
- `git commit`/`git push` は都度ユーザー確認（CLAUDE.md のルール）。

---

## Phase 0 — テスト基盤整備（先行投資）

#### 目的

以降の FEFO・残高・年5日・時間単位のロジック変更を安全に行うための土台。現状テストが無く、境界条件の多い領域を素手で触るのはリスク。

#### やること

- `vitest` を devDependency に追加、`npm run test` を `package.json` に定義。
- `vitest.config.ts` でパスエイリアス解決を設定する。`schedule.ts` は `@/lib/date/calendar`、`request-rules.ts` は `@/generated/prisma/client` をそれぞれ `@/*` 経由でimportしており、`tsconfig.json` の `paths` と同じ解決を vitest 側にも設定しないとテストが起動できない。
- 既存の純粋関数に対する回帰テストを先に固定する:
  - `schedule.ts`: `getNextGrantMilestone`（6ヶ月→1年6ヶ月…20日打ち止め）、`computeExpireDate`（2年後の前日）。
  - `balance.ts`: `planFefoConsumption`（失効日昇順の按分・複数枠分割・残高不足で `InsufficientBalanceError`）、`sortFefo`（同一失効日→付与日→ID）、`isGrantActive`。
  - `request-rules.ts`: `checkNewRequest`（重複区分・1.0日超過）、`isWithinWithdrawalWindow`（3日前境界）。
- DB を使う統合テスト（`runAutoGrantsForUser` 等、Phase 1以降で追加）の方針をここで決めておく: テスト用DB（`docker-compose.yml` のPostgresを使い回すか専用のtest DBを分けるか）と、各テスト後のクリーンアップ方式（`$transaction` をコミットせずロールバックする／テストごとに関連テーブルをdeleteする）を決定し、Phase 1着手前にセットアップする。

#### 受け入れ基準

上記関数のテストがグリーン。CI（任意）で `npm run build` と `npm run test` が通る。

---

## Phase 1 — 自動付与バッチ

#### 目的

現状 `prisma/seed.ts` の手動生成のみである付与を、勤続年数マイルストーン到達時に `LeaveGrant`（`annual_auto`）として自動生成する。

#### 現状の活用資産

- `schedule.ts` の `getNextGrantMilestone` / `milestoneAtIndex` / `computeExpireDate` がすでに基準日と日数を算出できる。
- べき等性: マイグレーション `20260707..._add_spec_partial_unique_indexes` により `annual_auto` の `(user_id, granted_date)` 部分ユニークが既にある → 二重付与は DB 側で弾ける。

#### 実装ステップ

1. `prisma/seed.ts` の `listAutoGrantsSinceLaunch` は今回作る `planAutoGrants` とほぼ同じロジックの重複実装。`planAutoGrants` を `schedule.ts` に切り出した後、seed 側はそれを呼び出す形に置き換えてロジックを一本化する。
2. 純粋関数 `planAutoGrants(hireDate, asOf, systemLaunchDate)` を `schedule.ts` に追加。
   - `hireDate` 以降で `asOf`（＝実行日）までに到来したすべての `annual_auto` マイルストーンを列挙。
   - `SYSTEM_LAUNCH_DATE`（2024-01-01、seed と同一定数）より前の基準日はスキップ（稼働前履歴は作らない、CLAUDE.md の前提と一致）。現状 `prisma/seed.ts` にのみ定義されたローカル定数のため、共通モジュール（`schedule.ts` か新規 `src/lib/constants.ts`）に切り出し、seed からも本体コードからも同じ定数を参照する。
   - 返り値: `{ grantedDate, grantedDays, expireDate }[]`。`expireDate` は `computeExpireDate` を使用。
3. ミューテーション `runAutoGrantsForUser(userId, asOf)` を `src/lib/leave/mutations.ts`（または新規 `grants-mutations.ts`）に追加。
   - 在職中（`status = active`）のみ対象。退職者は対象外（`terminationDate` 以降は付与しない）。
   - `planAutoGrants` の結果を、既存付与に無いものだけ `createMany`（`skipDuplicates: true`）で挿入。
   - ユーザーの在職状態確認と `createMany` の挿入は同一の `prisma.$transaction` 内で行う（全フェーズ共通原則「書き込みは `$transaction` 内」との整合）。
   - `attendance_confirmed_*` は null のまま生成する（確認は人事がシステム外で実施。詳細は下記「論点」参照）。
4. 全社バッチ `runAutoGrantsForAllActiveUsers(asOf)` を追加（全 active ユーザーをループ）。
5. 実行トリガーを2系統用意（どちらか／両方）:
   - **管理者手動実行**: 社員一覧に「本日時点の付与を実行」ボタン。実行前に「誰に・いつ・何日付与されるか」のプレビューを出し、確認後に確定（`assertAdminForAction` でガード）。
   - **スケジュール実行**: 日次で `runAutoGrantsForAllActiveUsers(today)` を叩くジョブ（Vercel Cron / GitHub Actions / `node` スクリプト＋外部スケジューラのいずれか。ホスティング前提が固まってから選定）。
6. 画面反映: 付与直後に社員詳細の付与履歴・残日数に反映されることを確認（既存の `getEmployeeDetail` がそのまま拾う）。

#### 論点

出勤率8割の扱いは**案A（付与を先に作り、`attendance_confirmed_*` は後から人事が記録欄に埋める。残高には即カウント）に確定**。現行の残高ロジックを変えずに済み、記録欄の趣旨とも一致する。出勤率不良が事後判明した場合は、既存の「取消」導線（自己取消 or 管理者判断による個別対応）で足りるスコープと整理する。将来的に出勤率不良が発覚するケースが実運用で頻発するなら改めて検討する。

#### テスト

- `planAutoGrants`: 入社直後・6ヶ月経過・複数マイルストーン跨ぎ・稼働日前スキップ。（退職者除外は純粋関数の引数に退職情報が無いため対象外 — 下記 `runAutoGrantsForUser` 側でテストする）
- `runAutoGrantsForUser`: 二重実行してもレコードが増えないこと（べき等）。退職済みユーザーに対しては実行されない（対象外）こと。

#### 受け入れ基準

任意日付で実行 → 期待どおりの `annual_auto` 付与が生成され、再実行で重複しない。プレビュー内容と確定結果が一致（プレビュー後〜確定までの間に他プロセスが同一付与を挿入していた場合は `skipDuplicates` により無害にスキップされるため、確定処理は「挿入件数 / スキップ件数」を返し、プレビューとの差異があれば画面上で分かるようにする）。

---

## Phase 2 — 年5日取得義務の管理

#### 目的

年10日以上付与される社員について「基準日から1年で5日取得」の進捗を可視化し、未達をアラートする（労基法 改正 2019）。

#### 定義（spec.md に追記して確定させる）

- **義務対象**: その基準日で `annual_auto` 付与日数が10日以上の付与を受けた社員。
- **カウント期間**: 各基準日 `D` から `D + 1年 - 1日` まで（＝1年）。「現在の義務期間」は today を含む期間。終了日は「実在する次の `grantedDate`」からではなく、常に `D + 1年 - 1日` として計算する（自動付与バッチの実行漏れ・遅延があっても義務期間が不当に延びないようにするため）。
- **基準日の起算方法**: `hireDate` からの理論計算ではなく、実在する `LeaveGrant`（`grantType = annual_auto`）の `grantedDate` を実データから取得して基準日とする。自動付与バッチ未実行や退職などにより理論値と実データがズレるケースでも、常に実在する付与記録と整合する。
- **取得日数の数え方**: 対象期間内で `target_date <= asOf`（＝今日以前、実際に休んだ日）の approved な `LeaveRequest` の消化日数合計のみを「取得済み」としてカウントする（全休=1.0 / 半休=0.5）。`target_date > asOf` の承認済み申請（まだ休んでいない予定）は取得済みに含めず、「取得予定」として別枠で保持・表示する（時季指定だけでは実際の取得とみなさない）。時間単位年休は算入しない（Phase 4 で除外分岐を追加）。
- **残り義務・期限**: `max(0, 5 - 取得済み)` と、期限（＝当該義務期間の末日）。「取得予定」を加味すればあと何日で達成見込みかも合わせて出せるが、義務充足の判定自体は「取得済み」のみで行う。

#### 実装ステップ

1. 純粋関数を `src/lib/leave/annual-obligation.ts`（新規）に切り出す。
   - `getObligationPeriod(grants, asOf)`: 引数は `{ grantedDate, grantedDays }[]`（`annual_auto` の付与記録一覧。日数も渡さないと「10日以上」の対象判定ができないため）。現在の義務期間 `{ start, end, baseGrantDays }` を返す（`hireDate` は使わない。`end` は `start + 1年 - 1日`）。
   - `computeObligationStatus(takenDays, plannedDays, period)`: `{ required: 5, taken, planned, remaining, deadline, status: 'met'|'at_risk'|'behind' }`。
   - しきい値（例: 期限3ヶ月前で未達なら `at_risk`）は定数化。
2. クエリ `getAnnualObligation(userId)` を `queries.ts` に追加（対象ユーザーの `annual_auto` `LeaveGrant` の `{ grantedDate, grantedDays }[]` を取得 → 義務期間内の「取得済み(`target_date <= asOf`)」と「取得予定(`target_date > asOf`)」の approved 日数を分けて集計）。
3. 一覧の集計 `getEmployeeSummaries` を拡張し、`obligationRemaining` / `obligationDeadline` / `obligationStatus` を含める（既存の3クエリ構成を崩さずメモリ集計に追加）。
4. 画面:
   - 社員一覧に「年5日 残◯日（期限 YYYY/MM）」列を追加し、`behind`/`at_risk` は色分け・バッジ。
   - 社員詳細（マイページ）にも本人の進捗を表示。「取得済み◯日 / 取得予定◯日」を分けて表示。
   - （任意）管理者ダッシュボードに「未達◯名」サマリー。

#### テスト

- `getObligationPeriod`: `annual_auto` 付与記録が複数ある場合の基準日跨ぎ、10日未満付与（対象外）、付与記録がまだ無い（義務未開始）。
- `computeObligationStatus`: 0日/半休のみ/ちょうど5日/期限直前の `at_risk` 判定。取得済みと取得予定が混在するケースで、判定が「取得済み」のみに基づくこと。

#### 受け入れ基準

取得0の社員が `behind` 表示、5日取得（実績）で `met`。半休が0.5として正しく積算。未来日の承認済み予定だけでは `met` にならない。

---

## Phase 3 — 年次有給休暇管理簿の出力

#### 目的

労基法で作成・保存が義務の「年次有給休暇管理簿」を既存データから出力（基準日・取得日数・取得時季を記録）。保存期間は原則5年だが、経過措置により当分の間は3年。

#### 実装ステップ

1. データ整形クエリ `getLeaveLedger(userId, year)` を追加。1行＝1取得（`target_date`, 単位, 消化日数, 紐づく基準日）。approved（＋取り下げ済みも履歴として区別表示）を対象。
2. 出力形式:
   - **Excel**: 社員ごと×年度のシート。列＝基準日 / 付与日数 / 取得日 / 単位 / 取得日数 / 期末残。
   - **PDF**（任意）: 印刷・提出用の帳票レイアウト。
3. 導線: 社員詳細（管理者表示時）に「管理簿を出力」ボタン。年度セレクタ付き。認可は `requireSelfOrAdminPage` 相当＋出力は管理者に限定推奨。

#### 受け入れ基準

ある社員・年度で、取得履歴と一致する行が出力され、基準日・残日数が画面表示と突き合う。

---

## Phase 4 — 時間単位年休（最重量・最後に着手）

#### 目的

労使協定がある前提で、年5日を上限に時間単位で有給を取得可能にする。

#### 前提・論点（spec.md に大幅追記が必要）

- **1日=何時間か**を定義する必要（例: 所定労働8時間）。会社共通値 or 社員別。まずは会社共通の定数/設定から。
- 年5日上限（＝所定労働時間×5）を基準日ごとに管理。
- 時間単位取得分は**年5日取得義務にはカウントしない**（Phase 2 の集計から除外）。

#### データモデル変更

- `LeaveUnit` に時間単位を表す値を追加（例: `hourly`）＋ `LeaveRequest.hours`（Decimal, nullable）を新設。または単位はそのままに「取得時間」を持たせる設計。**推奨: `hourly` を追加し `hours` で時間数を保持**、消化日数は `hours / standardDailyHours` で算出。
- `LeaveGrant.grantedDays` / `LeaveConsumption.consumedDays` は現状 `Decimal(4,1)` であり、1時間刻み（所定8時間なら 0.125日刻み）を表現できない。`Decimal(6,3)` 等への型変更が必須（要マイグレーション＋既存データの影響確認）。
- 既存の部分ユニーク制約 `(user_id, target_date, unit)` は `unit = hourly` の場合、同日1件しか許さない設計になっている。同日に複数時間帯（午前2時間＋午後3時間等）の申請を許容するかを先に決め、許容するなら制約に時間帯（`start_time` 等）を組み込む再設計が必要。許容しない（1日1申請のまま、時間だけ可変）なら制約変更は不要。
- マイグレーション＋ `src/generated/prisma` の再生成（`npx prisma migrate dev`）。

#### ロジック変更点（影響範囲）

- `request-rules.ts`: `unitToDays` を時間対応に拡張。同一日の合計1.0日超過チェックに時間単位分を合算。時間単位の年5日上限チェックを新設。
- `balance.ts`: `planFefoConsumption` は現状 JS の `number`/`Math.min` ベースで小数の累積誤差対策が無い。Decimal計算への切り替え、または最小単位を分に統一する設計変更を前提に見積もる。
- `mutations.ts` `createLeaveRequest`/`approveLeaveRequest`: 時間→日数換算を通して消化。
- Phase 2 `annual-obligation.ts`: 時間単位分を取得日数集計から除外。
- 画面: 申請フォームに時間入力、履歴・管理簿の単位表示を拡張。

#### テスト

換算（例 4h=0.5日）、年5日（時間）上限、1日合計超過、FEFO 小数消化（Decimal精度の丸め誤差が出ないこと）、年5日義務からの除外。

#### 受け入れ基準

時間単位で申請・承認でき、残高が時間換算で正しく減り、年5日上限・1日上限が守られ、取得義務カウントに入らない。

---

## Phase 5 — 期間一括申請

#### 目的

「3日間まとめて休みたい」という意図を1回の操作で表現できるようにする。法令上の制約はなく（労基法は取得日数・単位を規定するのみで、申請UIの操作粒度は規定しない）、内部的には既存の「1申請＝1日」データモデルへ自動展開する設計判断の問題として扱う。

#### 現状の活用資産

- `checkNewRequest`（`request-rules.ts:16-31`）: 1日分の重複区分・1日超過チェックを行う純粋関数。無改修で、日ごとに複数回呼び出す形で流用する。
- 部分ユニーク制約 `leave_requests_active_user_id_target_date_unit_key`（`(user_id, target_date, unit)` かつ `status IN ('pending','approved')`）: 一括展開後も1レコード＝1日分なのでそのまま有効。追加のDB制約変更は不要。
- `planFefoConsumption`（`balance.ts`）: 1申請（1日分）ごとに呼ばれる設計のまま流用。承認は既存どおり1件単位で行い、バッチ承認はループで既存 `approveLeaveRequest` を複数回呼ぶだけにする。
- 申請作成時の advisory lock パターン（`pg_advisory_xact_lock(hashtext(userId), 日付のunix日数)`、`mutations.ts:26-27`）: 複数日をロックする形に自然に拡張できる。

#### データモデル変更

- `LeaveRequest` に `batchId String? @map("batch_id")` を追加（nullable、単日申請は `null` のまま）。`@@index([batchId])`。
- 既存の部分ユニーク制約 `(user_id, target_date, unit)` には含めない（重複禁止とbatch所属は独立した関心事）。
- Additiveなマイグレーションのみ（既存データへの影響なし）。

#### 実装ステップ

1. 純粋関数を `src/lib/date/calendar.ts`（既存の日付ユーティリティ群に追加）と新規 `src/lib/leave/date-range.ts` に切り出す。
   - `enumerateDatesUTC(start, end)`: 開始〜終了の日付一覧を返す（`calendar.ts`）。
   - `buildBulkRequestDates(start, end, { skipWeekends })`: 土日除外・上限日数チェック（暫定31日、定数化）を行う業務ロジック（`date-range.ts`）。
2. ミューテーション `createLeaveRequestBatch(input: { userId; dates: Date[]; unit: LeaveUnit })` を `mutations.ts` に追加。既存の `createLeaveRequest` をループ呼び出しするのではなく、新しい単一トランザクションを設計する（ループだと部分コミットが起き all-or-nothing を保証できないため）。トランザクション内:
   1. 入力 `dates` 内の重複日付を事前チェックし、重複があれば即エラー（`checkNewRequest` はDB上の既存申請しか見ないため、同一batch内の重複は検出できない。部分ユニーク制約に任せると不親切なエラーになるため）。
   2. 対象日を昇順ソートし、`createLeaveRequest` と同じキー空間で `pg_advisory_xact_lock(hashtext(userId), 日付のunix日数)` を順に取得（既存の単日ロックと直列化される）。
   3. `leaveRequest.findMany` で対象範囲の既存申請をまとめて取得。
   4. 各日について既存の `checkNewRequest`（無改修で流用）を呼び、1件でもNGなら該当日を含めたエラーで全体ロールバック（all-or-nothing。作成時点では残高チェックが無く失敗要因は重複のみのため、シンプルさを優先）。
   5. 全日OKなら `crypto.randomUUID()` で生成した `batchId`（サーバー側生成。クライアント入力は信用しない）を付与して `leaveRequest.createMany` で一括作成。
   6. `createMany` はID配列を返さないため、作成結果をUIに返す際は `batchId` で再取得する（Prisma 7.8.0のAPIを確認し、`createManyAndReturn` が使えるならそちらを優先）。
   - 単位は `full_day` 固定をサーバー側でも強制する（UI制限だけでは `unitToDays`/`checkNewRequest` が半休も正常処理してしまうため、`createLeaveRequestBatch` 内で `unit !== full_day` なら拒否する）。
   - 退職済みユーザーへの新規batch申請を防ぐため、ユーザーの `status = active` をトランザクション内で確認する（既存の単日 `createLeaveRequest` にも同じ穴があるが、少なくとも新設のbatch版には追加する）。
3. 既存 `approveLeaveRequest`（`mutations.ts:128-186`）にユーザー単位の advisory lock を追加する（既存の並行性バグの修正を兼ねる。詳細は下記「論点」参照）。トランザクション冒頭で `pg_advisory_xact_lock(hashtext(userId), 承認処理専用の固定キー)` を取得し、同一ユーザーへの同時承認を直列化する。既存の単体承認フローにも適用される修正。
4. 新規 `approveLeaveRequestBatch(batchId, reviewerId)` / `rejectLeaveRequestBatch(batchId, reviewerId, reason)` を `mutations.ts` に追加。該当 `batchId` の pending な `requestId` を `targetDate` 昇順で取得し、既存の `approveLeaveRequest`/`rejectLeaveRequest`（ロック追加済み）を1件ずつループで呼ぶ（1件=1トランザクションのまま）。戻り値 `{ succeeded: requestId[], failed: { requestId, reason }[] }`。退職処理がループ途中に割り込んだ場合（`RequestNotPendingError` 等）も `failed` として扱い、ループを継続する。
5. UI: 申請フォーム（`leave-request-form.tsx`）に「1日ずつ申請」（既存）と「期間でまとめて申請」の2モード切り替えを追加。期間モード: 開始日・終了日入力 → 土日除外チェックボックス（デフォルトON）→ 対象日プレビュー（曜日ラベル付き、個別に除外可能）→「まとめて申請する」で確定。
6. UI: 社員詳細の申請履歴で `batchId` を持つ行をグループ表示。pending中は本人が「まとめて取消」できるボタンを追加。管理者は既存の1件ずつの承認/却下UIに加え、`batchId` を持つpending申請が複数ある場合のみ「まとめて承認/却下」ボタンを追加表示する。

#### 論点

- **既存の並行性バグへの対応をスコープに含める**: `approveLeaveRequest` は残高を読んで消費を書き込む処理をするにもかかわらず、`createLeaveRequest` と違いユーザー単位のロックを取得していなかった。PostgreSQLのデフォルト分離レベルでは、2人の管理者が同時に同じ社員の別々の申請を承認すると、両方が同じ残高スナップショットを読んで残高を超えて二重消費しうる。一括承認をループ実装するとこのリスクが顕在化しやすいシナリオが増えるため、Phase 5でロックを追加し既存バグごと修正する。
- **作成フェーズ＝全体ロールバック、承認フェーズ＝部分成功許容という非対称設計を採用**: 承認は日ごとに独立した残高消費（FEFO）を伴うため、途中の日で残高不足が起きうる。この場合、それ以前に承認済みの日はそのまま確定し、以降はpendingに残す。UI上、「まとめて承認」ボタンの挙動は「日別承認の連続実行であり、途中で残高不足になった場合はそこまでの分が確定する」旨を明示する文言にする（一括申請=全部作成、一括承認=一部だけ通る、という非対称性はUIで説明しないと混乱を招くため）。
- 半休を範囲指定に含めない制約はv1スコープ限定。将来「範囲内の最終日だけ半休にしたい」等のニーズが出た場合は個別に単日モードで追加申請する運用で当面吸収する。
- 土日はデフォルト除外オプション（UI上の便利機能）。祝日は会社カレンダー未実装のためプレビュー画面での目視確認に委ねる。「休日を保証的に除外する」機能ではなく便利機能である旨をUI文言・spec.mdで明確にする（`spec.md` §9は「勤務日適格性は本システムでは保証しない」と明記しており、誤解を招く見せ方を避ける）。

#### テスト

- 純粋関数: `enumerateDatesUTC`（開始=終了、逆順入力のエラー、複数日）、`buildBulkRequestDates`（土日除外ON/OFF、上限超過）。
- `createLeaveRequestBatch`: 同一batch内重複日付の検出、範囲内1日の既存申請による全体ロールバック（1件も作成されないこと）、退職済みユーザーでの拒否、半休指定の拒否。
- `approveLeaveRequest`（ロック追加後）: 同一ユーザーへの同時承認2件がシリアライズされ、残高が二重消費されないことの回帰テスト。
- `approveLeaveRequestBatch`: 途中残高不足での部分成功（それ以前の日は承認済みのまま・以降はpendingに残る）、`succeeded`/`failed` の戻り値検証。
- 回帰: Phase 2 の `getAnnualObligation` が、一括作成・一括承認された申請を単日申請時と同一の集計結果で扱うこと（`target_date` ベースであるため無改修で成立することの確認）。

#### 受け入れ基準

開始日・終了日（+土日除外）指定→プレビュー表示→一括作成が1トランザクションで行われ、重複があれば1件も作成されずエラーに該当日が示される。社員詳細で一括申請がグループ表示され、pending中は「まとめて取消」ができる。管理者は個別承認/却下に加え「まとめて承認/却下」ができ、部分成功時は成功・失敗件数と理由がUIに表示される。同一ユーザーへの同時承認（単発同士・単発とbatch・batch同士）で残高が二重消費されないことをテストで確認できる。既存の単日申請フロー・`checkNewRequest`・部分ユニーク制約・`planFefoConsumption` は無改修で両立し、既存の回帰テストが通り続ける。

---

## 横断タスク（各フェーズで随時）

- `spec.md` の該当節を更新し「正式仕様＝spec.md」を保つ（CLAUDE.md の原則）。
- `prisma/seed.ts` に各フェーズのQAシナリオ社員を追加（年5日未達・時間単位取得など）。
- 変更した純粋関数・ミューテーションのテストを同フェーズ内で追加。
- 認可（`guards.ts`）と `assertAdminForAction` の付け忘れが無いかレビュー。
- **既知の仕様書内矛盾**: `spec.md:199` は `LeaveConsumption.cancelled_at` を「取消・退職時自動取消**等**により無効化された日時」と説明しているが、実装（`terminateEmployee`）は退職時自動取消では `LeaveConsumption` に一切触れず `cancelled_at` を更新しない（CLAUDE.md にも明記された意図的仕様）。Phase 2/3 で `cancelled_at` をデータソースとして扱う前に、`spec.md` 側の文言を実装に合わせて訂正しておく。
- Phase 5 着手時: `spec.md` §6-2・§9 の「複数日をまとめて1回で申請する『期間一括申請』は将来の拡張候補とする」という記述を、実装済み機能として書き換える。

---

## マイルストーン提案（全フェーズ完了）

1. ✅ Phase 0 完了（テスト土台）
2. ✅ Phase 1 完了（自動付与が本番運用可能に）→ 手動実行ボタン + Vercel Cron の両方で運用可能
3. ✅ Phase 2 完了（年5日管理）→ コンプライアンス上の最大価値
4. ✅ Phase 3 完了（管理簿出力）
5. ✅ Phase 4 完了（時間単位年休）
6. ✅ Phase 5 完了（期間一括申請）→ 既存の承認処理の並行性バグ修正も含む

---

## 次アクション候補

Phase 0〜5 はすべて実装・コミット済み。本ドキュメントの実装計画としての役割は完了。追加の改善要望は `todo/improvement-ideas.md` 側で管理する。

**確定済みの論点**:

- 出勤率確認の扱い → 案A（即算入）
- 年5日義務の「取得済み」判定 → 実績のみ（`target_date <= asOf` の approved 分）。未来日の承認済みは取得予定として別枠。
- 年5日義務期間の起算 → 実在する `LeaveGrant.grantedDate` 基準（`hireDate` からの理論計算はしない）。
- 期間一括申請（Phase 5）→ 内部的に日ごとの `LeaveRequest` へ自動展開する方式で実装。既存の `approveLeaveRequest` の並行性バグ修正をスコープに含める。
- 付与バッチの実行方式 → 手動・スケジュール実行の両方を実装。管理者手動実行ボタン（`AutoGrantPanel`、プレビュー→確定の2段階）に加え、`vercel.json` の Vercel Cron 設定（日次 `0 0 * * *`）から `src/app/api/cron/auto-grants/route.ts` を呼ぶ。cronエンドポイントは `CRON_SECRET` による `Authorization: Bearer` 認証（`crypto.timingSafeEqual` で比較、未設定時は常に拒否）。
- 時間単位年休の「1日=時間数」の基準値 → 所定労働8時間で会社共通固定（社員ごとの個別設定はスコープ外）。`STANDARD_DAILY_HOURS = 8`（`request-rules.ts`）。8時間固定＋整数時間入力の組み合わせでのみ浮動小数点演算の丸め誤差なしが保証されるため、この前提を崩す変更（分単位対応等）にはDecimal演算への見直しが必要（spec.md 5.4参照）。
- 時間単位年休で同日複数申請を許容するか → 許容しない。同一日に1件までとし、既存の部分ユニーク制約 `(user_id, target_date, unit)` は無改修で流用（spec.md 5.4参照）。

**未決の論点**: なし（Phase 0〜5 完了時点ですべて確定済み）。
