const path = require('path');
const G = require(path.join(__dirname,'..','golden_lib.js'));
const fs = require('fs');
const man = JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures','fixtures.json'),'utf8'));
for (const spec of man.fixtures) {
  const fx = G.readFixture(spec);
  if (!fx) { console.log(spec.name, 'MISSING'); continue; }
  const track = fx.track || spec.track || null;
  const S = G.sandbox(track);
  const API = S.API, gp = S.gp;
  gp.trace = fx.rows; gp.traceChanIds = fx.chanIds||null; gp.traceChanDefs = fx.chanDefs||null;
  gp.ghostFence=null; gp.chan=null; gp.chanKey='';
  if (track){ gp.tracks.active = track.id||'t'; if(!track.id) track.id='t'; }
  API.gpComputeG(gp.trace);
  const diag={};
  gp.traceLaps = track ? API.gpSplitRows(gp.trace,diag) : [];
  const r0 = fx.rows[0];
  console.log('===', spec.name, 'rows', fx.rows.length, 'laps', gp.traceLaps.length);
  console.log('  row keys:', Object.keys(r0).join(','));
  console.log('  sample:', JSON.stringify({lat:r0.lat,lon:r0.lon,kph:r0.kph,hdg:r0.hdg,t:r0.t,g:r0.g,gl:r0.gl,ga:r0.ga}));
  console.log('  track:', track ? track.name : null, track&&track.sectors?('sectors '+track.sectors.length):'');
  console.log('  api:', Object.keys(API).length, 'fns');
}
