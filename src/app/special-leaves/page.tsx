import { isAdmin, requireSession } from "@/lib/auth/guards";
import { startOfTodayUTC } from "@/lib/date/calendar";
import {
  getPendingSpecialLeaveRequests,
  getSpecialLeaveRequestsForUser,
  getSummerLeaveUsage,
} from "@/lib/special-leave/queries";

import { PendingSpecialLeaveList } from "./pending-special-leave-list";
import { SpecialLeaveRequestForm } from "./special-leave-request-form";
import { SpecialLeaveRequestList } from "./special-leave-request-list";

/** 特別休暇(慶弔・産前産後・育児・夏季)の申請・承認画面。有給とは独立した記録 */
export default async function SpecialLeavesPage() {
  const session = await requireSession();
  const viewerIsAdmin = isAdmin(session);
  const currentYear = startOfTodayUTC().getUTCFullYear();

  const [myRequests, summerUsage, pendingRequests] = await Promise.all([
    getSpecialLeaveRequestsForUser(session.user.id),
    getSummerLeaveUsage(session.user.id, currentYear),
    viewerIsAdmin ? getPendingSpecialLeaveRequests() : Promise.resolve([]),
  ]);

  const pendingForOthers = pendingRequests.filter((request) => request.userId !== session.user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">特別休暇</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      <SpecialLeaveRequestForm summerRemainingDays={summerUsage.remainingDays} />

      {viewerIsAdmin && <PendingSpecialLeaveList items={pendingForOthers} />}

      <SpecialLeaveRequestList items={myRequests} />
    </div>
  );
}
