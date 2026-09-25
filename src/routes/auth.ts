import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../lib/types";
import { exchangeCode, getProfile } from "../lib/trakt";
import { encrypt } from "../lib/crypto";
import { generateOAuthState } from "../lib/tokens";
import { upsertUser } from "../db/queries";
import { createSession, destroySession } from "../middleware/session";

const STATE_COOKIE = "oauth_state";

const auth = new Hono<AppEnv>();

// Comma-separated Trakt usernames/slugs allowed to sign in. Unset means nobody.
function isAllowedUser(env: CloudflareBindings, username: string, slug: string): boolean {
  const allowed = (env.ALLOWED_TRAKT_USERS ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(username.toLowerCase()) || allowed.includes(slug.toLowerCase());
}

auth.get("/trakt", (c) => {
  const state = generateOAuthState();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.env.TRAKT_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    state,
  });

  return c.redirect(`https://trakt.tv/oauth/authorize?${params}`);
});

auth.get("/callback", async (c) => {
  const expectedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  const state = c.req.query("state");
  if (!expectedState || !state || state !== expectedState) {
    return c.redirect("/?error=invalid_state");
  }

  const code = c.req.query("code");
  if (!code) {
    return c.redirect("/?error=no_code");
  }

  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;

  try {
    const tokens = await exchangeCode(
      code,
      c.env.TRAKT_CLIENT_ID,
      c.env.TRAKT_CLIENT_SECRET,
      redirectUri
    );

    const profile = await getProfile(c.env.TRAKT_CLIENT_ID, tokens.access_token);

    if (!isAllowedUser(c.env, profile.username, profile.ids.slug)) {
      return c.redirect("/?error=not_allowed");
    }

    const encryptedAccess = await encrypt(tokens.access_token, c.env.ENCRYPTION_KEY);
    const encryptedRefresh = await encrypt(tokens.refresh_token, c.env.ENCRYPTION_KEY);
    const expiresAt = tokens.created_at + tokens.expires_in;

    const user = await upsertUser(
      c.env.DB,
      profile.ids.slug,
      profile.username,
      encryptedAccess,
      encryptedRefresh,
      expiresAt
    );

    await createSession(c, {
      userId: String(user.id),
      traktUsername: user.trakt_username ?? profile.username,
      createdAt: Date.now(),
    });

    return c.redirect("/dashboard");
  } catch (e) {
    console.error("OAuth callback error:", e);
    return c.redirect("/?error=auth_failed");
  }
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  return c.redirect("/");
});

export default auth;
