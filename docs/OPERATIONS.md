# Private-instance operations

Use deploy/compose.selfhost.yaml, not the upstream compose file's wildcard bind.
Runtime env/configuration and data live outside Git. Every instance needs its own
Compose project name, DATA_DIR and WEB_PORT. The API has no host port. Web binds
only to loopback, and approved Tailscale Serve terminates HTTPS; never use Funnel.
Set RP_ID to the bare hostname, ORIGIN to the exact HTTPS origin including its port.
The immutable image must be built from this fork, not upstream's latest tag.

```sh
docker compose --env-file /private/runtime.env -p opengym \
  -f /path/to/deploy/compose.selfhost.yaml config -q
docker compose --env-file /private/runtime.env -p opengym \
  -f /path/to/deploy/compose.selfhost.yaml up -d --wait --wait-timeout 120
curl --fail http://127.0.0.1:3180/api/health
```

Verify Docker's published address is 127.0.0.1, HTTPS health with normal certificate
validation, Serve says tailnet-only and Funnel exposes nothing. Do not replace the
old application's existing route during rehearsal. Preserve the whole repository's
notices and provide the modified source URL in docs/PERSONAL_FORK.md.

## Initial accounts and import

Pre-provision source users only while the new API is stopped and its data directory
is empty. Generate a new 32-byte random session secret and a db.json containing
`users`, `creds: []`, `subs: []`, `invites: []`, `deviceLinks: []`. Users have random
stable destination IDs, source display names, an ISO `created` timestamp, and only
the designated owner's `admin: true, owner: true`. Keep the mapping private. Do not
copy Allenamento passwords or authentication sessions.

Start the API. Import each converted backup through the actual app importer or the
authenticated PUT /api/data route, guarded against a non-empty destination. Read the
saved document back and run reconcileAllenamento; a 200 alone proves nothing.
Never edit state files while the API is running. Keep signups invite-only, guest and
password login off, FIRST_USER_ADMIN off and COACH_DISABLED on.

To enroll a real device into a pre-provisioned account, use a short-lived one-time
device link. For an already enrolled account, POST /api/account/device-link requires
both a session AND an owner proof (passkey or password). A signed session alone is
not sufficient. For initial enrollment only, an operator with local access must stop
the API, call createDeviceLink from api/device-link.js, save db.json, then restart.
Never bypass owner proof on a running server or relax the authentication routes.
Only hand an enrollment link to its account owner through a private channel. It is
a credential, expires after ten minutes and is burned on its first successful
passkey registration. Do not log it, put it in Git, or leave a browser-test passkey
on a real account. The user must complete Face ID/Touch ID on their own device.

## Consistent backup and restore

1. Record deployed image IDs/digests, fork commit, runtime env and Compose file.
2. Stop only this instance's API and web, with `docker compose ... stop`.
3. Archive its full data directory (users, credentials, secret, VAPID keys, states,
   uploads, audit log) plus deployment configuration; preserve ownership/modes.
4. Start this instance in a shell EXIT trap even if backup creation fails.
5. Encrypt the archive before it leaves the host. Store the key outside its backup
   destination. A mode-600 unencrypted working archive is not an off-site backup.
6. Keep at least daily snapshots with a stated retention; verify decryption and
   archive checksums. Do not prune the only known-good restore point.

Restore into a NEW isolated data directory and a different Compose project/loopback
port, with notifications and coaching disabled. Use the same tested images, verify
GET /api/health and authenticated GET /api/data, then reconcile every session/set.
Do not expose or enroll real devices into a restore-drill instance. Reuse of its
RP_ID during a local-only probe does not establish a second valid production origin.
After testing, stop only the drill project; preserve the verified backup.

A second folder or disk attached to the same server is not off-site protection.
Choose a separate device/failure domain and encryption key destination with the user
before claiming disaster recovery is complete.

## Upgrade and rollback

- Read release and storage compatibility notes. Merge upstream into update/*;
  require Personal CI checks before merge into personal.
- Build uniquely tagged images, record actual image digests/IDs, and boot the
  candidate on isolated staging. Never pull latest as an update policy.
- Back up production consistently before promotion. Set runtime image references
  to the exact tested versions, render Compose, recreate only this project, probe
  health, authentication and persisted training data, then verify on iPhone.
- Roll back matching images AND pre-upgrade data into an isolated directory first;
  repoint production only after the pair is verified. Keep the failed data for
  investigation, do not overwrite it in place.
- Until a newer upstream release exists, call a no-op branch merge or a fixture
  promotion a rehearsal, not a verified future-version upgrade.

## Human acceptance gates

Server tests cannot validate the user's iCloud passkey or iPhone PWA lifecycle.
Verify enrollment/sign-in on the real phone, representative old/recent sessions,
a synthetic workout/edit/reload, a second device, offline reconnect without
duplicates, and Add to Home Screen/cold launch. Keep the old app and snapshot until
the user accepts those checks and a restore drill. Do not claim cutover complete
just because containers are healthy.
