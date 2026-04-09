"use client";

import { openCallFromHistoryAction } from "@/app/actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CallHistoryOpenLogButton({
  callLogId,
  disabled,
}: {
  callLogId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const fd = new FormData();
            fd.set("callLogId", callLogId);
            const r = await openCallFromHistoryAction(fd);
            if (r.ok) {
              router.push(r.href);
            } else {
              setMessage(r.message);
            }
          });
        }}
        className="rounded-xl bg-[#1e5ea8] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#17497f] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Opening…" : "Open log"}
      </button>
      {message ? <p className="max-w-[200px] text-right text-xs text-red-600">{message}</p> : null}
    </div>
  );
}
