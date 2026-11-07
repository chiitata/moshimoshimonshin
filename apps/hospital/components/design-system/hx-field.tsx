"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { HxIcon } from "./hx-icon";

/** HxField 内の input/select/textarea に適用する共通クラス。 */
export const hxInputClass =
  "h-9 w-full rounded-sm border border-hx-border bg-hx-surface px-3 text-hx-body text-hx-text placeholder:text-hx-text-subtle/60 hover:border-hx-text-subtle/50 disabled:cursor-not-allowed disabled:bg-hx-surface-subtle disabled:text-hx-text-subtle read-only:bg-hx-canvas aria-[invalid=true]:border-hx-danger";

export interface HxFieldProps {
  label: string;
  /** 必須は文字で明示する（色だけに依存しない） */
  required?: boolean;
  /** 必須でないことを明示したい場合 */
  optional?: boolean;
  description?: string;
  error?: string;
  /** input/select/textarea を1つ渡す。id と aria-* を自動で紐づける */
  children: ReactNode;
}

// §17.11: Labelは上、必須/任意を文字で、説明は下、エラーは aria-describedby で紐づけ。
export function HxField({
  label,
  required = false,
  optional = false,
  description,
  error,
  children,
}: HxFieldProps) {
  const id = useId();
  const describedBy = [
    description ? `${id}-desc` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-hx-label font-semibold text-hx-text">
        {label}
        {required ? (
          <span className="rounded-xs bg-hx-danger-bg px-1.5 py-0.5 text-hx-caption font-semibold text-hx-danger">
            必須
          </span>
        ) : null}
        {optional ? (
          <span className="rounded-xs bg-hx-neutral-bg px-1.5 py-0.5 text-hx-caption font-semibold text-hx-neutral">
            任意
          </span>
        ) : null}
      </label>
      {control}
      {description ? (
        <p id={`${id}-desc`} className="text-hx-caption text-hx-text-subtle">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1 text-hx-caption font-semibold text-hx-danger">
          <HxIcon name="alert-triangle" size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function HxFormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-md border border-hx-border bg-hx-surface p-5">
      <header className="space-y-1">
        <h2 className="text-hx-section-title font-semibold">{title}</h2>
        {description ? <p className="text-hx-body text-hx-text-subtle">{description}</p> : null}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
