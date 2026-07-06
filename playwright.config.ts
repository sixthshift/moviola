import { defineConfig } from '@playwright/test'

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
      use: {
        browserName: 'chromium',
        // Fixture geometry (e2e/fixture.html) assumes a 1000×800 viewport so
        // the SPEC §5 math is exact; suites that need other sizes override.
        viewport: { width: 1000, height: 800 },
        // Container runs as root, where Chromium's sandbox refuses to start.
        launchOptions: { chromiumSandbox: false },
      },
    },
  ],
})
