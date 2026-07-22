## 有給休暇管理アプリ

社員の有給休暇の付与・申請・承認を管理する社内向けアプリです。仕様の正式なソース・オブ・トゥルースは [doc/spec.md](doc/spec.md) を参照してください。

- **フレームワーク**: Next.js 16 (App Router) + TypeScript, Tailwind CSS
- **ORM / DB**: Prisma 7 (driver adapter: `@prisma/adapter-pg`) + PostgreSQL
- **認証**: NextAuth.js (Auth.js) v5, Credentials provider

## セットアップ(リポジトリを clone した直後の手順)

開発環境は Docker Compose で完結します。ホストに Node.js をインストールする必要はありません(Docker Desktop 等、Docker Compose が使える環境のみ必要です)。

1. リポジトリを clone する

   ```bash
   git clone <このリポジトリのURL>
   cd employee-leave-app
   ```

2. 環境変数ファイルを作成する

   ```bash
   cp .env.example .env
   ```

   `.env` の `AUTH_SECRET` / `CRON_SECRET` は `openssl rand -base64 32` などで生成した値に書き換えてください(`DATABASE_URL` は `docker-compose.yml` のデフォルト値と一致しているのでそのままで動作します)。

3. DB + アプリを起動する(初回はイメージビルドも実行されます)

   ```bash
   docker compose up -d --build
   ```

4. マイグレーションを適用し、シードデータ(管理者ユーザー + テスト社員一式)を投入する

   ```bash
   npm run docker:migrate
   npm run docker:seed
   ```

5. ブラウザで [http://localhost:3000](http://localhost:3000) を開く

   ソースは bind mount されているため、ホスト側でコードを編集するとコンテナ内の `next dev` に即座に反映されます(ホットリロード)。

### ログイン情報(シード投入後)

いずれもパスワードは `password1234`。各アカウントの詳細は `prisma/seed.ts` のコメントを参照してください。

- `admin@example.com` — 管理者(2024〜2025年の取得履歴あり)
- `admin2@example.com` — 管理者(2024〜2026年の取得履歴あり)
- `newcomer@example.com` — 入社直後の社員
- `expired-grant@example.com` — 失効枠ありの社員
- `fefo-test@example.com` — FEFO分割消費の検証用(pending申請あり)
- `rejected-cancelled@example.com` — 却下・取消履歴ありの社員
- `hourly-test@example.com` — 時間単位年休の取得履歴あり
- `terminated@example.com` — 退職済み(ログイン不可)

## よく使うコマンド

```bash
docker compose up -d --build   # DB + アプリを起動
npm run docker:migrate         # スキーマ変更を適用
npm run docker:seed            # シードデータを(再)作成
npm run docker:logs            # アプリのログを追跡
npm run docker:test            # テスト実行(vitest)
npm run docker:lint            # ESLint
npm run docker:rebuild         # package-lock.json 更新後など、依存関係を入れ直したいとき
npm run docker:sh              # アプリコンテナに shell で入る
docker compose down            # 停止(DBデータは volume に残る)
```

より詳細な内部構成・実装状況は [CLAUDE.md](CLAUDE.md) を参照してください。
