import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertAllenamento } from './allenamento.mjs';
import * as migration from './allenamento.mjs';

export const fixture = () => ({
  users: [{ id: 'u1', display_name: 'Example', active_program_id: 'p1' }, { id: 'u2', display_name: 'Other' }],
  programs: [{ id: 'p1', user_id: 'u1', name: 'Example plan', description: 'Training plan', archived_at: null }],
  routines: [{ id: 'r1', program_id: 'p1', name: 'Upper A', sort_order: 0, archived_at: null }],
  routine_exercises: [{ id: 1, routine_id: 'r1', exercise_id: 'back-squat', sort_order: 0, sets: 3, reps: '6–10', rest: '2–3 min' }],
  exercises: [{ id: 'back-squat', name: 'Example squat', muscles: ['Quadricipiti', 'Glutei'], equipment: 'Bilanciere', cue: 'Brace', instructions: ['Keep control'] }],
  workout_sessions: [{ id: 1, user_id: 'u1', client_id: 'original-1', routine_id: 'r1', routine_name: 'Upper A', started_at: '2026-09-01T18:00:00Z', completed_at: '2026-09-01T19:00:00Z', duration_seconds: 3600, completed_exercises: 6, total_exercises: 7, notes: 'Original note' }],
  workout_sets: [],
});
const options = { now: 1790000000000, timeZone: 'Europe/Rome' };

test('rejects orphan child rows rather than dropping them', () => {
  const f = fixture();
  f.workout_sets.push({ id: 1, session_id: 999, exercise_id: 'back-squat', set_number: 1, weight_kg: 10, reps: 5, rir: null, completed: true });
  assert.throws(() => convertAllenamento(f, options), /orphan/);
});
test('rejects duplicate session source identities', () => {
  const f = fixture(); f.workout_sessions.push({ ...f.workout_sessions[0], id: 2 });
  assert.throws(() => convertAllenamento(f, options), /duplicate/);
});
test('rejects timezone-ambiguous timestamps and invalid dates', () => {
  const f = fixture(); f.workout_sessions[0].started_at = '2026-09-01 18:00:00';
  assert.throws(() => convertAllenamento(f, options), /timestamp/);
});
test('local calendar day handles UTC midnight and DST without host timezone dependence', () => {
  const f = fixture(); f.workout_sessions[0].started_at = '2026-09-01T23:30:00Z';
  assert.equal(convertAllenamento(f, options).profiles[0].state.workouts[0].d, '2026-09-02');
});
test('conversion does not mutate source', () => {
  const f = fixture(); const copy = structuredClone(f); convertAllenamento(f, options); assert.deepEqual(f,copy);
});
test('reconciliation catches changed destination fields, not only counts', () => {
  const f = fixture(); const out = convertAllenamento(f, options);
  assert.equal(typeof migration.reconcileAllenamento, 'function');
  assert.equal(migration.reconcileAllenamento(f, out).ok, true);
  out.profiles[0].state.workouts[0].start++;
  assert.equal(migration.reconcileAllenamento(f, out).ok, false);
});

test('routines retain ranges, rest, original exercise identity and user ownership', () => {
  const f = fixture();
  f.exercises.push({ id: 'plank', name: 'Plank', muscles: ['Addome'], equipment: 'Corpo libero' });
  f.routine_exercises.push({ id: 2, routine_id: 'r1', exercise_id: 'plank', sort_order: 1, sets: 2, reps: '30–60 sec', rest: '60 sec' });
  const out = convertAllenamento(f, options);
  const state = out.profiles[0].state;
  assert.equal(state.routines.length, 1);
  assert.equal(out.profiles[1].state.routines.length, 0);
  const [squat, plank] = state.routines[0].ex;
  assert.equal(squat.repsMin, 6);
  assert.equal(squat.reps, 10);
  assert.equal(squat.restSec, 180);
  assert.equal(plank.mode, 'time');
  assert.equal(plank.sec, 60);
  assert.equal(state.routines[0].allenamento.routine.id, 'r1');
  assert.ok(state.customEx.some(e => e.id === squat.id));
  assert.equal(state.rotation.sequence[0], state.routines[0].id);
});

test('summary-only sessions survive without invented sets, with duration and completion metadata', () => {
  const out = convertAllenamento(fixture(), options);
  const s = out.profiles.find(p => p.sourceUserId === 'u1').state;
  assert.equal(s.workouts.length, 1);
  const w = s.workouts[0];
  assert.deepEqual(w.entries, []);
  assert.equal(w.end - w.start, 3600000);
  assert.equal(w.allenamento.session.completed_exercises, 6);
  assert.match(w.note, /Original note/);
  assert.match(w.note, /6\/7/);
  assert.equal(out.profiles.find(p => p.sourceUserId === 'u2').state.workouts.length, 0);
});

test('all sets, null load and RIR keep exact values and source identity across same-day sessions', () => {
  const f = fixture();
  f.workout_sessions.push({ ...f.workout_sessions[0], id: 2, client_id: 'original-2', started_at: '2026-09-01T20:00:00Z' });
  f.workout_sets = [
    { id: 1, session_id: 1, exercise_id: 'back-squat', set_number: 1, weight_kg: 42.125, reps: 8, rir: 0, completed: true },
    { id: 2, session_id: 2, exercise_id: 'back-squat', set_number: 1, weight_kg: null, reps: 10, rir: null, completed: false },
  ];
  const out = convertAllenamento(f, options);
  const ws = out.profiles[0].state.workouts;
  assert.equal(ws.length, 2);
  assert.notEqual(ws[0].id, ws[1].id);
  assert.equal(ws[0].entries[0].sets[0].w, 42.125);
  assert.equal(ws[0].entries[0].sets[0].rir, 0);
  assert.equal(ws[1].entries[0].sets[0].w, null);
  assert.equal(ws[1].entries[0].sets[0].done, false);
  assert.ok(!('rir' in ws[1].entries[0].sets[0]));
  assert.deepEqual(convertAllenamento(f, options), out);
});
