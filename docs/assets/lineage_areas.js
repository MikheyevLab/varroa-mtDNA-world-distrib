/* Sampling envelopes only: use recorded point locations, never infer a species range. */
function atlasLineageAreas(records, maxGapKm = 1500) {
  if (!Number.isFinite(maxGapKm) || maxGapKm <= 0) return [];
  const radians = Math.PI / 180, earthKm = 6371.0088;
  const distance = (a, b) => {
    const p = a.lat * radians, q = b.lat * radians;
    const h = Math.sin((q-p)/2)**2 + Math.cos(p)*Math.cos(q)*Math.sin((b.lng-a.lng)*radians/2)**2;
    return 2 * earthKm * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  const groups = new Map();
  records.forEach(r => {
    const lat = r['coord.X'], lng = r['coord.Y'];
    // Country centroids and withheld mitochondrial calls cannot define an area.
    if (r.evidence_level !== 'point' || !r.GROUP || r.GROUP === 'VD_nuclear_evidence' ||
        !r.Haplogroup || r.Haplogroup === 'NA' || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) >= 85.051129 || Math.abs(lng) > 180) return;
    const key = JSON.stringify([r.Species, r.GROUP]);
    if (!groups.has(key)) groups.set(key, {group:r.GROUP, species:r.Species, sites:new Map()});
    const sites = groups.get(key).sites, coordinate = JSON.stringify([lat,lng]);
    if (!sites.has(coordinate)) sites.set(coordinate, {lat,lng,ids:[]});
    sites.get(coordinate).ids.push(r.record_id);
  });
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function hull(points) {
    const sorted = [...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const half = list => {const chain=[];list.forEach(p=>{while(chain.length>=2&&cross(chain.at(-2),chain.at(-1),p)<=1e-10)chain.pop();chain.push(p);});return chain;};
    const lower=half(sorted), upper=half([...sorted].reverse());
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }
  function clip(ring, edge, keepRight) {
    const inside=p=>keepRight?p[0]>=edge:p[0]<=edge, output=[];
    ring.forEach((b,i)=>{const a=ring[(i+ring.length-1)%ring.length], ai=inside(a), bi=inside(b);
      if(ai!==bi)output.push([edge,a[1]+(b[1]-a[1])*(edge-a[0])/(b[0]-a[0])]);
      if(bi)output.push(b);
    });
    return output;
  }
  const areas=[];
  groups.forEach(({group,species,sites})=>{
    // Connected components split gaps exceeding the selected great-circle distance.
    const pending=[...sites.values()].sort((a,b)=>a.lng-b.lng||a.lat-b.lat);
    while(pending.length) {
      const component=[pending.shift()];
      for(let i=0;i<component.length;i++)for(let j=pending.length-1;j>=0;j--)
        if(distance(component[i],pending[j])<=maxGapKm)component.push(...pending.splice(j,1));
      if(component.length<3)continue;
      // Unwrap around the largest longitude gap, so Taiwan or Pacific sites do not cross the world.
      const lons=component.map(p=>(p.lng+360)%360).sort((a,b)=>a-b);
      let gap=-1,start=lons[0];
      lons.forEach((lon,i)=>{const next=i+1<lons.length?lons[i+1]:lons[0]+360;if(next-lon>gap){gap=next-lon;start=next%360;}});
      const points=component.map(p=>{let x=(p.lng+360)%360;if(x<start-1e-10)x+=360;return [x,Math.log(Math.tan(Math.PI/4+p.lat*radians/2))];});
      if(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))>=180)continue;
      const boundary=hull(points);if(boundary.length<3)continue;
      // Split the polygon at +/-180 degrees; retain every original observation unchanged.
      const rings=[],lo=Math.floor((Math.min(...boundary.map(p=>p[0]))+180)/360),hi=Math.floor((Math.max(...boundary.map(p=>p[0]))+180)/360);
      for(let world=lo;world<=hi;world++) {
        const clipped=clip(clip(boundary,-180+360*world,true),180+360*world,false);
        const area=Math.abs(clipped.reduce((sum,p,i)=>{const q=clipped[(i+1)%clipped.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
        if(clipped.length>=3&&area>1e-10)rings.push(clipped.map(([x,y])=>[(2*Math.atan(Math.exp(y))-Math.PI/2)/radians,x-360*world]));
      }
      if(rings.length)areas.push({group,species,locations:component.length,record_ids:component.flatMap(p=>p.ids),rings});
    }
  });
  return areas;
}
if (typeof module !== 'undefined' && module.exports) module.exports = atlasLineageAreas;
