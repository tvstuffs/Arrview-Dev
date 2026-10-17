// Existing end-to-end coverage drives the Classic layout; Modern is the default, so these tests opt in.
// Works on a page or a browser context (both expose addInitScript).
const seedClassic = target => target.addInitScript(() => localStorage.setItem('arrview.ui.v1.layout', JSON.stringify('classic')))
module.exports = { seedClassic }
