const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const src = fs.readFileSync(path.join(ROOT,'src/data/pricingConfig.ts'),'utf8');
const m = src.match(/export const PRICING_CONFIG_V2: PricingConfigV2 = (\{[\s\S]*?\n\});/);
let body = m[1].replace(/^\s*\/\/.*$/gm,'').replace(/,(\s*[}\]])/g,'$1');
const ts = eval('(' + body + ')');
const py = JSON.parse(fs.readFileSync(path.join(ROOT,'backend/app/core/pricing_config.json'),'utf8'));
function flat(d,p='',out={}){ if (d && typeof d==='object'){ for (const k in d) flat(d[k], p+'.'+k, out);} else out[p]=d; return out;}
const fp=flat(py), ft=flat(ts);
const keys=new Set([...Object.keys(fp),...Object.keys(ft)]);
let diffs=[];
for(const k of keys){ const a=fp[k], b=ft[k]; if(JSON.stringify(a)!==JSON.stringify(b)) diffs.push([k,a,b]); }
console.log('version PY:',py.version,'TS:',ts.version);
console.log('DIFFS:',diffs.length);
diffs.slice(0,60).forEach(d=>console.log(' ',d[0],'PY=',d[1],'TS=',d[2]));
process.exit(diffs.length?1:0);
