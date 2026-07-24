"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function EmployeeRow({
  href,
  highlighted,
  children,
}: {
  href: string;
  highlighted?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <tr
      onClick={() => router.push(href)}
      className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-100 ${
        highlighted ? "bg-yellow-50" : ""
      }`}
    >
      {children}
    </tr>
  );
}

/** モバイル(md未満)向けのカード表示。Linkベースのためキーボード操作・スクリーンリーダーでも遷移可能 */
export function EmployeeCard({
  href,
  highlighted,
  children,
}: {
  href: string;
  highlighted?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-lg border p-4 shadow-sm ${
        highlighted ? "border-yellow-300 bg-yellow-50" : "border-gray-200 bg-white"
      }`}
    >
      {children}
    </Link>
  );
}
