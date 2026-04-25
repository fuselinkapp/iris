'use client';

const SHORTCUTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'c', label: 'Compose' },
  { key: '?', label: 'Toggle this help' },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <dialog
        open
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,90vw)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6 text-[var(--text)]"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <h2 className="text-base font-medium">Keyboard shortcuts</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">More coming as Iris grows.</p>
        <ul className="mt-5 flex flex-col gap-3">
          {SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-sm">
              <span className="text-[var(--text)]">{s.label}</span>
              <kbd>{s.key}</kbd>
            </li>
          ))}
        </ul>
      </dialog>
    </div>
  );
}
