# TikTok collector

The application uses the upstream REST interface, not a vendored signer or the Zen extension. Source, revision and MIT license are recorded in `upstream.json`. Upstream copyright and license remain with the installed source under `.local/tiktok-native/upstream`.

Install with `npm run setup:tiktok`. Start e-content normally with `npm run dev`; the server starts and stops the collector on demand. All runtime files are under `.local` and excluded from Git and Vite file serving.

See `docs/architecture/tiktok-native.md` for the contract, real verification results and limitations. Public access does not authenticate ownership of a TikTok profile.
