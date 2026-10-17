# FieldBook Beta branch

`fieldbook/beta` is the field-test build. `main` (the live GitHub Pages site) is left alone.

- New features from the vault's beta loop (Playbook job 10) land here, one commit per feature.
- The beta site deploys from this branch, so it updates within a minute or two of each push.
- Beta and main are on different web addresses, so their saved data is separate. Move projects between them with the app's export/import.
- To promote features to the live app, Steve merges this branch into `main` himself. Before merging, change the beta name back in `manifest.json`, `index.html` `<title>` and `sw.js` `CACHE_NAME`.
- Every push still bumps `CACHE_NAME` in `sw.js` (pattern `fieldbook-beta-v<main version>.<n>`).
