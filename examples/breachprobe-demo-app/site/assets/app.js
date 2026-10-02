// demo-app's browser bundle. It talks to the hosted database with the public anon key, and it
// carries two of the defects BreachProbe's sample report finds in the browser code.
const SUPABASE_URL = "https://demoappnotesfixtures.supabase.co";
const SUPABASE_ANON_KEY = "__ANON_KEY__";
const createClient = window.supabase?.createClient ?? (() => ({ from: () => ({ select: async () => [] }) }));
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function loadNotes() {
  return db.from("notes").select("*");
}

export async function loadProfile() {
  return db.from("profiles").select("email");
}

export function signIn(session) {
  localStorage.setItem("auth_token", session.access_token);
}

export function showAdmin(user) {
  if (user.role === "admin") document.body.classList.add("admin");
}
