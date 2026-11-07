import { redirect } from "next/navigation";
import { readSession, sessionApiFetch } from "../../lib/session";
import type { MembershipsResponse } from "../../lib/memberships";
import { WorkspaceShell } from "./workspace-shell";

/**
 * 認証後ページ共通ガード（H-001 以降の全業務画面）。
 * セッション Cookie がなければ H-001 へ。あっても API が拒否すれば同様にログインへ。
 * 所属・役割はナビゲーションごとにサーバ側で再解決する（SEC-06）。
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect("/login");

  const upstream = await sessionApiFetch(session, "/v1/me/facility-memberships").catch(() => null);
  if (!upstream || upstream.status === 401 || upstream.status === 403) redirect("/login");
  if (!upstream.ok) redirect("/login");

  const memberships = (await upstream.json()) as MembershipsResponse;
  return <WorkspaceShell memberships={memberships.items}>{children}</WorkspaceShell>;
}
