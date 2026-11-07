"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { HxButton } from "./hx-button";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface HxDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 補足説明。aria-describedby に紐づく */
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** パネルの最大幅 */
  widthClass?: string;
}

// §17.10: Esc、フォーカストラップ、閉じたときのフォーカス復帰、背景スクロール制御に対応。
export function HxDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClass = "max-w-lg",
}: HxDialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      restoreRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-hx-text/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`relative w-full ${widthClass} rounded-lg bg-hx-surface shadow-xl`}
      >
        <div className="space-y-2 px-6 pt-5">
          <h2 id={titleId} className="text-hx-section-title font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="text-hx-body text-hx-text-subtle">
              {description}
            </p>
          ) : null}
        </div>
        {children ? <div className="px-6 py-4 text-hx-body">{children}</div> : null}
        {footer ? (
          <div className="flex justify-end gap-3 border-t border-hx-divider px-6 py-4">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export interface HxConfirmActionDialogProps {
  open: boolean;
  /** 操作対象（施設名・氏名・問診IDなど必要最小限、§17.9） */
  subject?: string;
  title: string;
  description: string;
  /** 確認ボタンは「受領を確認する」「職員を停止する」など動詞を具体化 */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function HxConfirmActionDialog({
  open,
  subject,
  title,
  description,
  confirmLabel,
  cancelLabel = "キャンセル",
  tone = "primary",
  busy = false,
  onConfirm,
  onClose,
}: HxConfirmActionDialogProps) {
  return (
    <HxDialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={description}
      footer={
        <>
          <HxButton variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
            {cancelLabel}
          </HxButton>
          <HxButton variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </HxButton>
        </>
      }
    >
      {subject ? (
        <p className="rounded-sm bg-hx-surface-subtle px-3 py-2 text-hx-body">
          <span className="font-semibold">対象：</span>
          {subject}
        </p>
      ) : null}
    </HxDialog>
  );
}
