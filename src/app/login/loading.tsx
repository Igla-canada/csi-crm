export default function LoginLoading() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-[#e8f0fa] to-[#f4f7fb] px-4 py-16">
      <div
        className="h-12 w-12 animate-spin rounded-full border-2 border-slate-300 border-t-[#4285F4]"
        role="status"
        aria-label="Loading"
      />
      <p className="mt-4 text-sm text-slate-600">Loading sign-in…</p>
    </div>
  );
}
