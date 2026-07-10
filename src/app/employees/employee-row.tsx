"use client";

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
