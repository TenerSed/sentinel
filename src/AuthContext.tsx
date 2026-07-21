import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SelectedCity = {
  city: string;
  state: string;
  vendor: string;
  slug: string;
  isReference: boolean;
  meetingsIngested?: number;
  sourcesVerified?: number;
};

export type ResidentProfile = SelectedCity & {
  address: string;
};

type AuthStatus = "loading" | "signed-in" | "signed-out";
type AuthResult = { error?: string; destination?: "/dashboard" | "/onboarding" };
type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  profile: ResidentProfile | null;
  selectedCity: SelectedCity | null;
  profileLoading: boolean;
  tracked: Set<string>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<string | undefined>;
  saveProfile: (profile: ResidentProfile) => Promise<{ synced: boolean }>;
  toggleTracked: (caseNumber: string) => void;
};

const PROFILE_KEY = "sentinel-profile-v1";
const SELECTED_CITY_KEY = "sentinel-selected-city-v1";
const WATCHLIST_KEY = "sentinel-watchlist-v1";
const AuthContext = createContext<AuthContextValue | null>(null);

function selectedCityFromValue(value: unknown): SelectedCity | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.city !== "string" || typeof row.state !== "string" || !row.city.trim() || !/^[A-Z]{2}$/i.test(row.state)) return null;
  const isReference = row.city.trim().toLowerCase() === "fishers" && row.state.toUpperCase() === "IN";
  return {
    city: row.city.trim(), state: row.state.toUpperCase(),
    vendor: typeof row.vendor === "string" ? row.vendor : isReference ? "civicclerk" : "",
    slug: typeof row.slug === "string" ? row.slug : isReference ? "fishersin" : "",
    isReference: typeof row.isReference === "boolean" ? row.isReference : isReference,
    meetingsIngested: typeof row.meetingsIngested === "number" ? row.meetingsIngested : typeof row.meetings_ingested === "number" ? row.meetings_ingested : isReference ? 184 : undefined,
    sourcesVerified: typeof row.sourcesVerified === "number" ? row.sourcesVerified : typeof row.sources_verified === "number" ? row.sources_verified : undefined,
  };
}

function readLocalCity(): SelectedCity | null {
  try { return selectedCityFromValue(JSON.parse(localStorage.getItem(SELECTED_CITY_KEY) || "null")); }
  catch { return null; }
}

function readLocalProfile(): ResidentProfile | null {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") as Partial<ResidentProfile> | null;
    const city = readLocalCity() || selectedCityFromValue(value);
    if (!city) return null;
    return { ...city, address: value && typeof value.address === "string" ? value.address : "" };
  } catch { return null; }
}

function readLocalTracked() {
  try {
    const value = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
    return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch { return new Set<string>(); }
}

function writeLocalProfile(profile: ResidentProfile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    const { address: _address, ...city } = profile;
    localStorage.setItem(SELECTED_CITY_KEY, JSON.stringify(city));
  } catch { /* Browser storage is optional. */ }
}

function writeLocalTracked(tracked: Set<string>) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...tracked])); } catch { /* Browser storage is optional. */ }
}

function profileFromRow(row: unknown): ResidentProfile | null {
  const city = selectedCityFromValue(row);
  if (!city) return null;
  const value = row as Record<string, unknown>;
  return { ...city, address: typeof value.address === "string" ? value.address : "" };
}

