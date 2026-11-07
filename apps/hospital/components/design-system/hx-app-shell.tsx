"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { HxIcon, type HxIconName } from "./hx-icon";

export interface HxNavItem {
  href: string;
  label: string;
  icon: HxIconName;
  /** サーバ権限で出し分け済みの項目だけを渡す（§17.1） */
  active?: boolean;
}

export interface HxAppShellProps {
  /** 業務コンテキストの証拠としてヘッダーに常時表示（§17.1）。未選択時は null。 */
  facilityName: string | null;
  staffName?: string | null;
  navItems: HxNavItem[];
  onSignOut?: () => void;
  /** 開発カタログなど、画面全体ではなく枠内で表示する場合 */
  framed?: boolean;
  children: ReactNode;
}

function NavLink({ item, collapsed, onNavigate }: { item: HxNavItem; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={item.active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`relative flex h-11 items-center gap-3 rounded-sm px-4 text-hx-body transition-colors duration-150 ${
          collapsed ? "justify-center px-0" : ""
        } ${
          item.active
            ? "bg-hx-nav-active font-semibold text-hx-primary"
            : "text-hx-text hover:bg-hx-row-hover"
        }`}
      >
        {item.active ? (
          <span aria-hidden="true" className="absolute left-0 top-1.5 h-8 w-1 rounded-full bg-hx-primary" />
        ) : null}
        <HxIcon name={item.icon} size={20} className="shrink-0" />
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
      </Link>
    </li>
  );
}

function FacilityBadge({ name }: { name: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-hx-surface-subtle px-2.5 py-1 text-hx-label font-semibold">
      <HxIcon name="building" size={16} className="shrink-0" />
      <span className="truncate">{name ?? "施設未選択"}</span>
    </span>
  );
}

export function HxAppShell({
  facilityName,
  staffName,
  navItems,
  onSignOut,
  framed = false,
  children,
}: HxAppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const pos = framed ? "absolute" : "fixed";

  return (
    <div className={framed ? "relative h-full overflow-hidden" : "min-h-screen bg-hx-canvas"}>
      <a
        href="#hx-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-sm focus:bg-hx-primary focus:px-4 focus:py-2 focus:text-hx-on-primary"
      >
        メインコンテンツへ移動
      </a>

      {/* 上部ヘッダー 56px（§16.3）。施設名は業務コンテキストの証拠として常時表示。 */}
      <header
        className={`${pos} inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-hx-border bg-hx-surface px-4 md:px-6`}
      >
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-sm text-hx-text hover:bg-hx-row-hover md:hidden"
          aria-expanded={drawerOpen}
          aria-controls="hx-mobile-nav"
          aria-label="ナビゲーションを開く"
          onClick={() => setDrawerOpen(true)}
        >
          <HxIcon name="menu" size={20} />
        </button>
        <Link href="/" className="shrink-0 text-hx-body font-bold text-hx-primary">
          もしもし問診
        </Link>
        <span aria-hidden="true" className="hidden h-5 w-px bg-hx-border sm:block" />
        <FacilityBadge name={facilityName} />
        <div className="ml-auto flex items-center gap-3">
          {staffName ? (
            <span className="hidden items-center gap-1.5 text-hx-body text-hx-text-subtle sm:inline-flex">
              <HxIcon name="user" size={16} />
              <span className="max-w-40 truncate">{staffName}</span>
            </span>
          ) : null}
          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-hx-label font-semibold text-hx-text-subtle hover:bg-hx-row-hover hover:text-hx-text"
            >
              <HxIcon name="logout" size={16} />
              ログアウト
            </button>
          ) : null}
        </div>
      </header>

      {/* デスクトップ/タブレット: 常時サイドバー（md=72px アイコン、lg=240px ラベル付き） */}
      <nav
        aria-label="主要ナビゲーション"
        className={`${pos} bottom-0 left-0 top-14 z-30 hidden w-18 border-r border-hx-border bg-hx-surface md:block lg:hidden`}
      >
        <ul className="space-y-1 p-2">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={true} />
          ))}
        </ul>
      </nav>
      <nav
        aria-label="主要ナビゲーション"
        className={`${pos} bottom-0 left-0 top-14 z-30 hidden w-60 border-r border-hx-border bg-hx-surface lg:block`}
      >
        <ul className="space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </ul>
      </nav>

      {/* モバイル: ドロワーナビ */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-hx-text/40"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <nav
            id="hx-mobile-nav"
            aria-label="主要ナビゲーション"
            className="absolute bottom-0 left-0 top-0 w-64 bg-hx-surface shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-hx-divider px-4">
              <span className="text-hx-body font-bold text-hx-primary">もしもし問診</span>
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-sm hover:bg-hx-row-hover"
                aria-label="ナビゲーションを閉じる"
                onClick={() => setDrawerOpen(false)}
              >
                <HxIcon name="x" size={20} />
              </button>
            </div>
            <ul className="space-y-1 p-3">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} onNavigate={() => setDrawerOpen(false)} />
              ))}
            </ul>
          </nav>
        </div>
      ) : null}

      <main
        id="hx-main-content"
        tabIndex={-1}
        className={`pt-14 md:pl-18 lg:pl-60 ${framed ? "h-full overflow-auto" : "min-h-screen"}`}
      >
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
