import { format } from "date-fns";

import { importCsvAction } from "@/app/actions";
import { Card, SectionHeading } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { getImportsOverview } from "@/lib/crm";
import { getUserCapabilities } from "@/lib/user-privileges";
import { redirect } from "next/navigation";

export default async function ImportsPage() {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewImports) {
    redirect("/");
  }
  const batches = await getImportsOverview();

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Bulk Import"
        title="Bring legacy CSV history into the CRM safely."
        text="Upload your existing call spreadsheets, preserve raw source rows, match clients by normalized phone, and keep review flags where the data needs human confirmation."
      />

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Upload CSV</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">Historical import workflow</h3>
          {caps.canRunImports ? (
          <form action={importCsvAction} className="mt-6 grid gap-4">
            <input
              type="file"
              name="file"
              required
              accept=".csv,text/csv"
              className="rounded-3xl border border-dashed border-[#d7e5f5] bg-[#fbfdff] px-4 py-4 text-sm text-slate-600"
            />
            <div className="crm-soft-row rounded-[22px] p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-900">Expected columns (Car Systems Calls export)</p>
              <p className="mt-2">
                <span className="font-medium text-slate-800">Date</span>,{" "}
                <span className="font-medium text-slate-800">Time</span>,{" "}
                <span className="font-medium text-slate-800">Number</span>,{" "}
                <span className="font-medium text-slate-800">Name</span>,{" "}
                <span className="font-medium text-slate-800">Vehicle</span>,{" "}
                <span className="font-medium text-slate-800">Product</span>,{" "}
                <span className="font-medium text-slate-800">Price</span>,{" "}
                <span className="font-medium text-slate-800">Call backs</span>,{" "}
                <span className="font-medium text-slate-800">Extra comments…</span>,{" "}
                <span className="font-medium text-slate-800">Found us through</span>.
              </p>
              <p className="mt-2">UTF-8 and Excel dates like 3/2/2026 with times like 10:10:36 AM are supported.</p>
              <p className="mt-2">Phones are normalized for matching; new rows create a client, vehicle, opportunity, and inbound call log.</p>
              <p className="mt-2">Extra-comments column is stored as client notes and call internal notes only — not shown to customers.</p>
            </div>
            <button className="rounded-2xl bg-[#1e5ea8] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17497f]">
              Import selected CSV
            </button>
          </form>
          ) : (
            <p className="mt-6 text-sm leading-6 text-slate-600">
              Your account can review import batches but not upload new files. Ask an administrator if you need import
              access.
            </p>
          )}
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Recent batches</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">Traceable source data and row review</h3>
          <div className="mt-6 space-y-5">
            {batches.map((batch) => (
              <div key={batch.id} className="crm-soft-row rounded-[22px] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{batch.fileName}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {format(batch.createdAt, "MMM d, yyyy h:mm a")} by {batch.uploadedBy.name}
                    </p>
                  </div>
                  <div className="crm-badge">{batch.status}</div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-[#fbfdff] px-4 py-3 text-sm text-slate-600">
                    Rows: {batch.rowCount}
                  </div>
                  <div className="rounded-2xl bg-[#fbfdff] px-4 py-3 text-sm text-slate-600">
                    Imported: {batch.importedCount}
                  </div>
                  <div className="rounded-2xl bg-[#fbfdff] px-4 py-3 text-sm text-slate-600">
                    Review: {batch.reviewCount}
                  </div>
                </div>
                <div className="crm-table-shell mt-4">
                  <table className="min-w-full text-left text-xs text-slate-600">
                    <thead className="crm-table-head text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-medium">Row</th>
                        <th className="px-3 py-3 font-medium">Phone</th>
                        <th className="px-3 py-3 font-medium">Status</th>
                        <th className="px-3 py-3 font-medium">Warning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.map((row) => (
                        <tr key={row.id} className="crm-table-row">
                          <td className="px-3 py-3">{row.rowNumber}</td>
                          <td className="px-3 py-3">{row.normalizedPhone || "Unknown"}</td>
                          <td className="px-3 py-3">{row.status}</td>
                          <td className="px-3 py-3">{row.warning || "None"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
