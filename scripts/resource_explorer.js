function(el, x, data) {
  "use strict";
  const map = this;
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const plain = html => { const node = document.createElement("div"); node.innerHTML = html; return node.textContent; };
  const norm = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const known = value => value && value !== "NA";
  const host = value => known(value) ? value.replace(/^Apis /, "A. ") : "Host unavailable";
  const nuclearOnly = row => row.GROUP === "VD_nuclear_evidence" || !known(row.Haplogroup);
  const colors = data.colors;
  colors.VD_nuclear_evidence = "#5b626b";
  const references = new Map();
  data.references.forEach(row => {
    const name = row.reference.trim();
    if (!references.has(name)) references.set(name, new Set());
    references.get(name).add(row.doi);
  });
  const records = data.records.map(row => ({...row,
    displayHost: host(row.Host),
    study: known(row.reference) && !row.reference.startsWith("Year:") ? row.reference.trim() : "GenBank accession record",
    country: row.border_name || row.Location.trim(),
    search: norm(Object.values(row).join(" ")),
    archiveText: plain(row.archive_note || "")
  }));
  const features = new Map(data.world.features.map(feature => [feature.properties.NAME, feature]));
  const sourceLinks = row => {
    const dois = references.get(row.study) || new Set();
    const links = [...dois].map(doi => `<a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">Read study ↗</a>`);
    if (row.archiveText) links.push('<a href="https://doi.org/10.1111/mec.16322" target="_blank" rel="noopener">Archived WGS study ↗</a>');
    return links.join(" · ");
  };
  const linked = value => esc(value).replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  const mt = row => nuclearOnly(row) ? "Unresolved / withheld" : row.reported_mt || row.Haplogroup;
  const verification = row => `<span class="verification-badge ${row.verification_status === "verified" ? "verified" : "pending"}">${row.verification_status === "verified" ? "✓ Manually verified" : row.verification_status === "needs_recheck" ? "Needs recheck" : "Not yet verified"}</span>`;
  const precision = row => row.evidence_level === "country" ? "Country polygon · named region only" : row["Coord.type"] === "exact" ? "Published site coordinates" : "Approximate locality";
  const detail = row => `<details class="evidence-record" data-evidence-id="${row.record_id}">
    <summary><span class="record-stamp">${row.is_new ? "Added 2026" : "Baseline"}</span> ${esc(row.study)}<br>
    ${esc(row.displayHost)} · ${esc(known(row.Year) ? row.Year : "Year unavailable")} · ${esc(mt(row))}</summary>
    <p>${verification(row)}${row.verification_status === "verified" ? ` · ${esc(row.verified_by)} · ${esc(row.verified_at)}` : ""}</p>
    <dl><dt>Species</dt><dd>${esc(row.Species)}</dd><dt>Collection host</dt><dd>${esc(row.Host)}</dd>
    <dt>Locality</dt><dd>${esc(row.Region || row.Location)}, ${esc(row.Location)}</dd>
    <dt>Precision</dt><dd>${precision(row)}</dd><dt>Reported mt label</dt><dd>${esc(mt(row))}</dd>
    ${nuclearOnly(row) && row.reported_mt ? `<dt>Unresolved COI report</dt><dd>${esc(row.reported_mt)}</dd>` : ""}
    ${row.evidence_level === "point" ? `<dt>Coordinates</dt><dd>${row["coord.X"]} latitude, ${row["coord.Y"]} longitude</dd>` : ""}
    <dt>Record</dt><dd>${esc(row.record_id)}${row.input_id ? ` · update ${esc(row.input_id)}` : ""}</dd></dl>
    <p>${sourceLinks(row)}</p><p>${linked(row.Description)}</p>${row.archive_note || ""}</details>`;
  const popup = rows => `<div class="evidence-popup"><b>${rows.length} matching evidence record${rows.length === 1 ? "" : "s"}</b>
    <p>${rows[0].evidence_level === "country" ? "Occurrence in the named region; shading does not imply countrywide distribution." : "Shared coordinates do not establish shared specimens. Open each study below."}</p>
    ${[...rows].sort((a,b) => Number(b.is_new)-Number(a.is_new)).map(detail).join("")}</div>`;

  // Keep the map first; detailed filters and evidence remain available on demand.
  const root = document.createElement("section");
  root.className = "resource-explorer";
  root.setAttribute("aria-label", "Varroa evidence explorer");
  el.before(root);
  root.innerHTML = `<div class="atlas-heading"><div><h3>Observation map</h3></div><span class="atlas-edition">Curated to<br><b>05 November 2026</b></span></div>
    <div class="explorer-presets" role="group" aria-label="Map views">
    <button type="button" data-preset="new" class="active">New additions <span>2026</span></button>
    <button type="button" data-preset="all">All evidence</button>
    <button type="button" data-preset="mellifera">On <i>A. mellifera</i></button>
    <button type="button" data-preset="destructor"><i>V. destructor</i> · <i>A. cerana</i></button>
    <button type="button" data-preset="jacobsoni"><i>V. jacobsoni</i> · <i>A. cerana</i></button></div>
    <div class="explorer-toolbar"><label class="search-label"><span class="sr-only">Search places, studies or accessions</span>
    <input name="q" type="search" placeholder="Search a place, study or accession…" autocomplete="off"></label>
    <label class="color-label">Colour by<select name="colorby"><option value="lineage">Mitochondrial group</option><option value="species">Mite species</option></select></label>
    <button type="button" data-action="filters" aria-expanded="false" aria-controls="atlas-filter-panel">Filters <span class="filter-count"></span></button>
    <button type="button" data-action="expand" aria-pressed="false" title="Expand map">⛶ <span>Expand</span></button></div>
    <div class="explorer-filters" id="atlas-filter-panel" hidden><div class="filter-grid">
    <label>Collection host<select name="host"><option value="">All hosts</option></select></label>
    <label>Country<select name="country"><option value="">All countries</option></select></label>
    <label>Species<select name="species"><option value="">All species</option></select></label>
    <label>Mitochondrial group<select name="lineage"><option value="">All reported groups</option></select></label>
    <label>Study<select name="study"><option value="">All studies</option></select></label>
    <label>Location precision<select name="precision"><option value="">All precision levels</option><option value="exact">Published site coordinates</option><option value="approximate">Approximate locality</option><option value="country">Country / region only</option></select></label>
    <label>Evidence set<select name="scope"><option value="new">2026 additions</option><option value="all">All records</option><option value="baseline">2021 baseline records</option></select></label>
    <label>Assay evidence<select name="assay"><option value="">All assays</option><option value="genome">Genome-wide evidence only</option></select></label>
    <label>Manual verification<select name="verification"><option value="">All statuses</option><option value="verified">Manually verified</option><option value="not_verified">Not yet verified</option><option value="needs_recheck">Needs recheck</option></select></label>
    <label>Collection year from<input name="from" type="number" min="1900" max="2026" placeholder="Any year"></label>
    <label>Collection year through<input name="to" type="number" min="1900" max="2026" placeholder="Any year"></label>
    <label class="check-label"><input name="undated" type="checkbox" checked>Include unknown collection years</label>
    </div><p class="filter-help">Years refer to collection, including reported intervals and uncertain dates. Source fields are preserved in downloads.</p>
    <button type="button" data-action="reset">Reset filters</button></div>
    <div class="lineage-area-controls"><div class="area-toolbar"><label class="area-toggle"><input name="areas" type="checkbox" checked>Shade lineage areas</label><label class="area-gap">Connect nearby sites<select name="area_gap" aria-label="Maximum gap between linked lineage sites"><option value="500">Within 500 km</option><option value="1500" selected>Within 1,500 km</option><option value="3000">Within 3,000 km</option></select></label><details class="area-method"><summary>How it works</summary><p>Translucent outlines join at least three distinct sampled locations of the same mitochondrial group. Nearby sites form connected groups; gaps above the selected distance separate them. Outlines can include unsampled land or sea and are not established species ranges. They follow the current filters and include approximate localities unless excluded. Country-only records, unresolved lineages and iNaturalist observations are excluded. Separate reported groups remain separate.</p></details></div><p class="area-status" role="status" aria-live="polite"></p></div>
    <div class="inat-controls"><label class="inat-toggle"><input name="inaturalist" type="checkbox"><span class="inat-key">⬡</span> iNaturalist species observations</label>
    <div class="inat-panel" hidden><div class="inat-toolbar"><label>iNaturalist species<select name="inat_species"><option value="">All species</option></select></label>
    <button type="button" data-action="inat-fit">Show all iNaturalist locations</button><button type="button" data-action="inat-retry" hidden>Retry</button>
    <a href="https://www.inaturalist.org/observations?taxon_id=194696&quality_grade=research&hrank=species&geo=true" target="_blank" rel="noopener">Open iNaturalist ↗</a></div>
    <p class="inat-status" role="status" aria-live="polite"></p><details class="inat-about"><summary>About this layer</summary><p class="inat-note">Research Grade · species-level community identifications · no mtDNA assignment · not manually verified here. This global overlay has its own species filter; curated evidence filters do not apply. Public coordinates only; obscured locations remain approximate. Curated downloads exclude this layer.</p></details></div></div>
    <div class="atlas-map-layout"><div class="atlas-plate"><div class="atlas-map-bar"><span class="atlas-view-title">A · ASIA & THE WESTERN PACIFIC</span>
    <div role="group" aria-label="Map extent"><button type="button" data-region="world">World</button><button type="button" data-region="asia" class="active">Asia</button><button type="button" data-region="east">East Asia</button><button type="button" data-region="southeast">SE Asia</button><button type="button" data-action="fit" title="Fit matching locations">Fit</button></div></div>
    <div class="atlas-map-slot"></div><div class="atlas-symbol-key"><span>● Published coordinates</span><span>○ Approximate locality</span><span>⑶ Shared records</span><span class="new-key">◌ Added 2026</span><span class="inat-map-key" hidden>⬡ iNaturalist</span></div></div>
    <aside class="atlas-legend" aria-label="Map legend"></aside></div>
    <div class="explorer-status" role="status" aria-live="polite"></div>
    <div class="explorer-switches"><label><input name="nuclear" type="checkbox">Genome-wide evidence</label>
    <label><input name="polygons" type="checkbox" checked>Country evidence</label>
    <label><input name="highlight" type="checkbox">Mark 2026 additions</label>
    <label><input name="labels" type="checkbox" checked>Geographic labels</label></div>
    <div class="explorer-actions"><button type="button" data-action="svg" class="primary-action">↓ Export curated figure <span>SVG</span></button>
    <button type="button" data-action="download">Download curated CSV</button>
    <button type="button" data-action="share">Copy view link</button>
    <button type="button" data-action="cite">Copy citation</button>
    <a href="before-2026-update.html" target="_blank" rel="noopener">Original map ↗</a></div>
    <p class="explorer-note">Each symbol locates evidence, not abundance. Country shading means a report within the named region, not a continuous range. A collection host does not prove reproduction.</p>
    <details class="evidence-drawer"><summary>Browse the matching evidence <span class="drawer-count"></span></summary><div class="explorer-results"></div></details>`;
  root.querySelector(".atlas-map-slot").append(el);
  const results = root.querySelector(".explorer-results");
  const field = name => root.querySelector(`[name="${name}"]`);
  const unique = values => [...new Set(values)].sort((a,b) => a.localeCompare(b));
  const addOptions = (name, values, labels = null) => values.forEach(value => field(name).add(new Option(labels ? labels[value] : value, value)));
  addOptions("host", unique(records.map(r => r.displayHost)));
  addOptions("country", unique(records.map(r => r.country)));
  addOptions("species", unique(records.map(r => r.Species)));
  addOptions("lineage", unique(records.map(r => r.GROUP)), {...data.labels, VD_nuclear_evidence:"Unresolved mt call (nuclear evidence)"});
  addOptions("study", unique(records.map(r => r.study)));
  const stringFields = ["q","host","country","species","lineage","study","precision","scope","assay","from","to","colorby","verification","area_gap"];
  const checks = ["undated","nuclear","polygons","highlight","labels","inaturalist","areas"];
  const initial = new URLSearchParams(location.search);
  stringFields.forEach(name => { if (initial.has(name)) field(name).value = initial.get(name); });
  checks.forEach(name => { if (initial.has(name)) field(name).checked = initial.get(name) === "1"; });

  const speciesColors = {"V. destructor":"#c34b47","V. jacobsoni":"#386ca3","V. underwoodi":"#4c9060","V. rindereri":"#bf983c","Varroa sp.":"#515e64"};
  const colorKey = (row,s) => nuclearOnly(row) ? "VD_nuclear_evidence" : s.colorby === "species" ? row.Species : row.GROUP;
  const keyColor = (key,s) => key === "VD_nuclear_evidence" ? "#5b626b" : s.colorby === "species" ? speciesColors[key] || "#515e64" : colors[key];
  const keyLabel = (key,s) => key === "VD_nuclear_evidence" ? "Unresolved mt · nuclear evidence" : s.colorby === "species" ? key : data.labels[key];
  const shape = (species,fill,stroke,width=1.8) => {
    const style = `fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"`;
    if (species === "V. jacobsoni") return `<path d="M18 10.5L25.5 18L18 25.5L10.5 18Z" ${style}/>`;
    if (species === "V. underwoodi") return `<rect x="12" y="12" width="12" height="12" ${style}/>`;
    if (species === "V. rindereri") return `<path d="M18 10.5L25 24L11 24Z" ${style}/>`;
    if (species === "Varroa sp.") return `<path d="M18 10L20.5 15L26 16L22 20L23 26L18 23L13 26L14 20L10 16L15.5 15Z" ${style}/>`;
    return `<circle cx="18" cy="18" r="5.5" ${style}/>`;
  };
  // Equal ring segments identify the groups present; they never encode sample frequencies.
  const symbol = (rows,s) => {
    const keys=unique(rows.map(r=>colorKey(r,s))), r=rows[0], c=keyColor(keys[0],s);
    const exact=rows.every(r=>r["Coord.type"]==="exact");
    const parts=[];
    if(s.highlight && rows.some(r=>r.is_new)) parts.push(`<circle cx="18" cy="18" r="${rows.length>1?13:10}" fill="none" stroke="#b68b35" stroke-width="1.2" stroke-dasharray="2 2"/>`);
    if(s.nuclear && rows.some(r=>r.nuclear)) parts.push('<circle cx="18" cy="18" r="16" fill="none" stroke="#5b626b" stroke-width="1.4" stroke-dasharray="4 3"/>');
    if(rows.length===1) parts.push(shape(r.Species,exact?c:"#ffffff",c));
    else {
      parts.push('<circle cx="18" cy="18" r="9" fill="white"/>');
      keys.forEach((k,i)=>parts.push(`<circle cx="18" cy="18" r="9" fill="none" stroke="${keyColor(k,s)}" stroke-width="2.6" stroke-dasharray="${56.549/keys.length} 56.549" stroke-dashoffset="${-i*56.549/keys.length}" transform="rotate(-90 18 18)"/>`));
      parts.push(`<text x="18" y="21.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="600" fill="#263e3e">${rows.length}</text>`);
    }
    return parts.join("");
  };
  map.createPane("atlasGrid"); map.getPane("atlasGrid").style.zIndex=210;
  map.createPane("atlasLabels"); map.getPane("atlasLabels").style.zIndex=450;
  map.getPane("atlasLabels").style.pointerEvents="none";
  map.createPane("lineageAreas"); map.getPane("lineageAreas").style.zIndex=420;
  const base = L.geoJSON(data.world, {style:{color:"#b9c3bf",weight:0.7,fillColor:"#e8ebe5",fillOpacity:1},
    onEachFeature:(feature,layer)=>layer.bindTooltip(feature.properties.NAME,{sticky:true})}).addTo(map);
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:18});
  L.control.layers({"Atlas (offline)":base,"OpenStreetMap":osm}, null, {position:"topright"}).addTo(map);
  L.control.scale({imperial:false,position:"bottomright"}).addTo(map);
  const pointLayer = L.layerGroup().addTo(map), countryLayer = L.layerGroup().addTo(map), areaLayer = L.layerGroup().addTo(map);
  let areaShapes = [];
  // Public, unauthenticated community observations stay separate from curated mtDNA evidence.
  const inatLayer = L.layerGroup(), inatStatus = root.querySelector(".inat-status");
  let inatRows = null, inatLoading = false, inatTotal = 0, inatRetrieved = "";
  const inatVisibleRows = () => (inatRows || []).filter(r => !field("inat_species").value || r.species === field("inat_species").value);
  const updateInatStatus = () => {
    if(!inatRows || !field("inaturalist").checked)return;
    const selected=inatVisibleRows(), inView=selected.filter(r=>map.getBounds().contains([r.coordinates[1],r.coordinates[0]])).length;
    inatStatus.textContent=`${inView} in view · ${selected.length} selected · ${inatRows.length}/${inatTotal} loaded · ${inatRetrieved}${inatTotal>1000?" · capped at 1,000":""}.`;
  };
  map.on("moveend",updateInatStatus);
  const drawInat = () => {
    inatLayer.clearLayers();
    if (!field("inaturalist").checked) { map.removeLayer(inatLayer); return; }
    inatLayer.addTo(map);
    const visible = inatVisibleRows(), grouped = new Map();
    visible.forEach(r => { const key=r.coordinates.join(",");if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r); });
    grouped.forEach(rows => {
      const r=rows[0], obscured=rows.some(v=>v.obscured);
      const icon=L.divIcon({className:"inat-symbol",iconSize:[26,26],iconAnchor:[13,13],html:`<svg viewBox="0 0 26 26" width="26" height="26" aria-hidden="true"><path d="M13 2L23 7.5V18.5L13 24L3 18.5V7.5Z" fill="${obscured?"#ffffff":"#387949"}" stroke="#235b33" stroke-width="1.5"/><text x="13" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="${obscured?"#235b33":"#ffffff"}">${rows.length>1?rows.length:"i"}</text></svg>`});
      const content=rows.map(o=>`<details class="evidence-record" ${rows.length===1?"open":""}><summary><i>${esc(o.species)}</i> · ${esc(o.date || "Date unavailable")}</summary><p><span class="verification-badge pending">Not manually verified here</span></p><p><b>iNaturalist status:</b> Research Grade<br><b>Observer:</b> ${esc(o.observer)}<br><b>Location:</b> ${o.obscured?"Obscured public location (approximate)":"Public observation coordinates"}${o.accuracy?`<br><b>Reported uncertainty:</b> ${esc(o.accuracy)} m`:""}<br><b>Observation licence:</b> ${esc(o.license || "No licence specified; see original")}</p><p>Species occurrence only. No mitochondrial lineage or collection host is inferred.</p><a href="https://www.inaturalist.org/observations/${o.id}" target="_blank" rel="noopener">View observation ${o.id} ↗</a></details>`).join("");
      L.marker([r.coordinates[1],r.coordinates[0]],{icon,title:`iNaturalist: ${r.species} (${rows.length} observation${rows.length===1?"":"s"})`,zIndexOffset:300}).bindPopup(`<div class="evidence-popup"><b>iNaturalist · community observations</b>${content}</div>`,{maxWidth:450,maxHeight:350}).addTo(inatLayer);
    });
    updateInatStatus();
  };
  const loadInat = async () => {
    root.querySelector(".inat-panel").hidden=!field("inaturalist").checked;
    root.querySelector(".inat-map-key").hidden=!field("inaturalist").checked;
    if(!field("inaturalist").checked){map.removeLayer(inatLayer);return;}
    if(inatRows){drawInat();return;}if(inatLoading)return;
    inatLoading=true;inatStatus.textContent="Loading public iNaturalist observations…";root.querySelector('[data-action="inat-retry"]').hidden=true;
    try {
      const observations=new Map();let received=0;
      for(let page=1;page<=5;page++){
        const params=new URLSearchParams({taxon_id:"194696",quality_grade:"research",geo:"true",mappable:"true",hrank:"species",per_page:"200",page:String(page),order_by:"id",order:"desc"});
        const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20000);
        let payload;
        try{const response=await fetch("https://api.inaturalist.org/v1/observations?"+params,{credentials:"omit",signal:controller.signal});if(!response.ok)throw new Error("iNaturalist service unavailable");payload=await response.json();}finally{clearTimeout(timeout);}
        if(!Array.isArray(payload.results)||!Number.isFinite(payload.total_results))throw new Error("Unexpected iNaturalist response");
        inatTotal=payload.total_results;received+=payload.results.length;
        payload.results.forEach(o=>{
          const coords=o.geojson?.coordinates,t=o.taxon;
          if(o.quality_grade!=="research"||!Number.isSafeInteger(o.id)||!t||!Number.isFinite(t.rank_level)||t.rank_level>10||!/^Varroa /.test(t.name)||!Array.isArray(coords)||coords.length!==2||!coords.every(Number.isFinite)||Math.abs(coords[0])>180||Math.abs(coords[1])>90||o.geoprivacy==="private"||o.taxon_geoprivacy==="private")return;
          const obscured=!!o.coordinates_obscured||o.geoprivacy==="obscured"||o.taxon_geoprivacy==="obscured";
          observations.set(o.id,{id:o.id,species:t.name,coordinates:coords,obscured,date:obscured?(o.observed_on||"").slice(0,7):o.observed_on,observer:o.user?.login||"Observer on iNaturalist",accuracy:o.public_positional_accuracy||(!obscured?o.positional_accuracy:null),license:o.license_code});
        });
        if(received>=Math.min(inatTotal,1000))break;
        if(!payload.results.length)throw new Error("Incomplete iNaturalist response; please retry");
      }
      inatRows=[...observations.values()];inatRetrieved=new Date().toISOString().slice(0,10);
      addOptions("inat_species",unique(inatRows.map(r=>r.species)));
      drawInat();
    } catch(error) {inatStatus.textContent="The iNaturalist layer could not be loaded. Your curated map is still available; retry or open iNaturalist directly.";root.querySelector('[data-action="inat-retry"]').hidden=false;}
    finally{inatLoading=false;}
  };
  const gridLayer=L.layerGroup().addTo(map), labelLayer=L.layerGroup().addTo(map);
  const legend=root.querySelector(".atlas-legend");
  const geoLabels=[
    [37,96,"CHINA",2.5],[22,78,"INDIA",2.5],[47,104,"MONGOLIA",3],[58,112,"RUSSIA",2.5],
    [39,143,"JAPAN",3],[36,130,"KOREA",4],[23.6,124.3,"TAIWAN",4],[18,109.5,"VIET NAM",4],
    [17,97.7,"THAILAND",4],[23,94,"MYANMAR",4],[28,84,"NEPAL",4],[3,111,"MALAYSIA",4],
    [-5,117,"INDONESIA",3],[13,125,"PHILIPPINES",3],[-25,134,"AUSTRALIA",2.5],[-6,147,"PAPUA NEW GUINEA",4],
    [40,-103,"UNITED STATES",2],[56,-106,"CANADA",2],[-10,-53,"BRAZIL",2],[-32,-65,"ARGENTINA",3],
    [21,-102,"MEXICO",3],[-29,25,"SOUTH AFRICA",3],[8,20,"AFRICA",1.5],[51,18,"EUROPE",1.5],
    [1,75,"INDIAN OCEAN",2],[15,153,"PACIFIC OCEAN",2],[15,-35,"ATLANTIC OCEAN",1.5]
  ];
  const graticule = () => {
    const b=map.getBounds(), step=map.getZoom()>=6?2:map.getZoom()>=3.5?10:30, lines=[];
    for(let lng=Math.ceil(Math.max(-180,b.getWest())/step)*step;lng<=Math.min(180,b.getEast());lng+=step) lines.push([[Math.max(-80,b.getSouth()),lng],[Math.min(80,b.getNorth()),lng]]);
    for(let lat=Math.ceil(Math.max(-80,b.getSouth())/step)*step;lat<=Math.min(80,b.getNorth());lat+=step) lines.push([[lat,Math.max(-180,b.getWest())],[lat,Math.min(180,b.getEast())]]);
    return lines;
  };
  const overview=L.control({position:"bottomleft"});
  const overviewPath=featurePath(data.world.features,([lng,lat])=>[140*(lng+180)/360,70*(90-lat)/180]);
  overview.onAdd=()=>{const node=L.DomUtil.create("div","atlas-overview");node.innerHTML=`<span>GLOBAL CONTEXT</span><svg viewBox="0 0 140 70" role="img" aria-label="World locator map"><path d="${overviewPath}" fill="#d1dbd5" stroke="#f7faf9" stroke-width=".3"/><rect class="overview-window" fill="#b68b3522" stroke="#9f7930" stroke-width="1"/></svg>`;return node;};
  overview.addTo(map);
  // Raw polygons are projected once for the locator, and into the current viewport for SVG export.
  function featurePath(features,project) {
    return features.map(f=>{const polygons=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
      return polygons.map(poly=>poly.map(ring=>ring.map((coord,i)=>{const p=project(coord);return `${i?"L":"M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`;}).join("")+"Z").join("")).join("");}).join("");
  }
  const drawDecoration=()=>{
    gridLayer.clearLayers();labelLayer.clearLayers();
    graticule().forEach(line=>L.polyline(line,{pane:"atlasGrid",color:"#b8c9c5",weight:.7,opacity:.65,dashArray:"2 5",interactive:false}).addTo(gridLayer));
    if(field("labels").checked)geoLabels.filter(l=>map.getZoom()>=l[3] && map.getZoom()<6.5).forEach(([lat,lng,name])=>L.marker([lat,lng],{pane:"atlasLabels",interactive:false,icon:L.divIcon({className:"atlas-place-label",iconSize:[150,16],iconAnchor:[75,8],html:esc(name)})}).addTo(labelLayer));
    const b=map.getBounds(), rect=overview.getContainer().querySelector("rect");
    const west=Math.max(-180,b.getWest()),east=Math.min(180,b.getEast()),north=Math.min(90,b.getNorth()),south=Math.max(-90,b.getSouth());
    rect.setAttribute("x",140*(west+180)/360);rect.setAttribute("y",70*(90-north)/180);rect.setAttribute("width",Math.max(0,140*(east-west)/360));rect.setAttribute("height",70*(north-south)/180);
  };
  map.on("moveend zoomend",drawDecoration);
  let filtered = [], page = 0, pointMarkers = new Map(), countryMarkers = new Map();
  const perPage = 12;
  let pointBuckets=new Map(), countryBuckets=new Map();
  const state = () => Object.fromEntries([...stringFields.map(k => [k,field(k).value]),...checks.map(k => [k,field(k).checked])]);
  const yearMatches = (text, start, end, undated) => {
    if (!known(text)) return undated;
    const ranges = [...text.matchAll(/(\d{4})\s*[-–]\s*(\d{4})/g)];
    if (ranges.some(r => +r[1] <= end && +r[2] >= start)) return true;
    const singles = text.replace(/\d{4}\s*[-–]\s*\d{4}/g, "").match(/\d{4}/g) || [];
    return singles.some(year => +year >= start && +year <= end);
  };
  const matches = (r,s) => (!s.q || norm(s.q).trim().split(/\s+/).every(word => r.search.includes(word))) &&
    (!s.host || r.displayHost === s.host) && (!s.country || r.country === s.country) &&
    (!s.species || r.Species === s.species) && (!s.lineage || r.GROUP === s.lineage) &&
    (!s.verification || r.verification_status === s.verification) &&
    (!s.study || r.study === s.study || r.archiveText.includes(s.study)) &&
    (!s.precision || (s.precision === "country" ? r.evidence_level === "country" : r["Coord.type"] === s.precision)) &&
    (s.scope === "all" || (s.scope === "new" ? r.is_new : !r.is_new)) &&
    (!s.assay || r.nuclear) && yearMatches(r.Year, s.from === "" ? -Infinity : +s.from, s.to === "" ? Infinity : +s.to, s.undated);
  const bucket = (rows,key) => { const grouped = new Map(); rows.forEach(r => { const k = key(r); if (!grouped.has(k)) grouped.set(k,[]); grouped.get(k).push(r); }); return grouped; };
  const showRecord = id => {
    const row = filtered.find(r => r.record_id === id); if (!row) return;
    if (row.evidence_level === "point") {
      map.setView([row["coord.X"],row["coord.Y"]],7);
      pointMarkers.get(row.coordinate_key).openPopup();
    } else {
      const marker = countryMarkers.get(row.country);
      if (!marker) { root.querySelector(".explorer-status").textContent = "This historical country has no matching bundled polygon. Its evidence is retained in the table and CSV."; return; }
      field("polygons").checked = true; countryLayer.addTo(map);
      map.fitBounds(marker.getBounds()); marker.openPopup(marker.getBounds().getCenter());
    }
    el.scrollIntoView({block:"center",behavior:"smooth"});
    const selected = el.querySelector(`[data-evidence-id="${id}"]`);
    if (selected) { selected.open = true; selected.scrollIntoView({block:"nearest"}); }
  };
  const renderTable = () => {
    const slice = filtered.slice(page*perPage,(page+1)*perPage);
    results.innerHTML = `<div class="results-heading"><h3>Matching evidence</h3><span>${filtered.length ? page*perPage+1 : 0}–${Math.min((page+1)*perPage,filtered.length)} of ${filtered.length} records</span></div>
      ${filtered.length ? `<div class="evidence-table-scroll"><table><thead><tr><th>Locality / country</th><th>Collection host</th><th>Year</th><th>Reported mt label</th><th>Study</th><th>Evidence</th></tr></thead><tbody>
      ${slice.map(r => `<tr><td><button type="button" class="record-link" data-record="${r.record_id}">${esc(r.Region || r.Location)}</button><small>${esc(r.Location)} · ${r.is_new ? "Added 2026" : "Baseline"}</small></td>
      <td>${esc(r.displayHost)}</td><td>${esc(known(r.Year) ? r.Year : "Unavailable")}</td><td>${esc(mt(r))}</td>
      <td>${esc(r.study)}<small>${sourceLinks(r)}</small></td><td>${precision(r)}${r.nuclear ? "<small>WGS / RAD-seq evidence</small>" : ""}<small>${verification(r)}</small></td></tr>`).join("")}</tbody></table></div>
      <div class="result-pages"><button type="button" data-page="prev" ${page===0 ? "disabled" : ""}>Previous</button><button type="button" data-page="next" ${(page+1)*perPage>=filtered.length ? "disabled" : ""}>Next</button></div>` :
      "<p class='empty-results'>No matching records. Broaden a filter, include unknown years, or enable genome-wide evidence for unresolved mitochondrial calls.</p>"}`;
  };
  const fit = () => {
    const coords = filtered.filter(r => r.evidence_level === "point").map(r => [r["coord.X"],r["coord.Y"]]);
    if (coords.length) map.fitBounds(L.latLngBounds(coords),{padding:[30,30],maxZoom:8});
    else if (countryMarkers.size) { const bounds=L.latLngBounds([]); countryMarkers.forEach(m => bounds.extend(m.getBounds())); map.fitBounds(bounds); }
  };
  const update = () => {
    const s = state();
    const matching = records.filter(r => matches(r,s));
    const withheld = matching.filter(nuclearOnly).length;
    filtered = matching.filter(r => s.nuclear || !nuclearOnly(r)).sort((a,b) => Number(b.is_new)-Number(a.is_new) || a.country.localeCompare(b.country) || String(a.Region).localeCompare(String(b.Region)));
    pointLayer.clearLayers(); countryLayer.clearLayers(); areaLayer.clearLayers(); map.closePopup();
    pointMarkers = new Map(); countryMarkers = new Map();
    const pts = bucket(filtered.filter(r => r.evidence_level === "point"), r => r.coordinate_key);
    const ctys = bucket(filtered.filter(r => r.evidence_level === "country"), r => r.country);
    pointBuckets=pts;countryBuckets=ctys;
    areaShapes=s.areas&&s.colorby==="lineage"?atlasLineageAreas(filtered,Number(s.area_gap)||1500):[];
    areaShapes.forEach(a=>a.rings.forEach(ring=>{
      const color=colors[a.group]||"#52646d";
      L.polygon(ring,{pane:"lineageAreas",className:"lineage-area",color,weight:1.4,opacity:.65,dashArray:"5 3",fillColor:color,fillOpacity:.17,smoothFactor:0})
        .bindTooltip(`${esc(data.labels[a.group]||a.group)} · ${a.locations} sampled locations`)
        .bindPopup(`<div class="evidence-popup"><b>${esc(data.labels[a.group]||a.group)}</b><p>${a.locations} sampled locations · ${a.record_ids.length} records</p><p>Approximate sampling outline, not an established range. Neighbouring sites connect within ${Number(s.area_gap)||1500} km. Unsampled land or sea may fall inside.</p></div>`).addTo(areaLayer);
    }));
    root.querySelector(".area-gap").hidden=!s.areas;
    field("area_gap").disabled=s.colorby!=="lineage";
    root.querySelector(".area-status").textContent=!s.areas?"":s.colorby!=="lineage"?"Choose mitochondrial group colours to show lineage areas.":areaShapes.length?`${areaShapes.length} shaded ${areaShapes.length===1?"area":"areas"} · approximate sampling outlines` : "No area for these filters: each needs at least 3 nearby locations forming a polygon.";
    ctys.forEach((rows,name) => {
      const feature = features.get(name); if (!feature) return;
      const groups = unique(rows.map(r => colorKey(r,s)));
      const color = groups.length === 1 ? keyColor(groups[0],s) : "#7f8f87";
      const layer = L.geoJSON(feature,{style:{color:s.nuclear && rows.some(r=>r.nuclear) ? "#5b626b" : color,
        weight:s.nuclear && rows.some(r=>r.nuclear) ? 2.5 : 1.2, dashArray:s.nuclear && rows.some(r=>r.nuclear) ? "5,5" : null,fillColor:color,fillOpacity:.15}});
      layer.bindPopup(popup(rows),{maxWidth:510,maxHeight:350}).bindTooltip(`${name}: ${rows.length} matching records`).addTo(countryLayer);
      countryMarkers.set(name,layer);
    });
    pts.forEach((rows,key) => {
      const r=rows[0];
      const marker=L.marker([r["coord.X"],r["coord.Y"]],{title:`${r.Region}: ${rows.length} evidence records`,keyboard:true,
        icon:L.divIcon({className:"evidence-symbol",iconSize:[36,36],iconAnchor:[18,18],html:`<svg width="36" height="36" aria-hidden="true">${symbol(rows,s)}</svg>`})});
      marker.bindPopup(popup(rows),{maxWidth:510,maxHeight:350}).bindTooltip(`${r.Region}: ${rows.length} matching record${rows.length===1 ? "" : "s"}`).addTo(pointLayer);
      pointMarkers.set(key,marker);
    });
    if (s.polygons) countryLayer.addTo(map); else map.removeLayer(countryLayer);
    const groups = unique(filtered.map(r=>colorKey(r,s)));
    const legendButton = g => `<button type="button" class="legend-row" data-legend="${esc(g)}" title="Filter to ${esc(keyLabel(g,s))}"><svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true">${s.colorby==="species"?shape(g,keyColor(g,s),keyColor(g,s)):`<circle cx="18" cy="18" r="8" fill="${keyColor(g,s)}"/>`}</svg><span>${esc(keyLabel(g,s))}</span></button>`;
    legend.innerHTML=`<span class="atlas-kicker">${s.colorby==="species"?"MITE SPECIES":"MITOCHONDRIAL GROUPS"}</span><p>Click a colour to filter; click again to clear.</p><div class="legend-items">${groups.map(legendButton).join("")}</div>
      <details class="legend-symbols"><summary>Symbol guide</summary><div><span>● <i>V. destructor</i> &nbsp; ◆ <i>V. jacobsoni</i></span><span>■ <i>V. underwoodi</i> &nbsp; ▲ <i>V. rindereri</i></span><span>★ Unresolved species</span><span>Number = records at one coordinate</span><span>Equal ring segments = groups present</span><span class="new-key">Dotted gold halo = added in 2026</span><span>Dashed gray halo = genome evidence</span></div></details>`;
    const pointCount = filtered.filter(r=>r.evidence_level==="point").length;
    const countryCount = filtered.length-pointCount;
    const missing = [...ctys.keys()].filter(c=>!features.has(c));
    root.querySelector(".explorer-status").innerHTML = `<div class="atlas-stats"><span><b>${pointCount}</b> point records</span><span><b>${pts.size}</b> coordinate pairs</span><span><b>${countryCount}</b> country records</span><span><b>${filtered.filter(r=>r.is_new).length}</b> added in 2026</span></div>
      ${!s.nuclear && withheld ? `<small>${withheld} unresolved mt records can be shown with “Genome-wide evidence”.</small>` : ""}${missing.length ? `<small>Historical country retained in table: ${esc(missing.join(", "))}.</small>` : ""}${s.from && s.to && +s.from>+s.to ? "<small>The start year is after the end year; adjust the range.</small>" : ""}`;
    root.querySelector(".drawer-count").textContent=`${filtered.length} records`;
    const nFilters=["host","country","species","lineage","study","precision","assay","from","to","verification"].filter(k=>s[k]).length;
    root.querySelector(".filter-count").textContent=nFilters?`(${nFilters})`:"";
    drawDecoration();
    root.querySelectorAll("[data-preset]").forEach(button=>{
      const p=button.dataset.preset;
      const active=(p==="new"&&s.scope==="new"&&!s.host&&!s.species)||(p==="all"&&s.scope==="all"&&!s.host&&!s.species)||(p==="mellifera"&&s.host==="A. mellifera"&&s.scope==="all"&&!s.species)||(p==="destructor"&&s.host==="A. cerana"&&s.species==="V. destructor"&&s.scope==="all")||(p==="jacobsoni"&&s.host==="A. cerana"&&s.species==="V. jacobsoni"&&s.scope==="all");
      button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));
    });
    page=0;renderTable();
  };
  const reset = scope => { const gap=field("area_gap").value;stringFields.forEach(k=>field(k).value="");field("area_gap").value=gap||"1500";field("scope").value=scope;field("undated").checked=true;field("nuclear").checked=false;field("polygons").checked=true;field("highlight").checked=scope!=="new";field("labels").checked=true;field("colorby").value="lineage"; };
  const copyText = async (value,message) => {
    try { await navigator.clipboard.writeText(value);root.querySelector(".explorer-status").textContent=message; }
    catch (_) { const input=document.createElement("textarea");input.value=value;input.setAttribute("aria-label",message);results.prepend(input);input.select();root.querySelector(".explorer-status").textContent="Select and copy the text below."; }
  };
  root.addEventListener("change",event=>{
    if(event.target.name==="inaturalist"){loadInat();return;}
    if(event.target.name==="inat_species"){drawInat();return;}
    if (event.target.name==="lineage" && field("lineage").value==="VD_nuclear_evidence" || event.target.name==="assay" && field("assay").value==="genome") field("nuclear").checked=true;
    update();
  });
  let timer;
  ["q","from","to"].forEach(name => field(name).addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(update,120);}));
  root.addEventListener("click",event=>{
    const button=event.target.closest("button");if(!button)return;
    if(button.dataset.preset){const p=button.dataset.preset;const mode=field("colorby").value;reset(p==="new"?"new":"all");field("colorby").value=mode;if(p==="mellifera")field("host").value="A. mellifera";if(p==="destructor"||p==="jacobsoni"){field("host").value="A. cerana";field("species").value=p==="destructor"?"V. destructor":"V. jacobsoni";}update();setRegion(p==="all"||p==="mellifera"?"world":p==="jacobsoni"?"southeast":"asia");}
    if(button.dataset.record)showRecord(button.dataset.record);
    if(button.dataset.page){page+=button.dataset.page==="next"?1:-1;renderTable();}
    const action=button.dataset.action;
    if(action==="inat-retry")loadInat();
    if(action==="inat-fit"){const coords=inatVisibleRows().map(r=>[r.coordinates[1],r.coordinates[0]]);if(coords.length){map.fitBounds(coords,{padding:[25,25],maxZoom:8});setViewTitle("INATURALIST SPECIES OBSERVATIONS");}}
    if(button.dataset.region)setRegion(button.dataset.region);
    if(button.dataset.legend){const target=field(field("colorby").value==="species"&&button.dataset.legend!=="VD_nuclear_evidence"?"species":"lineage");target.value=target.value===button.dataset.legend?"":button.dataset.legend;update();}
    if(action==="fit"){fit();setViewTitle("MATCHING LOCATIONS");}
    if(action==="filters"){const panel=root.querySelector(".explorer-filters");panel.hidden=!panel.hidden;button.setAttribute("aria-expanded",String(!panel.hidden));}
    if(action==="expand")toggleExpanded();
    if(action==="svg")exportFigure();
    if(action==="reset"){reset("all");update();fit();}
    if(action==="share"){const params=new URLSearchParams();const s=state();stringFields.forEach(k=>{if(s[k])params.set(k,s[k]);});checks.forEach(k=>params.set(k,s[k]?"1":"0"));const center=map.getCenter();params.set("lat",center.lat.toFixed(5));params.set("lng",center.lng.toFixed(5));params.set("zoom",map.getZoom());const url=new URL(location.href);url.search=params.toString();url.hash="explore-the-evidence";copyText(url.href,"View link copied, including filters and map position.");}
    if(action==="cite"){const selected=unique(filtered.flatMap(r=>r.archiveText?[r.study,"Techer et al. (2022)"]:[r.study]));const citation="Varroa mitochondrial lineage distribution resource. Curated evidence update: 5 November 2026. https://mikheyevlab.github.io/varroa-mtDNA-world-distrib/\nTraynor et al. (2020). Varroa destructor: A Complex Parasite, Crippling Honey Bees Worldwide. https://doi.org/10.1016/j.pt.2020.04.004\n\nSelected source studies (cite those used in your analysis):\n"+selected.map(name=>name+" "+[...(references.get(name)||[])].map(doi=>"https://doi.org/"+doi).join(" ")).join("\n");copyText(citation,"Resource citation and selected study references copied.");}
    if(action==="download"){
      const columns=["record_id","evidence_level","Species","Host","Year","Location","Region","Haplogroup","GROUP","coord.X","coord.Y","Coord.type","Description","Source","is_new","input_id","reported_mt","reference","archiveText","verification_status","verified_by","verified_at","verification_note","fingerprint"];
      const quote=value=>'"'+String(value==null?"":value).replace(/"/g,'""')+'"';
      const csv="\uFEFF"+columns.map(quote).join(",")+"\r\n"+filtered.map(r=>columns.map(k=>quote(r[k])).join(",")).join("\r\n")+"\r\n";
      const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="varroa_evidence_2026-11-05_filtered.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      root.querySelector(".explorer-status").textContent=`Downloaded ${filtered.length} filtered evidence records with original field values and display annotations.`;
    }
  });
  function setViewTitle(title){root.querySelector(".atlas-view-title").textContent="A · "+title;}
  function setRegion(name){
    const views={world:[[-54,-170],[73,180]],asia:[[-12,65],[54,155]],east:[[17,98],[47,145]],southeast:[[-12,92],[26,143]]};
    map.fitBounds(views[name],{padding:[12,12],animate:false});
    setViewTitle({world:"WORLD DISTRIBUTION",asia:"ASIA & THE WESTERN PACIFIC",east:"EAST ASIA",southeast:"SOUTHEAST ASIA"}[name]);
    root.querySelectorAll("[data-region]").forEach(b=>{b.classList.toggle("active",b.dataset.region===name);b.setAttribute("aria-pressed",String(b.dataset.region===name));});
  }
  function toggleExpanded(){
    const expanded=root.classList.toggle("is-expanded");
    document.body.classList.toggle("atlas-expanded",expanded);
    const button=root.querySelector('[data-action="expand"]');button.setAttribute("aria-pressed",String(expanded));button.querySelector("span").textContent=expanded?"Close":"Expand";
    map.invalidateSize();
  }
  root.addEventListener("keydown",e=>{if(e.key==="Escape"&&root.classList.contains("is-expanded"))toggleExpanded();});
  function exportFigure(){
    const s=state(), size=map.getSize(), w=1100, h=w*size.y/size.x, scale=w/size.x;
    const keys=unique(filtered.map(r=>colorKey(r,s))), legendRows=Math.ceil(keys.length/3), height=h+292+legendRows*24+(areaShapes.length?24:0);
    const xy=coord=>{const p=map.latLngToContainerPoint([coord[1],coord[0]]);return [p.x*scale,p.y*scale];};
    const scopeText=s.scope==="new"?"2026 additions":s.scope==="baseline"?"2021 baseline":"All curated evidence";
    const text=(x,y,t,size=14,fill="#304646")=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${esc(t)}</text>`;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1196" height="${height}" viewBox="0 0 1196 ${height}"><title>Varroa evidence atlas — ${esc(scopeText)}</title><desc>Filtered occurrence records. Symbol locations and coordinates are unchanged. Equal ring segments indicate groups present, not frequencies. Current geographic viewport; filters are recorded in metadata.</desc><metadata>${esc(JSON.stringify({filters:s,extent:map.getBounds(),record_ids:filtered.map(r=>r.record_id),resource:"https://mikheyevlab.github.io/varroa-mtDNA-world-distrib/",source:"Traynor et al. 2020, doi:10.1016/j.pt.2020.04.004"}))}</metadata><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif">${text(48,36,"VARROA / GLOBAL EVIDENCE ATLAS",12,"#697f79")}${text(48,68,scopeText+(s.host?" · "+s.host:""),27)}${text(1148,36,"05 NOV 2026",12,"#697f79").replace('<text ','<text text-anchor="end" ')}<defs><clipPath id="map-clip"><rect width="${w}" height="${h}"/></clipPath></defs><g transform="translate(48 94)"><g clip-path="url(#map-clip)"><rect width="${w}" height="${h}" fill="#f7faf9"/><path d="${featurePath(data.world.features,xy)}" fill="#e8ebe5" fill-rule="evenodd" stroke="#b9c3bf" stroke-width=".7"/>`;
    graticule().forEach(line=>{const a=xy([line[0][1],line[0][0]]),b=xy([line[1][1],line[1][0]]);svg+=`<path d="M${a.join(",")}L${b.join(",")}" stroke="#b8c9c5" stroke-width=".7" stroke-dasharray="2 5"/>`;});
    if(s.polygons)countryBuckets.forEach((rows,name)=>{const f=features.get(name);if(!f)return;const groups=unique(rows.map(r=>colorKey(r,s))),c=groups.length===1?keyColor(groups[0],s):"#7f8f87";svg+=`<path d="${featurePath([f],xy)}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="1" fill-rule="evenodd"/>`;});
    areaShapes.forEach(a=>a.rings.forEach(ring=>{const c=colors[a.group]||"#52646d",d=ring.map(([lat,lng],i)=>`${i?"L":"M"}${xy([lng,lat]).join(",")}`).join("")+"Z";svg+=`<path class="lineage-area" d="${d}" fill="${c}" fill-opacity=".17" stroke="${c}" stroke-opacity=".65" stroke-width="1.4" stroke-dasharray="5 3"/>`;}));
    if(s.labels)geoLabels.filter(l=>map.getZoom()>=l[3]&&map.getZoom()<6.5).forEach(([lat,lng,name])=>{const p=xy([lng,lat]);svg+=`<text x="${p[0]}" y="${p[1]}" text-anchor="middle" letter-spacing="1.7" font-size="12" fill="#6e8079">${esc(name)}</text>`;});
    pointBuckets.forEach(rows=>{const r=rows[0],p=xy([+r["coord.Y"],+r["coord.X"]]);svg+=`<g transform="translate(${p[0]-18} ${p[1]-18})">${symbol(rows,s)}</g>`;});
    svg+=`</g><rect width="${w}" height="${h}" fill="none" stroke="#9eafa7" stroke-width=".8"/>`;
    const scaleNode=el.querySelector(".leaflet-control-scale-line");
    if(scaleNode){const sw=scaleNode.getBoundingClientRect().width*scale;svg+=`<rect x="${w-sw-38}" y="${h-46}" width="${sw+28}" height="34" fill="#ffffffdd"/><path d="M${w-sw-24},${h-29}v8h${sw}v-8" stroke="#526c5f" fill="none"/>`+text(w-sw-24,h-33,scaleNode.textContent,11);}
    svg+="</g>";
    const y=h+124;
    svg+=text(48,y,`Matching evidence: ${pointBuckets.size} coordinate pairs · ${filtered.filter(r=>r.evidence_level==="point").length} point records · ${filtered.filter(r=>r.evidence_level==="country").length} country records`,14);
    svg+=text(48,y+25,"Filled: published coordinates   Hollow: approximate   Number: shared records   Gold halo: added 2026   Gray halo: genome evidence",12);
    svg+=text(48,y+44,"Circles: V. destructor   Diamonds: V. jacobsoni   Squares: V. underwoodi   Triangles: V. rindereri   Stars: unresolved species",12);
    keys.forEach((key,i)=>{const x=48+(i%3)*367,yy=y+74+Math.floor(i/3)*24;svg+=(s.colorby==="species"?`<g transform="translate(${x-4} ${yy-13}) scale(.5)">${shape(key,keyColor(key,s),keyColor(key,s))}</g>`:`<circle cx="${x+5}" cy="${yy-4}" r="4" fill="${keyColor(key,s)}"/>`)+text(x+17,yy,keyLabel(key,s),12);});
    const end=y+87+legendRows*24;
    svg+=text(48,end,"Counts include all matching records; only locations in the current map extent are shown. Rings do not encode sample proportions.",12);
    svg+=text(48,end+20,"Occurrence evidence; neither prevalence nor continuous ranges. Filters: "+[s.species,s.country,s.study,s.q,s.from&&"from "+s.from,s.to&&"through "+s.to].filter(Boolean).join("; ").slice(0,115),12);
    svg+=text(48,end+40,"Resource: Traynor et al. (2020), doi:10.1016/j.pt.2020.04.004 · Cite the selected source studies separately.",12);
    if(areaShapes.length)svg+=text(48,end+60,`Shading: convex sampling outlines, not established ranges; links within ${Number(s.area_gap)||1500} km; at least 3 distinct locations.`,12);
    svg+="</g></svg>";
    const url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="varroa_evidence_atlas_2026.svg";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    root.querySelector(".explorer-status").textContent="Vector figure exported with the current map extent, legend, source credit and filter metadata.";
  }
  update();
  if(field("inaturalist").checked)loadInat();
  setRegion("asia");
  if (["lat","lng","zoom"].every(k=>initial.has(k) && Number.isFinite(+initial.get(k))) &&
      Math.abs(+initial.get("lat"))<=90 && Math.abs(+initial.get("lng"))<=180) {
    map.setView([+initial.get("lat"),+initial.get("lng")],Math.max(0,Math.min(18,+initial.get("zoom"))));
  } else if (initial.has("q") || initial.has("country") || initial.has("study")) fit();
  new ResizeObserver(()=>map.invalidateSize()).observe(el);
}
