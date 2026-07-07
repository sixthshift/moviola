import { defineConfig } from '@playwright/test'

// Fixture geometry (e2e/fixture.html) assumes a 1000×800 viewport so the
// SPEC §5 math is exact; suites that need other sizes override.
const use = {
  browserName: 'chromium',
  viewport: { width: 1000, height: 800 },
  // Container runs as root, where Chromium's sandbox refuses to start.
  launchOptions: { chromiumSandbox: false },
} as const

export default defineConfig({
  testDir: 'e2e',
  // Generous per-test budget: validator.spec spawns a full browser-driving
  // CLI per test (forward + reverse + jump passes with 500ms dwells).
  timeout: 120_000,
  // Suites drive real scrolling against hand-tuned fixture geometry; parallel
  // workers are fine because each test gets its own page. Capped: each worker
  // is a Chromium, and validator tests spawn a second one — uncapped workers
  // can OOM-crash renderers on smaller machines.
  fullyParallel: true,
  workers: 4,
  projects: [
    {
      name: 'chromium',
      testIgnore: 'validator.spec.ts',
      use,
    },
    {
      // validator.spec spawns its OWN headless Chromium per test (on top of
      // this project's own browser), and one test spawns two. Two Chromiums
      // per worker times several concurrent workers reliably OOM-crashes
      // renderers ("Target crashed"/"Page crashed") under the shared
      // `workers: 4` cap above. Pin this project to a single worker so its
      // validator-spawned browsers never run concurrently with each other;
      // the rest of e2e keeps the full worker pool.
      name: 'chromium-validator',
      testMatch: 'validator.spec.ts',
      workers: 1,
      use,
    },
  ],
})
