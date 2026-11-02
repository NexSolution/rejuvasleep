import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.REJUVA_CONFIG || {};
export const sb = createClient(CFG.supabaseUrl, CFG.supabaseKey);

// Folder the site lives in, e.g. https://nexsolution.github.io/rejuvasleep/
export const siteBase = new URL(".", location.href).href;

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function readLocalQuiz() {
  try { return JSON.parse(localStorage.getItem("rejuva_quiz") || "null"); } catch (e) { return null; }
}

export function friendlyError(err) {
  const m = (err && (err.message || err.error_description)) || String(err || "");
  if (/invalid login/i.test(m)) return "That email and password don't match. Try again or reset your password.";
  if (/already registered|already exists/i.test(m)) return "There's already an account with that email. Log in instead.";
  if (/email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox (and spam) for the link.";
  if (/password.*(6|characters|short)/i.test(m)) return "Your password needs at least 8 characters.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (/failed to fetch|network/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  return m || "Something went wrong. Please try again.";
}
