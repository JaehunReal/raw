import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, LockKeyhole, LogOut, RefreshCw } from "lucide-react";
import "./login.css";

export default function LoginGate({ children }: { children: ReactNode }) {
  const required = import.meta.env.VITE_REQUIRE_LOGIN === "true";
  const [authenticated, setAuthenticated] = useState(!required);
  const [checking, setChecking] = useState(required);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setChecking(true);
    try {
      const response = await fetch("/api/session", { credentials: "same-origin" });
      if (response.status === 401) { setAuthenticated(false); setError(""); return; }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.authenticated)
        throw new Error(data?.detail || "웹사이트의 API 연결 설정을 확인해 주세요.");
      setAuthenticated(true); setError("");
    } catch (e) { setError((e as Error).message); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    if (!required) return;
    void check();
    const expired = () => { setAuthenticated(false); setError("로그인 시간이 만료되었습니다. 다시 로그인해 주세요."); };
    window.addEventListener("rulecraft:login-required", expired);
    return () => window.removeEventListener("rulecraft:login-required", expired);
  }, [required]);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || "로그인하지 못했습니다.");
      setPassword(""); setAuthenticated(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      setAuthenticated(false); setError("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (authenticated) return <>{children}{required && <button className="session-logout" onClick={logout} disabled={busy}>
    <LogOut size={14} /> 로그아웃
  </button>}{error && <div role="alert" className="session-error">{error}</div>}</>;
  return <main className="login-page"><section className="login-card">
    <div className="login-brand"><BookOpen size={25} /> RuleCraft.</div>
    <span className="login-kicker">규정 관리 워크스페이스</span>
    <h1>워크스페이스에 로그인</h1>
    <p>조문을 조회하고 개정 초안과 연결된 규정을 검토하세요.</p>
    {checking ? <p role="status">연결 상태를 확인하고 있습니다.</p> : <form onSubmit={login}>
      <label htmlFor="workspace-password">워크스페이스 비밀번호</label>
      <div className="login-password"><LockKeyhole size={18} /><input id="workspace-password" type="password"
        autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="button primary" disabled={busy || !password}>{busy ? "로그인 중…" : "로그인"}</button>
    </form>}
    {error && <p role="alert" className="login-error">{error}</p>}
    {!checking && <button className="login-retry" onClick={() => void check()}><RefreshCw size={14} /> 연결 다시 확인</button>}
  </section></main>;
}
