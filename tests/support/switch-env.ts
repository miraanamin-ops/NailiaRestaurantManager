// Runs before every test file. Vercel runs the tests during its build with the
// deployment's own settings, so the switches set there (EMAIL_REDIRECT,
// AGENTS_LIVE_ALLOWED...) would leak into tests that expect the defaults and
// could stop a deploy. Each test sets the switches it needs itself. TEST_MODE is
// left alone: CI runs the whole suite with it unset and with TEST_MODE=true.
for (const name of ["EMAIL_REDIRECT", "TEST_TOOLS", "GOOGLE_MODE", "AGENTS_LIVE_ALLOWED", "VERCEL_ENV", "TEST_EMAIL_ALLOW"]) delete process.env[name];
