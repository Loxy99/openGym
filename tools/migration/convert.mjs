// node tools/migration/convert.mjs SOURCE.json NEW_OUTPUT_DIRECTORY
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { convertAllenamento, reconcileAllenamento, stableId } from './allenamento.mjs';
const [input,out] = process.argv.slice(2);
if (!input || !out) throw new Error('Usage: node convert.mjs SOURCE.json NEW_OUTPUT_DIRECTORY');
const bytes = fs.readFileSync(input);
const source = JSON.parse(bytes);
const converted = convertAllenamento(source);
const report = reconcileAllenamento(source,converted);
if (!report.ok) throw new Error('Reconciliation failed: ' + report.errors.join(', '));
fs.mkdirSync(out,{mode:0o700}); // intentionally not recursive: never overwrite a previous export
const profiles = converted.profiles.map(p => {
  const file = stableId('profile',p.sourceUserId)+'.json';
  const text = JSON.stringify(p.state,null,2);
  fs.writeFileSync(path.join(out,file),text,{mode:0o600,flag:'wx'});
  return { sourceUserId:p.sourceUserId,name:p.name,file,sha256:crypto.createHash('sha256').update(text).digest('hex') };
});
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({ sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),convertedAt:new Date().toISOString(),timeZone:'Europe/Rome',profiles,report },null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({ok:true,profiles:profiles.length,sessions:report.profiles.reduce((n,p)=>n+p.sessions,0),sets:report.profiles.reduce((n,p)=>n+p.sets,0)}));
