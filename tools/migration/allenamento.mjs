// Offline Allenamento snapshot -> openGym backup states. No credentials or network access.
import crypto from 'node:crypto';
export const stableId = (kind, value) => 'al_' + kind + '_' + crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
const localDay = (timestamp, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));

export function convertAllenamento(source, { now = Date.now(), timeZone = 'Europe/Rome' } = {}) {
  const tables = ['users','programs','routines','routine_exercises','exercises','workout_sessions','workout_sets'];
  for (const t of tables) {
    if (!Array.isArray(source[t])) throw new Error(`missing table ${t}`);
    const ids = source[t].map(r => r.id);
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate id in ${t}`);
  }
  const has = (table,id) => source[table].some(x => x.id === id);
  for (const p of source.programs) if (!has('users',p.user_id)) throw new Error('orphan program');
  for (const r of source.routines) if (!has('programs',r.program_id)) throw new Error('orphan routine');
  for (const e of source.routine_exercises) if (!has('routines',e.routine_id) || !has('exercises',e.exercise_id)) throw new Error('orphan routine exercise');
  const clients = source.workout_sessions.map(w => w.client_id);
  if (new Set(clients).size !== clients.length) throw new Error('duplicate session client_id');
  for (const w of source.workout_sessions) {
    if (!has('users',w.user_id) || !has('routines',w.routine_id)) throw new Error('orphan session');
    const routine = source.routines.find(r => r.id === w.routine_id);
    if (source.programs.find(p => p.id === routine.program_id).user_id !== w.user_id) throw new Error('session ownership mismatch');
    for (const key of ['started_at','completed_at']) if (!/(Z|[+-]\d{2}:\d{2})$/.test(w[key]) || !Number.isFinite(Date.parse(w[key]))) throw new Error(`invalid timestamp ${key}`);
    if (!Number.isFinite(w.duration_seconds) || w.duration_seconds < 0) throw new Error('invalid duration');
  }
  for (const s of source.workout_sets) {
    if (!has('workout_sessions',s.session_id) || !has('exercises',s.exercise_id)) throw new Error('orphan set');
    for (const k of ['weight_kg','reps','rir']) if (s[k] != null && (!Number.isFinite(s[k]) || s[k] < 0)) throw new Error(`invalid set ${k}`);
    if (typeof s.completed !== 'boolean') throw new Error('invalid completion flag');
  }
  const profiles = source.users.map(user => ({
    sourceUserId: user.id, name: user.display_name,
    state: { unit: 'kg', lang: 'it', theme: 'dark', accent: 'lime', effort: 'rir',
      routines: [], customEx: [], workouts: source.workout_sessions.filter(w => w.user_id === user.id).map(w => {
        const start = Date.parse(w.started_at);
        const groups = new Map();
        for (const s of source.workout_sets.filter(s => s.session_id === w.id).sort((a,b) => a.set_number - b.set_number || a.id - b.id)) {
          if (!groups.has(s.exercise_id)) groups.set(s.exercise_id, []);
          groups.get(s.exercise_id).push({ w: s.weight_kg, r: s.reps, done: s.completed,
            ...(s.rir != null ? { rir: s.rir } : {}), allenamento: structuredClone(s) });
        }
        const entries = [...groups].map(([id, sets]) => ({ id: stableId('exercise', id), sets }));
        const volume = entries.reduce((n,e) => n + e.sets.reduce((v,s) => v + (s.done && s.w != null && s.r != null ? s.w * s.r : 0),0),0);
        return { id: stableId('session', w.client_id), d: localDay(start, timeZone), start,
          end: start + w.duration_seconds * 1000, routineId: null, name: w.routine_name,
          entries, prs: [], vol: volume, _ts: now,
          note: [w.notes, `Allenamento: ${w.completed_exercises}/${w.total_exercises} esercizi; ${entries.length ? 'serie importate; eventuali carichi mancanti non sono zeri misurati' : 'dettagli delle serie non registrati'}.`].filter(Boolean).join('\n'),
          allenamento: { session: structuredClone(w) } };
      }).sort((a,b) => a.start - b.start), bodyweight: [], measurements: [], exWeights: {}, exNotes: {}, week: {}, dayPlan: {}, active: null, _ts: now,
      reminder: { on: false, nudge: false, time: '08:00', tz: timeZone } }
  }));
  for (const profile of profiles) {
    const user = source.users.find(u => u.id === profile.sourceUserId);
    const programs = source.programs.filter(p => p.user_id === user.id);
    const owned = new Set(programs.map(p => p.id));
    const routines = source.routines.filter(r => owned.has(r.program_id)).sort((a,b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    const used = new Set(profile.state.workouts.flatMap(w => w.entries.map(e => e.id)));
    profile.state.routines = routines.map(r => ({ id: stableId('routine', r.id), name: r.name, emoji: 'barbell', prog: 'off',
      note: [programs.find(p => p.id === r.program_id)?.name, r.focus, r.warmup, r.archived_at ? 'Archiviata in Allenamento' : null].filter(Boolean).join('\n'),
      allenamento: { routine: structuredClone(r), program: structuredClone(programs.find(p => p.id === r.program_id)) },
      ex: source.routine_exercises.filter(e => e.routine_id === r.id).sort((a,b) => a.sort_order - b.sort_order || a.id - b.id).map(e => {
        const id = stableId('exercise', e.exercise_id); used.add(id);
        const range = [...e.reps.matchAll(/\d+/g)].map(x => Number(x[0]));
        const rests = [...e.rest.matchAll(/\d+/g)].map(x => Number(x[0]));
        const timed = /sec/i.test(e.reps);
        return { id, sets: e.sets, weight: 0, restSec: Math.max(...rests,0) * (/min/i.test(e.rest) ? 60 : 1),
          ...(timed ? { mode: 'time', sec: Math.max(...range,1) } : { reps: Math.max(...range,1), ...(range.length > 1 ? { repsMin: range[0] } : {}) }),
          note: `${e.reps}; recupero ${e.rest}. Valori originali Allenamento.`, allenamento: structuredClone(e) };
      }) }));
    profile.state.customEx = source.exercises.filter(e => used.has(stableId('exercise', e.id))).map(e => {
      const muscle = { Quadricipiti: ['upper legs','quadriceps'], Glutei: ['upper legs','glutes'], Femorali: ['upper legs','hamstrings'], Petto: ['chest','pectorals'], 'Petto alto': ['chest','pectorals'], Addome: ['waist','abs'], 'Gran dorsale': ['back','lats'], Bicipiti: ['upper arms','biceps'], Tricipiti: ['upper arms','triceps'], Polpacci: ['lower legs','calves'], 'Deltoide laterale': ['shoulders','delts'], 'Deltoide posteriore': ['shoulders','delts'] };
      const [bp,tg] = muscle[e.muscles?.[0]] || ['full body',''];
      return { id: stableId('exercise', e.id), n: e.name, bp, tg, eq: e.equipment, custom: true,
        desc: [e.cue, ...(e.instructions || [])].filter(Boolean).join('\n'), allenamento: structuredClone(e) };
    });
    for (const w of profile.state.workouts) w.routineId = stableId('routine', w.allenamento.session.routine_id);
    const activeRoutines = routines.filter(r => !r.archived_at && r.program_id === user.active_program_id).map(r => stableId('routine',r.id));
    if (activeRoutines.length) {
      const last = profile.state.workouts.at(-1)?.routineId;
      const next = (activeRoutines.indexOf(last) + 1) % activeRoutines.length;
      const ids = [...activeRoutines.slice(next),...activeRoutines.slice(0,next)];
      const rotationId = stableId('rotation', user.id);
      profile.state.rotation = { id: rotationId, sequence: ids, label: programs.find(p => p.id === user.active_program_id)?.name || 'Allenamento' };
      profile.state.queue = { ids, since: now, startsOn: localDay(now,timeZone), label: profile.state.rotation.label, rotationId };
      profile.state.scheduleMode = 'rotation';
    }
  }
  return { profiles };
}

// Compare persisted semantic values with the authoritative source, including missing loads.
export function reconcileAllenamento(source, result) {
  const errors = [];
  const eq = (actual,expected,label) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(label); };
  eq(result.profiles.length,source.users.length,'profile count');
  for (const u of source.users) {
    const p = result.profiles.find(p => p.sourceUserId === u.id);
    if (!p?.state) { errors.push('missing profile ' + u.id); continue; }
    const wanted = source.workout_sessions.filter(w => w.user_id === u.id);
    eq(p.state.workouts.length,wanted.length,'session count ' + u.id);
    eq(new Set(p.state.workouts.map(w => w.id)).size,wanted.length,'unique sessions ' + u.id);
    for (const w of wanted) {
      const got = p.state.workouts.find(x => x.id === stableId('session',w.client_id));
      if (!got) { errors.push('missing session ' + w.id); continue; }
      eq(got.start,Date.parse(w.started_at),'start ' + w.id);
      eq(got.end-got.start,w.duration_seconds*1000,'duration ' + w.id);
      eq(got.routineId,stableId('routine',w.routine_id),'routine link ' + w.id);
      eq(got.allenamento?.session,w,'original session metadata ' + w.id);
      if (w.notes && !got.note?.includes(w.notes)) errors.push('note ' + w.id);
      const expected = source.workout_sets.filter(s => s.session_id === w.id).sort((a,b) => a.id-b.id);
      const actual = got.entries.flatMap(e => e.sets.map(s => ({ ...s, exercise: e.id }))).sort((a,b) => a.allenamento.id-b.allenamento.id);
      eq(actual.length,expected.length,'set count ' + w.id);
      expected.forEach((s,i) => {
        const g = actual[i]; if (!g) return;
        eq(g.exercise,stableId('exercise',s.exercise_id),'exercise ' + s.id);
        eq([g.w,g.r,g.rir ?? null,g.done],[s.weight_kg,s.reps,s.rir,s.completed],'set fields ' + s.id);
        eq(g.allenamento,s,'original set metadata ' + s.id);
      });
    }
    const ownedPrograms = source.programs.filter(p => p.user_id === u.id);
    const routines = source.routines.filter(r => ownedPrograms.some(p => p.id === r.program_id));
    eq(p.state.routines.length,routines.length,'routine count ' + u.id);
    for (const r of routines) {
      const got = p.state.routines.find(x => x.id === stableId('routine',r.id));
      if (!got) { errors.push('missing routine ' + r.id); continue; }
      eq(got.allenamento?.routine,r,'original routine ' + r.id);
      const expected = source.routine_exercises.filter(e => e.routine_id === r.id).sort((a,b) => a.sort_order-b.sort_order || a.id-b.id);
      eq(got.ex.map(e => e.allenamento),expected,'routine exercises ' + r.id);
    }
  }
  return { ok: errors.length === 0, errors, profiles: result.profiles.map(p => ({ sourceUserId: p.sourceUserId, sessions: p.state.workouts.length, sets: p.state.workouts.reduce((n,w) => n + w.entries.reduce((s,e) => s+e.sets.length,0),0), routines: p.state.routines.length, summaryOnly: p.state.workouts.filter(w => !w.entries.length).length })) };
}
