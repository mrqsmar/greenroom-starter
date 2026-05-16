/**
 * Standalone layout for the tour manager preview link.
 * Covers the main app shell (sidebar + nav) so Diego sees a clean,
 * mobile-first read-only page — not the venue-internal interface.
 */
export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-auto">
      {children}
    </div>
  );
}
