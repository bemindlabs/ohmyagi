// Playwright MCP's configuration for one task, printed as JSON (entrypoint.sh).
// Read from the environment the container was started with; every value here
// was already checked by om-agi (src/browser/) before `docker run`.
const allowed = (process.env.OM_AGI_ALLOW ?? "").split(",").filter((origin) => origin !== "");
const hostPort = Number(process.env.OM_AGI_HOST_PORT);
if (allowed.length === 0 || !Number.isInteger(hostPort)) {
  console.error("om-agi browser: OM_AGI_ALLOW and OM_AGI_HOST_PORT are required");
  process.exit(64);
}
const config = {
  browser: {
    browserName: "chromium",
    // A fresh, in-memory profile: nothing from one task reaches the next.
    isolated: true,
    launchOptions: {
      headless: true,
      // Dockerfile: the container is the fence, Chromium's sandbox cannot start in it.
      chromiumSandbox: false,
      proxy: { server: "http://127.0.0.1:3128" },
      // Where the live trace below lands.
      tracesDir: "/out/trace",
    },
    contextOptions: { viewport: { width: 1280, height: 720 }, serviceWorkers: "block", acceptDownloads: false },
    initPage: ["/opt/om-agi/record.cjs"],
  },
  server: {
    // Behind the guard (guard.mjs), which is what the published port reaches; the
    // firewall lets only the guard's uid connect here.
    host: "127.0.0.1",
    port: 8932,
    // DNS-rebinding guard: only requests addressed to the host-side loopback port.
    allowedHosts: [`127.0.0.1:${hostPort}`, `localhost:${hostPort}`],
  },
  network: { allowedOrigins: allowed },
  webmcp: false,
  // Playwright MCP's session log writes every typed value in clear; the guard's
  // action log (actions.jsonl) records the calls with typed values redacted.
  saveSession: false,
  outputDir: "/out/session",
};
process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
