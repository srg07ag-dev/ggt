import { defineConfig } from "@playwright/test";

const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "./e2e",
  workers: 1, // Better Auth limite les inscriptions par IP (protection volontaire)
  use: { baseURL: "http://localhost:3100", launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
