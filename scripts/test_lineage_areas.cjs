// Geographic edge cases matter: a Pacific lineage must not paint across the whole world.
const assert=require('node:assert/strict');
const areas=require('../docs/assets/lineage_areas.js');
const row=(id,lat,lng,extra={})=>({record_id:id,Species:'V. destructor',GROUP:'test-T',Haplogroup:'reported T',evidence_level:'point','coord.X':lat,'coord.Y':lng,...extra});
const triangle=[row('a',22,120),row('b',24,120),row('c',23,122)];
let result=areas(triangle);assert.equal(result.length,1);assert.equal(result[0].locations,3);
const before=JSON.stringify(triangle);areas(triangle);assert.equal(JSON.stringify(triangle),before);
assert.equal(areas(triangle.slice(0,2)).length,0);
assert.equal(areas([row('a',0,0),row('b',0,1),row('c',0,2)]).length,0);
assert.equal(areas([triangle[0],{...triangle[0],record_id:'copy'},triangle[1]]).length,0);
assert.equal(areas([...triangle,{...triangle[0],record_id:'copy'}])[0].locations,3);
assert.equal(areas([...triangle,{...triangle[0],record_id:'copy'}])[0].record_ids.length,4);
assert.equal(areas(triangle.map(r=>({...r,GROUP:'VD_nuclear_evidence'}))).length,0);
assert.equal(areas(triangle.map(r=>({...r,evidence_level:'country'}))).length,0);
assert.equal(areas(triangle.map(r=>({...r,Haplogroup:''}))).length,0);
assert.equal(areas(triangle.map(r=>({...r,'coord.X':null}))).length,0);
assert.equal(areas(triangle,20).length,0);
const distant=triangle.map(r=>({...r,record_id:'west-'+r.record_id,'coord.Y':r['coord.Y']-110}));
assert.equal(areas([...triangle,...distant]).length,2);
assert.equal(areas([...triangle,...triangle.map(r=>({...r,GROUP:'reported-J'}))]).length,2);
assert.equal(areas([...triangle,...triangle.map(r=>({...r,Species:'V. jacobsoni'}))]).length,2);
assert.equal(areas([triangle[0],{...triangle[1],GROUP:'reported-J'},triangle[2]]).length,0);
result=areas([row('a',10,179),row('b',11,-179),row('c',12,178)]);
assert.equal(result.length,1);assert.equal(result[0].rings.length,2);
for(const ring of result[0].rings){assert.ok(ring.every(([lat,lng])=>Number.isFinite(lat)&&Math.abs(lng)<=180));assert.ok(Math.max(...ring.map(p=>p[1]))-Math.min(...ring.map(p=>p[1]))<=3.01);}
assert.equal(areas(triangle,NaN).length,0);
console.log('Lineage-area checks passed: input preservation, sparsity, duplicates, exclusions, separation, distance and antimeridian.');
