import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./convert.mjs', import.meta.url));
test('CLI emits private backups and refuses to replace an existing output directory', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'al-cli-'));
  try {
    const input = path.join(dir,'source.json'), out = path.join(dir,'out');
    fs.writeFileSync(input, JSON.stringify({ users:[{id:'u',display_name:'Example'}],programs:[],routines:[],routine_exercises:[],exercises:[],workout_sessions:[],workout_sets:[] }));
    const run = () => spawnSync(process.execPath,[cli,input,out],{encoding:'utf8'});
    const first = run(); assert.equal(first.status,0,first.stderr);
    assert.equal(fs.statSync(out).mode & 0o777,0o700);
    const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json')));
    assert.equal(manifest.report.ok,true);assert.equal(manifest.profiles.length,1);
    const p=path.join(out,manifest.profiles[0].file);
    assert.equal(fs.statSync(p).mode & 0o777,0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(p)).workouts,[]);
    assert.notEqual(run().status,0);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
