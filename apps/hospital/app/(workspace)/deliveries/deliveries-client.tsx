"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { HxStatusBadge, type HxDeliveryStatus } from "../../../components/design-system/hx-status-badge";
import { HxDataTable, HxTd, HxTh, HxTr } from "../../../components/design-system/hx-data-table";
import { HxButton } from "../../../components/design-system/hx-button";
import { HxEmptyState, HxErrorPanel } from "../../../components/design-system/hx-feedback";
import { hxInputClass } from "../../../components/design-system/hx-field";
import { HxPageHeader } from "../../../components/design-system/hx-page-header";
import { HxSkeletonRows } from "../../../components/design-system/hx-skeleton";
import { useSelectedFacility } from "../workspace-shell";
import { hxApi, HxApiError } from "../../../lib/hx-api";

interface DeliveryListItem {
  deliveryId: string;
  facilityId: string;
  questionnaireId: string;
  questionnaireRevisionId: string;
  status: HxDeliveryStatus;
  patientDisplayName: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
}

interface DeliveryListResponse {
  deliveries: DeliveryListItem[];
  nextCursor: string | null;
}

const STATUS_OPTIONS: Array<{ value: "" | HxDeliveryStatus; label: string }> = [
  { value: "", label: "すべての状態" },
  { value: "delivered", label: "未受領" },
  { value: "acknowledged", label: "受領確認済み" },
];

function formatReceivedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DeliveriesClient() {
  const selected = useSelectedFacility();
  const facilityId = selected?.facilityId ?? null;

  const [statusFilter, setStatusFilter] = useState<"" | HxDeliveryStatus>("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const [items, setItems] = useState<DeliveryListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 「次へ」は cursor を積み、「前へ」はスタックから1つ戻る
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [requestSeq, setRequestSeq] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const currentCursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1]! : null;

  const load = useCallback(
    (cursor: string | null, signal?: AbortSignal) => {
      if (!facilityId) return Promise.resolve();
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (appliedQuery) params.set("q", appliedQuery);
      if (cursor) params.set("cursor", cursor);
      return hxApi<DeliveryListResponse>(
        `hospitals/${encodeURIComponent(facilityId)}/deliveries?${params.toString()}`,
        { signal },
      )
        .then((data) => {
          setItems(data.deliveries);
          setNextCursor(data.nextCursor);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setItems(null);
          setError(err instanceof HxApiError ? err.message : "読み込みに失敗しました。");
        })
        .finally(() => setLoading(false));
    },
    [facilityId, statusFilter, appliedQuery],
  );

  // フィルタ変更時は各ハンドラが cursorStack をリセット済み。ここでは先頭ページを読み込む。
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    void load(null, controller.signal);
    return () => controller.abort();
  }, [load, requestSeq]);

  function goNext() {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack, nextCursor]);
    void load(nextCursor, abortRef.current?.signal);
  }

  function goPrev() {
    const next = cursorStack.slice(0, -1);
    setCursorStack(next);
    void load(next.length > 0 ? next[next.length - 1]! : null, abortRef.current?.signal);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(searchInput.trim());
    setCursorStack([]);
    setRequestSeq((n) => n + 1);
  }

  function resetFilters() {
    setStatusFilter("");
    setSearchInput("");
    setAppliedQuery("");
    setCursorStack([]);
    setRequestSeq((n) => n + 1);
  }

  if (!selected) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-8">
        <HxEmptyState
          icon="building"
          title="施設が選択されていません"
          description="受信問診を表示するには、まず業務を行う施設を選択してください。"
        />
        <Link
          href="/facilities"
          className="inline-flex h-9 items-center rounded-sm bg-hx-primary px-4 text-hx-body font-semibold text-hx-on-primary"
        >
          施設を選択する
        </Link>
      </div>
    );
  }

  const hasFilter = statusFilter !== "" || appliedQuery !== "";

  return (
    <div className="space-y-4">
      <HxPageHeader
        title="受信問診"
        description={`${selected.facility?.displayName ?? "選択中の施設"}に届いた問診票の一覧です。`}
      />

      <form onSubmit={applySearch} className="flex flex-wrap items-end gap-3" aria-label="受信問診の絞り込み">
        <div className="min-w-56 flex-1">
          <label htmlFor="delivery-q" className="mb-1.5 block text-hx-label font-semibold text-hx-text">
            患者氏名で検索
          </label>
          <input
            id="delivery-q"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            maxLength={100}
            placeholder="氏名（前方一致）"
            className={hxInputClass}
          />
        </div>
        <div className="w-44">
          <label htmlFor="delivery-status" className="mb-1.5 block text-hx-label font-semibold text-hx-text">
            状態
          </label>
          <select
            id="delivery-status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "" | HxDeliveryStatus);
              setCursorStack([]);
            }}
            className={hxInputClass}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <HxButton type="submit">検索</HxButton>
        {hasFilter ? (
          <HxButton type="button" variant="secondary" onClick={resetFilters}>
            条件をクリア
          </HxButton>
        ) : null}
      </form>

      {error ? (
        <HxErrorPanel
          title="受信問診を読み込めませんでした"
          description={error}
          actionLabel="再試行"
          onAction={() => void load(currentCursor, abortRef.current?.signal)}
        />
      ) : items === null ? (
        <div role="status" aria-label="読み込み中">
          <HxSkeletonRows rows={8} />
        </div>
      ) : items.length === 0 ? (
        <HxEmptyState
          icon="inbox"
          title={hasFilter ? "条件に一致する問診がありません" : "受信した問診はまだありません"}
          description={
            hasFilter
              ? "検索条件を変更して再度お試しください。"
              : "患者が問診票を送信するとここに表示されます。"
          }
        />
      ) : (
        <>
          <HxDataTable caption="受信問診一覧" busy={loading}>
            <thead>
              <tr>
                <HxTh>受信日時</HxTh>
                <HxTh>患者氏名</HxTh>
                <HxTh>状態</HxTh>
                <HxTh>問診票ID</HxTh>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <HxTr key={d.deliveryId}>
                  <HxTd numeric>{formatReceivedAt(d.deliveredAt ?? d.createdAt)}</HxTd>
                  <HxTd>
                    <Link
                      href={`/deliveries/${encodeURIComponent(d.deliveryId)}`}
                      className="font-semibold text-hx-primary underline-offset-2 hover:underline"
                    >
                      {d.patientDisplayName ?? "（氏名共有なし）"}
                    </Link>
                  </HxTd>
                  <HxTd>
                    <HxStatusBadge status={d.status} />
                  </HxTd>
                  <HxTd className="font-mono text-hx-caption">{d.questionnaireId}</HxTd>
                </HxTr>
              ))}
            </tbody>
          </HxDataTable>

          <div className="flex items-center justify-between">
            <p className="text-hx-caption text-hx-text-subtle" aria-live="polite">
              {items.length}件表示{cursorStack.length > 0 ? `（${cursorStack.length + 1}ページ目）` : ""}
            </p>
            <div className="flex gap-2">
              <HxButton
                type="button"
                variant="secondary"
                disabled={cursorStack.length === 0 || loading}
                onClick={goPrev}
              >
                前へ
              </HxButton>
              <HxButton type="button" variant="secondary" disabled={!nextCursor || loading} onClick={goNext}>
                次へ
              </HxButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
