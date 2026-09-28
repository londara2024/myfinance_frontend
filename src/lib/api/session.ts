import { cookies, headers } from "next/headers";

import type { SessionResponse } from "./types";

/**
 * The session cookie.
 *
 * <p>The bearer token lives in an **httpOnly** cookie, never in `localStorage`. A token in
 * `localStorage` is readable by any script that ends up on the page — one XSS and the attacker has
 * a 30-day session. httpOnly means JavaScript cannot read it at all; it is attached by the browser
 * and read only on the server.
 *
 * The consequence, which shapes the rest of this integration: **the browser never holds the
 * token**, so every backend call has to originate on the server (Server Component, Server Action,
 * or Route Handler). That is why there is no client-side `fetch` to :8080 anywhere in this app.
 */
const TOKEN_COOKIE = "myfinance_token";

/** A small, non-sensitive copy of who is signed in, so the shell can render without a round trip. */
const PROFILE_COOKIE = "myfinance_profile";

/**
 * Whether the cookies carry the `Secure` flag, decided per request.
 *
 * <p>Browsers silently drop a `Secure` cookie sent over plain http from anything but `localhost`, so
 * a fixed "Secure in production" rule made `http://192.168.x.x:3000` (Docker on a LAN) unable to
 * sign in. Instead: Secure whenever the request itself arrived over https — Render and a Cloudflare
 * Tunnel both terminate TLS in front of us and say so in `x-forwarded-proto`, and a Server Action's
 * `Origin` names the scheme the browser used. Plain http gets a plain cookie, which is the only kind
 * that browser would keep anyway.
 *
 * <p>`COOKIE_SECURE=true|false` forces it either way.
 */
async function isSecureRequest(): Promise<boolean> {
  const forced = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (forced === "true" || forced === "false") {
    return forced === "true";
  }
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  const h = await headers();
  // A proxy chain can append: "https, http". The first entry is what the browser used.
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https" || (h.get("origin")?.startsWith("https://") ?? false);
}

export type SessionProfile = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  initials: string;
  baseCurrency: string;
};

export async function getToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value;
}

export async function getProfile(): Promise<SessionProfile | undefined> {
  const store = await cookies();
  const raw = store.get(PROFILE_COOKIE)?.value;
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as SessionProfile;
  } catch {
    // A malformed cookie is not worth a crash — treat it as signed out.
    return undefined;
  }
}

/** Called from the login / register Server Actions. */
export async function startSession(session: SessionResponse): Promise<void> {
  const store = await cookies();
  const secure = await isSecureRequest();

  // Mirror the backend's own expiry so the cookie and the server-side session row die together.
  // Otherwise the cookie outlives the session and every request 401s with the user still "signed in".
  const expires = new Date(session.expiresAt);

  store.set(TOKEN_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    // Lax rather than Strict: Strict would drop the cookie on a top-level navigation from an
    // external link, so following a link into the app would look like a logout.
    secure,
    path: "/",
    expires,
  });

  const profile: SessionProfile = {
    userId: session.userId,
    email: session.email,
    firstName: session.firstName,
    lastName: session.lastName,
    initials: session.initials,
    baseCurrency: session.baseCurrency,
  };

  // Readable by the client on purpose: it is only a display name and initials. The token is not
  // in here, so nothing sensitive is exposed by dropping httpOnly.
  store.set(PROFILE_COOKIE, JSON.stringify(profile), {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(PROFILE_COOKIE);
}

export const SESSION_COOKIE_NAMES = {
  token: TOKEN_COOKIE,
  profile: PROFILE_COOKIE,
} as const;
