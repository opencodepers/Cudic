// ── Glox config ────────────────────────────────────────────────────
// Local dev (localhost) talks to the local backend (same host) so new
// endpoints work before they deploy. Production uses the Render backend.
const WS_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? ''
  : 'wss://glox-o7rr.onrender.com';

// Supabase credentials (for client-side auth)
const SUPABASE_URL = 'https://qgcydphkaujomxyzwcht.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnY3lkcGhrYXVqb214eXp3Y2h0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMDQxNTEsImV4cCI6MjEwODg4MDE1MX0.dk82qI_STQS0qlIn_vyLapXw6XVUQYuLOvI2AcQEJCk';
// OLD project (backup) was: https://opimjwmgmzwapkzgxvhk.supabase.co
