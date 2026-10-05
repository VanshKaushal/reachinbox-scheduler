import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Mail, ArrowUpRight, AlertCircle } from 'lucide-react';
import type { Status } from '../types';

export function Button({
  children,
  variant = 'primary',
  className = '',
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button button-${variant} ${className}`}
      aria-busy={busy || undefined}
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}
export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? 'brand-inverse' : ''}`}>
      <span className="brand-icon">
        <Mail size={21} strokeWidth={2.2} />
      </span>
      <span>
        reach<span className="brand-light">inbox</span>
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function SlackLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="13" width="13" height="6" rx="3" fill="#36c5f0" />
      <rect x="13" y="4" width="6" height="13" rx="3" fill="#2eb67d" />
      <rect x="15" y="15" width="13" height="6" rx="3" fill="#e01e5a" />
      <rect x="13" y="15" width="6" height="13" rx="3" fill="#ecb22e" />
      <circle cx="7" cy="7" r="3" fill="#36c5f0" />
      <circle cx="25" cy="7" r="3" fill="#2eb67d" />
      <circle cx="25" cy="25" r="3" fill="#e01e5a" />
      <circle cx="7" cy="25" r="3" fill="#ecb22e" />
    </svg>
  );
}
const statusLabels: Record<Status, string> = {
  scheduled: 'Scheduled',
  deferred: 'Rate limited',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  delivery_unknown: 'Uncertain',
  cancelled: 'Cancelled',
};
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {statusLabels[status]}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const pending = useRef(busy);
  pending.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    const priorHidden = root?.getAttribute('aria-hidden');
    if (root) {
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) close.current();
      if (event.key !== 'Tab') return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = oldOverflow;
      if (root) {
        root.inert = wasInert;
        if (priorHidden == null) root.removeAttribute('aria-hidden');
        else root.setAttribute('aria-hidden', priorHidden);
      }
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className={`modal-backdrop ${className}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'modal-wide' : ''}`}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">YOUR NEXT CONVERSATION</span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <div className="empty-icon">{icon || <Mail size={30} strokeWidth={1.6} />}</div>
        <span className="orbit-dot" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry}>
          Try again <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
export function SkeletonRows() {
  return (
    <div className="table-skeleton" role="status" aria-label="Loading emails">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton skeleton-avatar" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ))}
    </div>
  );
}
