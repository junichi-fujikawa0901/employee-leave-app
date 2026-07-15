import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // integration.test.ts群は開発用の実Postgres DBを共有しているため、
    // ファイル単位の並列実行を無効化する(並列実行すると全active userを
    // 対象にするgrant-mutations.integration.test.ts等が他ファイルの
    // 一時ユーザー作成/削除と競合し、断続的に失敗する)
    fileParallelism: false,
  },
});