function trackedFromRow(row: unknown) {
  if (!row || typeof row !== "object") return new Set<string>();
  const value = (row as Record<string, unknown>).tracked;
  return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

function warnProfileFallback(error: unknown) {
  console.warn("Supabase profiles are unavailable; using localStorage instead. Create the profiles table with the SQL printed in the implementation report.", error);
}

async function fetchRemoteProfile(user: User) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ResidentProfile | null>(() => readLocalProfile());
  const [profileLoading, setProfileLoading] = useState(true);
  const [tracked, setTracked] = useState<Set<string>>(() => readLocalTracked());

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.warn("Supabase session check failed; continuing signed out.", error);
      setUser(data.session?.user || null);
      setStatus(data.session?.user ? "signed-in" : "signed-out");
    }).catch((error) => {
      console.warn("Supabase session check failed; continuing signed out.", error);
      if (active) setStatus("signed-out");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user || null);
      setStatus(session?.user ? "signed-in" : "signed-out");
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    const localProfile = readLocalProfile();
    const localTracked = readLocalTracked();
    if (!user) {
      setProfile(localProfile);
      setTracked(localTracked);
      setProfileLoading(status === "loading");
      return () => { active = false; };
    }
    setProfileLoading(true);
    void fetchRemoteProfile(user).then(async (row) => {
      if (!active) return;
      const remoteProfile = profileFromRow(row);
      const mergedTracked = new Set([...trackedFromRow(row), ...localTracked]);
      const nextProfile = remoteProfile || localProfile;
      setProfile(nextProfile);
      setTracked(mergedTracked);
      if (nextProfile) writeLocalProfile(nextProfile);
      writeLocalTracked(mergedTracked);
      if (localTracked.size || (localProfile && !remoteProfile)) {
        const { error } = await supabase.from("profiles").upsert({
          id: user.id, email: user.email || null,
          city: nextProfile?.city || null, state: nextProfile?.state || null,
          vendor: nextProfile?.vendor || null, slug: nextProfile?.slug || null,
          is_reference: nextProfile?.isReference || false,
          meetings_ingested: nextProfile?.meetingsIngested || 0,
          sources_verified: nextProfile?.sourcesVerified || 0,
          address: nextProfile?.address || null, tracked: [...mergedTracked], updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) warnProfileFallback(error);
      }
    }).catch(warnProfileFallback).finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [status, user]);

  const saveProfile = async (next: ResidentProfile) => {
    setProfile(next);
    writeLocalProfile(next);
    if (!user) return { synced: false };
    const { error } = await supabase.from("profiles").upsert({
      id: user.id, email: user.email || null, city: next.city, state: next.state,
      vendor: next.vendor || null, slug: next.slug || null,
      is_reference: next.isReference, meetings_ingested: next.meetingsIngested || 0,
      sources_verified: next.sourcesVerified || 0,
      address: next.address || null, tracked: [...tracked], updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) { warnProfileFallback(error); return { synced: false }; }
    return { synced: true };
  };

  const toggleTracked = (caseNumber: string) => {
    setTracked((current) => {
      const next = new Set(current);
      next.has(caseNumber) ? next.delete(caseNumber) : next.add(caseNumber);
      writeLocalTracked(next);
      if (user) void supabase.from("profiles").upsert({
        id: user.id, email: user.email || null,
        city: profile?.city || null, state: profile?.state || null, address: profile?.address || null,
        vendor: profile?.vendor || null, slug: profile?.slug || null,
        is_reference: profile?.isReference || false,
        meetings_ingested: profile?.meetingsIngested || 0,
        sources_verified: profile?.sourcesVerified || 0,
        tracked: [...next], updated_at: new Date().toISOString(),
      }, { onConflict: "id" }).then(({ error }) => { if (error) warnProfileFallback(error); });
      return next;
    });
  };

  const value = useMemo<AuthContextValue>(() => ({
    status, user, profile, selectedCity: profile ? (({ address: _address, ...city }) => city)(profile) : readLocalCity(), profileLoading, tracked,
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      return error ? { error: error.message } : { destination: "/onboarding" };
    },
    signIn: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      try {
        const row = data.user ? await fetchRemoteProfile(data.user) : null;
        return { destination: profileFromRow(row) ? "/dashboard" : "/onboarding" };
      } catch (reason) {
        warnProfileFallback(reason);
        return { destination: readLocalProfile() ? "/dashboard" : "/onboarding" };
      }
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      return error?.message;
    },
    saveProfile, toggleTracked,
  }), [profile, profileLoading, status, tracked, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
