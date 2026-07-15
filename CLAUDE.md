# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際に Claude Code (claude.ai/code) へのガイダンスを提供するものです。

## リポジトリの状況

実装は開始済み。技術スタック:

- **フレームワーク**: Next.js 16 (App Router) + TypeScript, Tailwind CSS
- **ORM / DB**: Prisma 7 (driver adapter: `@prisma/adapter-pg`) + PostgreSQL、`docker-compose.yml` でローカル起動
- **認証**: NextAuth.js (Auth.js) v5, Credentials provider, JWT セッション, `bcryptjs` によるパスワードハッシュ化

認証基盤と spec.md セクション4の3画面(社員一覧, 社員詳細, 社員管理画面)は実装済みで、セクション5〜7のビジネスロジック(付与残高計算, FEFO消費, 申請/承認/却下/取消フロー, 退職時自動処理)およびセクション8のサーバーサイド認可も含まれる。

`todo/implementation-plan.md` の Phase 0〜5 はすべて実装済み: テスト基盤(Phase 0)、有給自動付与バッチ(Phase 1、手動実行ボタン + Vercel Cron の両方)、年5日取得義務の管理(Phase 2)、年次有給休暇管理簿のExcel出力(Phase 3)、時間単位年休(Phase 4)、期間一括申請(Phase 5、既存の承認処理の並行性バグ修正込み)。

