# Allenamento migration (openGym v1.4.2)

Use an offline, consistent PostgreSQL snapshot of `users`, `programs`, `routines`,
`routine_exercises`, `exercises`, `workout_sessions`, and `workout_sets`.
Read in a single `REPEATABLE READ READ ONLY` transaction. Do not use the workout
list API: it only returns the most recent 180 sessions. Exclude connection strings,
passwords and session credentials from the export. Keep the export outside Git.

```sh
node --test tools/migration/*.test.mjs
node tools/migration/convert.mjs /private/source.json /private/new-backups
# Optional real-data roundtrip, runs a disposable local API and removes it afterwards:
cd frontend
OPENGYM_SOURCE=/private/source.json OPENGYM_REPORT=/private/report.json \
  npm test -- src/store/useStore.allenamento.test.jsx --maxWorkers=1
```

The output directory must not exist. It is created mode 700; JSON files are mode
600. `manifest.json` contains SHA-256 hashes, per-user backup filenames and the
reconciliation report. Each profile file is an actual openGym JSON backup, imported
in Settings → Data → Import. Never import the manifest itself.

## Mapping and deliberate representation choices

- Separate profile per source user. Deterministic IDs preserve same-day sessions;
  dates are derived in Europe/Rome, not the host's timezone.
- Session start and recorded active duration become `start` and `end`. The original
  completion timestamp, exercise completion counts, notes and source row remain
  under `allenamento.session`. Duration is not recomputed from wall-clock end.
- Every available set retains exact weight/reps/RIR/completion and original row
  metadata. Null load stays null, not a fabricated measured zero. openGym's own
  numerical charts may treat an unknown load as zero contribution to volume; the
  session note identifies unknown loads. Historical effort is retained as RIR.
- Summary-only sessions remain workouts with no entries and a readable note.
  Never synthesize historical sets from the present-day routine.
- Custom exercise identities avoid speculative matching against a different
  catalogue variation. Names, equipment, instructions and original metadata survive.
  Original media IDs remain metadata; they are NOT automatically licensed/copied or
  mapped to openGym catalogue media. Imported custom exercises initially have no media.
- Programme grouping is represented in routine notes and original programme
  metadata, not claimed to be a native programme hierarchy. Archived routines stay
  available and marked in notes; they are excluded from the new active rotation.
- Routine ranges retain a lower and upper rep bound where supported; the upper
  bound is the initial target. Timed prescriptions use seconds. Rest ranges use
  their upper bound. Per-leg wording remains in the note; no unilateral set count
  is doubled and no load convention is guessed. Starting planned load is zero
  (a new-session placeholder, NOT historical data). Progression stays off.
- The active programme's routines become a rotation starting after its latest
  logged routine. Reminders and AI coaching remain disabled during migration.

## Import safety

Import into a fresh destination. The converter is not an ongoing bidirectional
sync and cannot resolve arbitrary edits made independently in both apps. Repeating
the same backup in an otherwise empty profile is tested and produces no duplicates,
but replacing a used profile can overwrite newer training. Take a full backup,
inspect the UI's conflict prompt and reconcile source IDs before any later import.
Use one explicit final cutover window; do not silently re-import over new workouts.

`useStore.allenamento.test.jsx` tests the real store, backup reader, API persistence,
repeat imports, server restart and reload. Its default source is synthetic. Real
exports and reports must never enter Actions, artifacts or this public repository.
