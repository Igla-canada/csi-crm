import { Card, SectionHeading } from "@/components/app-shell";
import { LogCallForm } from "@/components/log-call-form";
import { getCurrentUser } from "@/lib/auth";
import { getCallResultOptions, getLeadSourceOptions, getProductServiceOptions } from "@/lib/crm";
import { parseCallDirectionSearchParam } from "@/lib/call-direction-search-param";
import { getTorontoNowDatetimeLocalValue } from "@/lib/toronto-datetime-input";
import { getUserCapabilities } from "@/lib/user-privileges";
import { redirect } from "next/navigation";

function firstParam(v: string | string[] | undefined): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return x?.trim() ? x : undefined;
}

type CallsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CallsPage({ searchParams }: CallsPageProps) {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    redirect("/");
  }

  const sp = (await searchParams) ?? {};
  const liveLogPrefill =
    firstParam(sp.liveLog) === "1"
      ? {
          phone: firstParam(sp.phone),
          contactName: firstParam(sp.contactName),
          direction: parseCallDirectionSearchParam(firstParam(sp.direction)),
          clientId: firstParam(sp.clientId),
        }
      : null;

  const defaultTorontoTime = getTorontoNowDatetimeLocalValue();
  const [callResultOptions, productServiceOptions, leadSourceOptions] = await Promise.all([
    getCallResultOptions(),
    getProductServiceOptions(true),
    getLeadSourceOptions(true),
  ]);

  const logCallResultOptions = callResultOptions.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    active: Boolean(o.active),
    accentKey: (o as { accentKey?: string }).accentKey ?? null,
    accentHex: (o as { accentHex?: string | null }).accentHex ?? null,
  }));

  const logProductOptions = productServiceOptions.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    matchTerms: String((o as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(o.active),
  }));

  const logLeadSourceOptions = leadSourceOptions.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    active: Boolean(o.active),
  }));

  const callFormOrReadOnly = caps.canLogCalls ? (
    <LogCallForm
      defaultHappenedAt={defaultTorontoTime}
      callResultOptions={logCallResultOptions}
      productServiceOptions={logProductOptions}
      leadSourceOptions={logLeadSourceOptions}
      liveLogPrefill={liveLogPrefill}
    />
  ) : (
    <p className="mt-4 text-sm leading-6 text-slate-600">
      Open <span className="font-medium text-slate-800">Clients</span> and choose a customer to see their call
      timeline. Ask an administrator if you need permission to log new calls.
    </p>
  );

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Log a Call"
        title={caps.canLogCalls ? "Add the call you just handled" : "Calls"}
        text={
          caps.canLogCalls
            ? "Use this page to save what was discussed, what the result was, and whether someone needs a callback."
            : "You can review call history on client profiles. Your account does not include permission to add or edit call logs here."
        }
      />

      <section>
        <Card>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Call form</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">
            {caps.canLogCalls ? "Save a full call log" : "View-only access"}
          </h3>
          {callFormOrReadOnly}
        </Card>
      </section>
    </div>
  );
}
