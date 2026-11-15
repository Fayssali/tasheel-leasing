/**
 * Minimal design-system components (Phase 0 specification, section 8). Logical Tailwind
 * utilities only (ms-/me-/ps-/pe-/text-start) so every component mirrors in Arabic.
 */
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-900 focus-visible:outline-primary-600',
  accent: 'bg-accent-500 text-primary-900 hover:brightness-95 focus-visible:outline-accent-500',
  secondary:
    'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 focus-visible:outline-primary-600',
  danger: 'bg-danger-600 text-white hover:brightness-95 focus-visible:outline-danger-600',
  ghost: 'text-primary-600 hover:bg-primary-50 focus-visible:outline-primary-600',
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="…"
      className={cx(
        'inline-block animate-spin rounded-full border-2 border-current border-e-transparent',
        small ? 'h-4 w-4' : 'h-6 w-6',
      )}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-gray-800 text-start">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500 text-start">{hint}</p>}
      {error && <p className="text-xs text-danger-600 text-start">{error}</p>}
    </div>
  );
}

const INPUT =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/20 disabled:bg-gray-100';

export function TextInput({
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input id={inputId} className={cx(INPUT, className)} aria-invalid={!!error} {...rest} />
    </Field>
  );
}

export function SelectInput({
  label,
  hint,
  options,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <Field label={label} hint={hint} htmlFor={selectId}>
      <select id={selectId} className={INPUT} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600"
        {...rest}
      />
      <span className="text-start">{label}</span>
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-lg border border-gray-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900 text-start">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = 'info' | 'action' | 'success' | 'danger' | 'neutral';
const TONES: Record<Tone, string> = {
  info: 'bg-primary-50 text-primary-600',
  action: 'bg-warning-600/10 text-warning-600',
  success: 'bg-success-600/10 text-success-600',
  danger: 'bg-danger-600/10 text-danger-600',
  neutral: 'bg-gray-100 text-gray-600',
};

/** Same colour, same meaning across the platform (section 8.4). */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex flex-col gap-2 rounded-lg px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        TONES[tone],
      )}
    >
      <div className="text-start">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-primary-900 text-start">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-600 text-start">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-gray-500">{children}</p>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-full max-w-lg rounded-lg p-0 backdrop:bg-gray-900/40"
    >
      <div className="border-b border-gray-200 px-5 py-3">
        <h2 className="text-base font-semibold text-start">{title}</h2>
      </div>
      <div className="space-y-4 p-5">{children}</div>
      {footer && (
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">{footer}</div>
      )}
    </dialog>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="px-4 py-2 text-start text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cx('px-4 py-3 text-start align-middle text-gray-800', className)}>{children}</td>
  );
}