### 主要ファイル
- `prisma/schema.prisma` — データモデル。spec.md セクション7に対応(User, LeaveGrant, LeaveRequest, LeaveConsumption)
- `prisma/seed.ts` — シード管理者ユーザーと、各手動QAシナリオを網羅するテスト社員一式を作成する(詳細はスクリプト内コメント参照)。全ログインのパスワードは `password1234`。システムは `SYSTEM_LAUNCH_DATE` (2024-01-01) 以降本番稼働している前提であり — LeaveGrant/LeaveRequest レコードは、`hireDate` がそれより前の社員であっても常にこのエポック以降の日付のみを持つ(稼働開始前の履歴はシステムに存在しないものとして扱う)。シードされる各社員の `annual_auto` 付与はすべて `hireDate` から `getNextGrantMilestone`/`createAutoGrantLedger` により純粋に生成されており(手打ちではない)、そのため一部の社員では特に作為なく、最初の稼働後マイルストーンが「今日」より前の日付になる結果、既に失効した付与を自然に持つことになる。過去の承認済み申請は、アプリ自体が使用するのと同じ `planFefoConsumption`/`isGrantActive` ロジック(`ledger.consumeApproved`)を通して処理されるため、シードされた消費レコードが実際のビジネスロジックと乖離することはない。唯一の意図的な例外は `fefo-test@example.com` で、実際の自動生成付与に加えて手作りの `grant_type: special` 付与(0.5日分, `ledger.addSpecialGrant` 経由)を1件追加している — 法定最低日数(10日)では FEFO 分割消費を示すのに必要な「残りわずかな付与」を再現できないため、この1件だけは意図的に作為的なデータとなっている。退職済み社員については、台帳の `throughDate` は「今日」ではなく退職日となる(退職後は付与が積み上がらないため)。ユーザーごとの有給データは実行の都度削除・再作成される(`resetLeaveData`、存在すればスキップではない)ため、再シードは常に同じ正規のデータセットに収束する。
- `src/auth.config.ts` — edge 対応の NextAuth 設定(ルート保護ミドルウェアである `src/proxy.ts` から使用される)
- `src/auth.ts` — フル版の NextAuth 設定(Credentials provider + Prisma)。API ルートとサーバーコンポーネントから使用される
- `src/lib/prisma.ts` — Prisma クライアントのシングルトン(`pg` driver adapter で構築 — Prisma 7 の新クライアントジェネレーターは単なる接続文字列ではなく adapter を要求する)
- `src/proxy.ts` — Next.js 16 で `middleware.ts` が `proxy.ts` にリネームされたもの。未認証リクエストを `/login` にリダイレクトする(`/api/cron/*` は `CRON_SECRET` による Route Handler 内認証のため対象外)
- `src/lib/auth/guards.ts` — 全ページ・全 Server Action で使用されるサーバーサイド認可(`requireAdminPage`, `requireSelfOrAdminPage`, `assertAdminForAction` など) — spec.md セクション8は `src/proxy.ts` だけでなく各ルート個別にこれを要求している
- `src/lib/date/calendar.ts` — 日付ユーティリティ(`toUtcMidnight`, `startOfTodayUTC`, `enumerateDatesUTC` など)。他の純粋関数群から共通で参照される
- `src/lib/leave/schedule.ts` — 付与スケジュールの純粋関数(`getNextGrantMilestone`, `computeExpireDate`, 自動付与バッチ用の `planAutoGrants` など。`SYSTEM_LAUNCH_DATE` 定数もここ)
- `src/lib/leave/balance.ts`, `request-rules.ts` — FEFO残高計算(`planFefoConsumption`)、重複/超過申請チェック(`checkNewRequest`)。`request-rules.ts` には時間単位年休の上限チェック(`checkHourlyCap`)も含む
- `src/lib/leave/annual-obligation.ts`(Phase 2) — 年5日取得義務の義務期間算出(`getObligationPeriods`)・充足判定(`computeObligationStatus`)の純粋関数群
- `src/lib/leave/grant-mutations.ts`(Phase 1) — 自動付与バッチの本体。`runAutoGrantsForUser` / `runAutoGrantsForAllActiveUsers` を提供し、社員一覧の手動実行ボタン(`src/app/employees/auto-grant-panel.tsx`)と `src/app/api/cron/auto-grants/route.ts` の両方から呼ばれる
- `src/lib/leave/ledger-excel.ts`(Phase 3) — 年次有給休暇管理簿のExcelワークブック生成(`buildLeaveLedgerWorkbook`, `exceljs` 使用)。`src/app/api/employees/[id]/leave-ledger/route.ts` から呼ばれる
- `src/lib/leave/date-range.ts`(Phase 5) — 期間一括申請の対象日展開(`buildBulkRequestDates`)。上限日数チェックはこの関数では行わず呼び出し側の責務(`MAX_BULK_REQUEST_DAYS`)
- `src/lib/leave/queries.ts`, `src/lib/leave/mutations.ts` — 有給申請・付与に対する Prisma の読み取り/書き込み層(mutation は `$transaction` 内で実行)。`mutations.ts` には単日申請(`createLeaveRequest`/`approveLeaveRequest`/...)に加え、期間一括申請用の `createLeaveRequestBatch`/`approveLeaveRequestBatch`/`rejectLeaveRequestBatch`/`cancelLeaveRequestBatch` も含む。`approveLeaveRequest` はトランザクション冒頭でユーザー単位の advisory lock(`pg_advisory_xact_lock(hashtext(userId + ':approve'), 0)`)を取得し、同一ユーザーへの同時承認による残高二重消費を防いでいる
- `src/lib/employees/mutations.ts` — `createEmployee` / `updateEmployee`(LeaveGrant が存在する社員は hire_date が変更不可であることを強制) / `terminateEmployee`(セクション4.4の自動却下/自動取消ルールを実装)
- `src/app/employees/` — 社員一覧 (`page.tsx`。自動付与バッチの手動実行パネル `auto-grant-panel.tsx` を含む)、社員詳細/マイページ (`[id]/page.tsx`)、社員管理 (`new/`, `[id]/edit/`)。各ルートには同じ場所に配置された `actions.ts` があり、その画面用の Server Actions を含む。`[id]/page.tsx` の有給取得履歴テーブルは `?year=YYYY` の検索パラメータによる年別フィルタリングに対応している(年タブは、その社員の申請に含まれる年の重複なし一覧から導出されるため、別途クエリやインデックスは不要)。同ページには期間一括申請用の「一括申請」セクション(`batch-action-buttons.tsx`)も別ブロックとして存在し、既存の個別行操作とは排他ではなく共存する
- `src/app/api/cron/auto-grants/route.ts` — Vercel Cron から日次で呼ばれる自動付与バッチのエンドポイント。`Authorization: Bearer $CRON_SECRET` を `crypto.timingSafeEqual` で検証(`vercel.json` の `crons` 設定と対応)
- `src/app/api/employees/[id]/leave-ledger/route.ts` — 年次有給休暇管理簿のExcelダウンロードエンドポイント

