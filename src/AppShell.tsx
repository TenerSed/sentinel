import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

// The reference city has the full stack (cases, parcels, transcripts, graph).
// An onboarded city has meetings, documents and whatever graph has been built
// for it, so it advertises only the sections that actually have something in
// them — five links that all led to the same screen read as a broken navbar.
const referenceNav = [
  ["Dashboard", "/dashboard"],
  ["Tracker", "/tracker"],
  ["Map", "/map"],
  ["Analysis", "/terminal"],
  ["Graph", "/graph"],
] as const;

const onboardedNav = [
  ["Dashboard", "/dashboard"],
  ["Meetings", "/city"],
  ["Graph", "/graph"],
] as const;

function activePath(nav: readonly (readonly [string, string])[], pathname: string) {
  if (pathname === "/case") return "/tracker";
  return nav.find(([, href]) => href === pathname)?.[1];
}

export default function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [pathname, setPathname] = useState(window.location.pathname);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const update = () => { setPathname(window.location.pathname); setOpen(false); };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    // Onboarded cities search their ingested meetings; only the reference city
    // has a case tracker to search.
    const base = auth.selectedCity && !auth.selectedCity.isReference ? "/city" : "/tracker";
    window.location.href = value ? `${base}?q=${encodeURIComponent(value)}` : base;
  };

  const city = auth.selectedCity;
  const nav = city && !city.isReference ? onboardedNav : referenceNav;
  const current = activePath(nav, pathname);
  return <div className="app-shell">
    <div className="app-trust">VERIFIED FROM PUBLIC RECORD · NEVER GUESSED</div>
    <header className="app-header">
      <a className="app-wordmark" href="/dashboard" aria-label="Sentinel dashboard">
        <strong>SENTINEL</strong><span>{city ? `· ${city.city}, ${city.state}` : "· LOCAL CIVIC INTELLIGENCE"}</span>
      </a>
      <a className="app-city-switcher" href="/onboarding" onClick={() => sessionStorage.setItem("sentinel-force-onboarding", "1")}>{city ? "Change city" : "Choose your city"}</a>
      <button className="app-menu" type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen((value) => !value)}>
        {open ? "Close" : "Menu"}
      </button>
      <div className={`app-header-tools ${open ? "open" : ""}`} id="primary-navigation">
        <nav className="app-nav" aria-label="Primary sections">
          {nav.map(([label, href]) => <a key={href} href={href} className={current === href ? "active" : ""} aria-current={current === href ? "page" : undefined}>{label}</a>)}
        </nav>
        <form className="app-search" role="search" onSubmit={search}>
          <label className="sr-only" htmlFor="global-search">Search public records</label>
          <input id="global-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cases, people, addresses" />
          <button type="submit">Search</button>
        </form>
        <div className="app-auth">
          {auth.status === "loading" ? <span className="app-auth-loading app-skeleton">Checking account</span> : auth.user ? <><a href="/auth" title={auth.user.email || "Signed-in account"}>{auth.user.email}</a><button type="button" onClick={() => void auth.signOut()}>Sign out</button></> : <><a href="/auth">Sign in</a><a className="app-get-started" href="/auth">Get started</a></>}
        </div>
      </div>
    </header>
    <div className="app-content">{children}</div>
  </div>;
}
