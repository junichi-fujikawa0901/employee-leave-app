# 設計書 概要

このディレクトリは、現在の実装内容を基に作成した設計書一式を格納する。仕様の一次情報源は引き続き `spec.md`(同ディレクトリ内)であり、ここに置く設計書は「spec.md の要求を、実際のコードがどう実現しているか」を記述したものである。実装が spec.md と異なる判断をした箇所は、その理由も明記する。

## ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [01-architecture.md](01-architecture.md) | 技術スタック、レイヤ構成、ディレクトリ構成、認証まわりのファイル分割、リクエストフロー |
| [02-database.md](02-database.md) | ER図、テーブル定義、enum一覧、インデックスと未実装の制約 |
| [03-business-logic.md](03-business-logic.md) | 有給付与スケジュール、失効判定、FEFO消化ロジック、申請ルール、退職時自動処理 |
| [04-authorization.md](04-authorization.md) | ロール定義、認可ガード関数、アクセス制御マトリクス |
| [05-screens.md](05-screens.md) | 画面ごとの表示項目・操作・呼び出すServer Action一覧 |

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) + TypeScript, Tailwind CSS
- **ORM / DB**: Prisma 7(driver adapter: `@prisma/adapter-pg`)+ PostgreSQL、`docker-compose.yml` でローカル起動
- **認証**: NextAuth.js (Auth.js) v5, Credentials provider, JWT セッション, `bcryptjs` によるパスワードハッシュ化

## 実装状況

- 認証基盤、spec.md セクション4の3画面(社員一覧・社員詳細・社員管理画面)、セクション5〜7の業務ロジック(付与残高計算・FEFO消費・申請/承認/却下/取消フロー・退職時自動処理)、セクション8のサーバーサイド認可は実装済み。
- **未実装**: 有給自動付与のバッチ処理(spec.md セクション5)。勤続年数に基づく `LeaveGrant` レコードは現状 `prisma/seed.ts` による手動シードのみで、スケジュールジョブや管理者操作による自動生成は無い。