### コマンド
```
docker compose up -d       # ローカル PostgreSQL を起動
npx prisma migrate dev     # スキーマ変更を適用
npx prisma db seed         # シード管理者ユーザー + テスト社員を(再)作成
npm run dev                # 開発サーバーを起動 (http://localhost:3000)
npm run build              # 本番ビルド(型チェックも兼ねる)
npm run lint                # ESLint
```

### 補足
- `.env` にはローカルのシークレット(`DATABASE_URL`, `AUTH_SECRET`)が入っており gitignore 対象。想定される形式は `.env.example` に記載。
- `LeaveConsumption.cancelledAt` は、承認済み申請の自己取消により残高が復元される際にセットされる(`src/lib/leave/mutations.ts` の `withdrawApprovedLeaveRequest`)が、退職時の自動取消では意図的に `null` のまま残す(この場合は残高は復元されない) — spec.md セクション4.3/6/9参照。

## 仕様のソース・オブ・トゥルース

[spec.md](spec.md) が正式な機能仕様書である。実装を提案する前に必ず読むこと — ユーザーロール、画面、有給の付与/失効ルール、申請/承認フロー、概念レベルのデータモデルを定義している。仕様に組み込まれており、どの実装でも遵守すべき主要な決定事項:

- ロールは2種類のみ: 管理者(全社員へのフルアクセス)と社員(自分のデータのみ)。認可は UI で隠すだけでなくサーバーサイドで強制しなければならない(spec.md セクション8)。
- 有給の付与は労働基準法に厳密に従う: 勤続年数に基づく自動付与スケジュール、2年での失効、パートタイム職員への比例付与なし(spec.md セクション5, 9)。
- 有給の単位は全休(1日)、半休(0.5日、午前/午後)、時間単位(1〜8時間の整数、所定労働8時間固定で日換算)の3種類(spec.md セクション5.3〜5.4, 6)。時間単位年休は年5日取得義務の算定には含めない(spec.md セクション5.5)。
- 1申請 = 1日(全休/半休/時間単位のいずれか)が基本単位。ただし「期間一括申請」(spec.md セクション6)により、開始日・終了日・土日除外指定から全休のみの複数日申請をまとめて作成できる(内部的には日ごとの `LeaveRequest` に自動展開され、`batch_id` で束ねられる。作成は全体ロールバック、承認/却下/取消は部分成功を許容する非対称設計)。
- メール通知なし — ステータス変更はアプリ内 UI の状態としてのみ表示される(spec.md セクション8)。
- 技術スタック(フロントエンド/バックエンドのフレームワーク、データベース)は仕様上あえて未確定としており、その選択は実装フェーズに委ねられている。

## リポジトリ構成に関する注意

このディレクトリで `git rev-parse --show-toplevel` を実行すると、ユーザーのホームディレクトリ(`temple` という名前の別の git リポジトリで、現在の環境からは認証できないリモートを持つ)が返る。このプロジェクトディレクトリ(`Cloude&Codex/employee-leave-app/`)を作業対象範囲として扱い、ホームディレクトリの他の場所への変更をこのプロジェクトに関連するものと想定しないこと。

`Cloude&Codex/` 配下には他にも複数のプロジェクトが並行して置かれる想定であるため、このプロジェクトの作業はすべて `employee-leave-app/` の中で完結させること。

## コミット・プッシュに関するルール

`git commit` または `git push` を実行する場合は、実行前に必ずユーザーに確認を取ること。ユーザーからの明示的な許可なく、これらのコマンドを実行してはならない。

## 実装レビューのルール

実装計画の策定時、および実装後のコードレビュー時には、Codex(`codex exec` または `codex:codex-rescue` エージェント経由)とレビューを相互に行うこと。指摘事項(特に must-fix)を解消し、レビューで新たな重大な指摘が出なくなるまで詰めてからユーザーに実装着手・コミットの確認を取る。
