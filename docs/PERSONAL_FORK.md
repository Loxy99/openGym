# Personal fork contract

Upstream: https://github.com/DuarteSantos8/openGym
Fork/source offer: https://github.com/Loxy99/openGym/tree/personal
Initial baseline: v1.4.2, e9a303877d02e4237b183f96a9a6603990e8fafb.

- `main` tracks upstream without personal edits.
- `personal` carries reviewed customizations and deployment tooling.
- `feature/*` branches isolate features; `update/*` branches integrate published releases.
- Never force-reset or replace `personal` with upstream. Merge releases into an
  update branch so ancestry and local changes survive.

Current custom surface: external Allenamento backup converter and tests, isolated
Compose configuration, fork CI/image workflow and operating documentation. No
training algorithm, authentication handler or JSON storage replacement is needed.
Keep personal data, runtime configuration, snapshots and enrollment codes OUT of Git.

## Updating

```sh
git fetch upstream --tags
git switch personal
git switch -c update/SELECTED_RELEASE
git merge --no-ff SELECTED_RELEASE_TAG
# Resolve conflicts, run CI and open a PR targeting personal.
gh pr create --base personal
```

Replace the placeholders with a real published release after reading its release
notes. Verify `git merge-base --is-ancestor <release-commit> HEAD`. Merge only after
Personal CI checks pass. The images job builds and boots web+API, then publishes
`ghcr.io/loxy99/opengym-{api,web}:sha-<full-commit>`; it never deploys automatically.
Record registry digests and promote the exact tested image IDs/digests through
isolated staging before production. See OPERATIONS.md.

Inherited Pages, GitLab mirroring, mobile signing, catalogue publishing and CLA
workflows are intentionally disabled in this fork's repository settings. Do not
re-enable them accidentally during updates. Never sign upstream's CLA for the user.

Review upstream security updates promptly. A future database migration is a specific
staging and backup-restore gate; do not run old code against newly migrated data
without proof of compatibility. Keep local patches small and retire them when an
upstream replacement is verified.

Keep AGPL-3.0-or-later and NOTICE.md intact. Exercise media have separate licensing:
retain their notices and observe non-commercial openGym-fork restrictions; AGPL
coverage of code does not relicense the media.
