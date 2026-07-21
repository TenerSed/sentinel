import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

export default function AuthPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (auth.status === "signed-in" && !auth.profileLoading && auth.profile?.city) window.location.replace("/dashboard");
  }, [auth.profile, auth.profileLoading, auth.status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    const result = mode === "sign-up" ? await auth.signUp(email.trim(), password) : await auth.signIn(email.trim(), password);
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    if (mode === "sign-up") {
      sessionStorage.setItem("sentinel-force-onboarding", "1");
      setMessage("Account created. If email confirmation is enabled, check your inbox before your preferences can sync.");
      window.setTimeout(() => window.location.assign("/onboarding"), 500);
    } else window.location.assign(result.destination || "/onboarding");
  };

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">OPTIONAL PERSONALIZATION</p>
      <h1 id="auth-title">{mode === "sign-up" ? "Get started" : "Welcome back"}</h1>
      <p>Save your city, street, and tracked cases across devices. Public records remain available without an account.</p>
      {auth.status === "loading" ? <div className="auth-skeleton" role="status"><span className="app-skeleton" /><span className="app-skeleton" /><span className="app-skeleton" />Checking your session…</div> : auth.status === "signed-in" ? <div className="auth-signed-in"><p>Signed in as <strong>{auth.user?.email}</strong>.</p><a href={auth.profile?.city ? "/dashboard" : "/onboarding"}>{auth.profile?.city ? "Go to dashboard" : "Finish onboarding"}</a><button type="button" onClick={() => void auth.signOut()}>Sign out</button></div> : <>
        <div className="auth-tabs" role="tablist" aria-label="Account action"><button type="button" role="tab" aria-selected={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(""); }}>Sign in</button><button type="button" role="tab" aria-selected={mode === "sign-up"} onClick={() => { setMode("sign-up"); setError(""); }}>Create account</button></div>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required disabled={loading} placeholder="you@example.com" />
          <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={6} required disabled={loading} />
          <button type="submit" disabled={loading}>{loading ? mode === "sign-up" ? "Creating account…" : "Signing in…" : mode === "sign-up" ? "Create account" : "Sign in"}</button>
        </form>
        {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}
      </>}
      <a className="auth-public-link" href="/">Continue browsing public records →</a>
    </section>
  </main>;
}
