const path=require('path'), fs=require('fs');
const D=require('./drift.js');
const ROOT=path.join(__dirname,'..','..');
const MAN=JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures','fixtures.json'),'utf8'));
const mal=MAN.fixtures.find(f=>f.name==='mallala-2026-08-23');
const S0=D.sandbox(null);
const parsed=S0.API.gpVboParse(fs.readFileSync(path.join(ROOT,'mallala-drift.vbo'),'utf8'),'mallala-drift.vbo');
const defs=parsed.meta.chanDefs;
const rows=parsed.rows.map(r=>({lat:r.lat,lon:r.lon,kph:r.kph,hdg:r.hdg,g:0,t:r.ms,
  can:r.cv&&r.cv.map((v,k)=>v==null?null:Math.max(0,Math.min(65535,Math.round((v-defs[k].offset)/defs[k].scale))))}));
const track=JSON.parse(JSON.stringify(mal.track));
const S=D.sandbox(track); const API=S.API, gp=S.gp;
gp.trace=rows; gp.traceChanIds=parsed.meta.chanIds; gp.traceChanDefs=defs;
gp.ghostFence=null; gp.chan=null; gp.chanKey=''; gp.driftSrcPref=null; gp.driftUnit=0;
gp.tracks.active=track.id; 
API.gpComputeG(rows);
gp.traceLaps=API.gpSplitRows(rows,{});
gp.selLap=0; gp.cmpLap=-1;
console.log('laps',gp.traceLaps.length,'times',gp.traceLaps.map(l=>API.gpSpanSecs(rows,l).toFixed(2)).join(' '));
const b=API.gpDriftBoard();
if(!b){console.log('no board');process.exit(0);}
console.log('units',b.units.length,'corners',b.corners.length,'refLap',b.refLap);
console.log('lapAvg',JSON.stringify(b.lapAvg));
// best rated cell
let best=null;
b.cells.forEach((lr,li)=>lr.forEach((r,ui)=>{ if(r&&r.rating&&(!best||r.rating.score>best.r.rating.score)) best={li,ui,r}; }));
console.log('BEST cell lap',best.li+1,'unit',best.ui,'stars',best.r.rating.stars,
  'parts',JSON.stringify(best.r.rating.parts));
console.log('  entryKph',best.r.entryKph.toFixed(1),'held',best.r.angle.held.toFixed(1),
  'peak',best.r.angle.peak.toFixed(1),'secs',best.r.secs.toFixed(2),'commit',best.r.commit.toFixed(3),
  'settle',best.r.settle,'conf',best.r.angle.conf.toFixed(2),'switches',best.r.switches);
console.log('units detail',JSON.stringify(b.units.map(u=>({m:u.members,linked:u.linked}))));
console.log('bestKph',b.bestKph.map(v=>v.toFixed(1)).join(' '));
// full board table for one lap
const li=best.li;
console.log('lap '+(li+1)+' cells:');
b.cells[li].forEach((r,ui)=>{ if(!r) return console.log('  u'+ui+' —');
  console.log('  u'+ui, r.rating? r.rating.stars+'★ held '+r.angle.held.toFixed(1)+'° entry '+r.entryKph.toFixed(0)+' commit '+r.commit.toFixed(2):'(unrated'+(r.spun?': spun':'')+')'); });
