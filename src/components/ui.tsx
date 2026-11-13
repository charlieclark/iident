"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "dark";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3.5 text-sm",
        size === "md" && "h-10 px-5 text-sm",
        size === "lg" && "h-12 px-7 text-base",
        variant === "primary" && "bg-accent-500 text-white shadow-soft hover:bg-accent-600 active:scale-[0.98]",
        variant === "dark" && "bg-ink-900 text-white hover:bg-ink-800 active:scale-[0.98]",
        variant === "secondary" && "border border-ink-200 bg-card text-ink-800 hover:border-ink-300 hover:bg-ink-50",
        variant === "ghost" && "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className ?? "size-5")}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-3xl border border-ink-100 bg-card shadow-soft", className)}>{children}</div>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        selected
          ? "border-accent-500 bg-accent-50 text-accent-700"
          : "border-ink-200 bg-card text-ink-700 hover:border-ink-300 hover:bg-ink-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-ink-100 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cx(
            "rounded-full px-3.5 py-1.5 text-sm transition-all",
            value === o.id ? "bg-card font-medium text-ink-900 shadow-sm" : "text-ink-600 hover:text-ink-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Swatches({
  value,
  colors,
  onChange,
  label,
}: {
  value: string;
  colors: readonly { id: string; name: string; hex: string }[];
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          title={c.name}
          onClick={() => onChange(c.id)}
          className={cx(
            "size-7 rounded-full border transition-transform hover:scale-110",
            value === c.id ? "ring-2 ring-accent-500 ring-offset-2" : "border-black/10",
          )}
          style={{ background: c.hex }}
        />
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  counter,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  counter?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-800">{label}</span>
        {counter && <span className="text-xs text-ink-400">{counter}</span>}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-ink-200 bg-card px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition focus:border-accent-400 focus:ring-4 focus:ring-accent-100";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cx(
        "rounded-2xl px-3.5 py-2.5 text-sm",
        tone === "info" && "bg-accent-50 text-accent-800",
        tone === "warn" && "bg-peach-100 text-ink-800",
        tone === "error" && "bg-red-50 text-red-800",
      )}
    >
      {children}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight text-ink-900", className)}>
      <span className="relative grid size-7 place-items-center rounded-full bg-ink-900 text-white">
        <span className="absolute size-2 -translate-x-1 rounded-full bg-white" />
        <span className="absolute size-2 translate-x-1 rounded-full bg-accent-300" />
      </span>
      Twiins
    </span>
  );
}
