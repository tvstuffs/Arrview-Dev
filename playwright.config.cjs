const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({
  testDir: './tests/e2e', testMatch: '*.spec.cjs', workers: 1,
  use: { baseURL: 'https://localhost:18778', ignoreHTTPSErrors: true,
    launchOptions: { args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP arrview.test 127.0.0.1', '--no-proxy-server'] }, trace: 'retain-on-failure' },
  webServer: { command: 'node tests/e2e/fixture.cjs', url: 'https://localhost:18778/api/health',
    ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 20000 },
})
