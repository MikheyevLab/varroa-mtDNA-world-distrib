/* A local draft is never loaded on the public site or marked manually verified. */
"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const local = ["localhost","127.0.0.1","[::1]"].includes(location.hostname);
  const base = local ? "data/phylogeny-review/cox1_20261105/" : "data/phylogeny/";
  let data, treeHash;
  try {
    const response = await fetch(base+"tree.json");
    if (!response.ok) throw new Error("No tree released");
    const treeText=await response.text();data=JSON.parse(treeText);
    treeHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(treeText)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if (!local && data.status !== "manually_reviewed_release") throw new Error("Review pending");
  } catch (_) {
    $("tree-status").textContent = "Awaiting review";
    $("tree-summary").textContent = "A tree will appear here after curator review.";
    return;
  }
  // Links come from the exact analysis input, not a fuzzy accession or place-name match.
  try {
    const response=await fetch(base+'record_links.json');
    if(response.ok){const links=await response.json();if(links.tree_sha256===treeHash)Object.entries(links.members).forEach(([ac,link])=>{if(data.members[ac])data.members[ac].record_link=link;});}
  } catch(_) { /* The original NCBI links remain available if no matching link file exists. */ }
  let publishedRecords;
  const publicRecords=()=>publishedRecords||(publishedRecords=fetch('data/records.json').then(r=>{if(!r.ok)throw new Error('Record register unavailable');return r.json();}).then(d=>d.records));
  let recordRequest=0;
  async function openRecord(id) {
    const request=++recordRequest, dialog=$('tree-record-dialog'),content=$('tree-record-content');
    content.innerHTML='<h2 id="tree-record-title">Sample record</h2><p>Loading…</p>';if(!dialog.open)dialog.showModal();
    try {
      let r;
      if(local){try{const response=await fetch('api/review/record?id='+encodeURIComponent(id),{cache:'no-store'});if(response.ok)r=(await response.json()).record;}catch(_){} }
      if(!r)r=(await publicRecords()).find(row=>row.record_id===id);
      if(request!==recordRequest)return;
      if(!r)throw new Error(local?'This record is pending review. Start the local review server to inspect it.':'This record is not available in the published register.');
      const q=r.source?.qualifiers||{},sample=[q.specimen_voucher,q.isolate,q.strain].filter(Boolean).join(' · ');
      const status={verified:'Manually verified',not_verified:'Not verified',needs_recheck:'Needs recheck'}[r.verification_status]||'Verification unavailable';
      const fields=[['Record',r.record_id],['Accession',r.accession],['Sample / voucher',sample],['Species',r.species],['Host',r.host],['Country / locality',[r.country,r.locality].filter(Boolean).join(' · ')],['Collection date',r.collection_year],['Reported lineage',r.reported_lineage]];
      content.innerHTML=`<h2 id="tree-record-title">${esc(sample||r.accession||r.record_id)}</h2><p><span class="badge ${r.verification_status==='verified'?'verified':'pending'}">${esc(status)}</span>${r.publication_status==='pending_review'?' <span class="badge">Pending publication</span>':''}</p><dl>${fields.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v||'Not recorded')}</dd>`).join('')}</dl><p>${esc(r.reference)}</p><div class="tree-record-links">${/^https?:\/\//.test(r.source_url||'')?`<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Original source ↗</a>`:''}${local?`<a href="review.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">Review this record ↗</a>`:''}${r.publication_status==='published'?`<a href="records.html?record=${encodeURIComponent(id)}" target="_blank" rel="noopener">Open in Records ↗</a>`:''}</div><details class="tree-record-source"><summary>Original source fields</summary><dl>${Object.entries(r.source||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v,null,2):v)||'—'}</dd>`).join('')}</dl></details>${r.verified_by?`<p class="muted">${esc(r.verified_by)} · ${esc(r.verified_at)} · ${esc(r.verification_note)}</p>`:''}`;
    }catch(error){if(request===recordRequest)content.innerHTML=`<h2 id="tree-record-title">Record ${esc(id)}</h2><p>${esc(error.message)}</p>`;}
  }
  $('tree-record-close').onclick=()=>{$('tree-record-dialog').close();recordRequest++;};
  $("tree-status").textContent = data.status === "draft_not_manually_verified" ? "Local draft · Not manually verified" : "Reviewed release";
  $("tree-summary").textContent = `${data.summary.included.toLocaleString()} sequences · ${data.summary.sequence_groups} distinct aligned sequences · ${data.summary.window_length} COX1 sites · ${data.summary.excluded} excluded by QC or overlap`;
  $("tree-explorer").hidden = false;
  const colors = {"Varroa destructor":"#ab4937","Varroa jacobsoni":"#387d68","Varroa underwoodi":"#427cad","Varroa rindereri":"#8870a4"};
  const color = species => colors[species] || "#8b815e";
  const speciesList = [...new Set(Object.values(data.members).map(m=>m.species))].sort();
  $("tree-species").innerHTML = '<option value="">All species</option>'+speciesList.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
  let root, tips = [], nodes = [], maxDepth = 1, filteredCount = 0, species = "";
  let index = 0;
  function indexTree(n, parent=null, depth=0) {
    n.parent = parent; n.depth = depth; n.uid = ++index; nodes.push(n);
    if (n.children) {
      n.children.forEach(c=>indexTree(c,n,depth+c.length));
      n.allMembers = n.children.flatMap(c=>c.allMembers);
    } else { tips.push(n); n.allMembers = n.members; }
    n.species = [...new Set(n.allMembers.map(a=>data.members[a].species))];
    n.color = n.species.length === 1 ? color(n.species[0]) : "#9aa69e";
  }
  let selected = null, zoom = 1, query = "", layout = "radial";
  const labels = m => [...new Set([m.reported_lineage,...m.source_annotations.map(a=>a.label)].filter(Boolean))];
  const textFor = n => n.members.map(a=>{const m=data.members[a];return [a,m.record_link?.sample_name,...Object.values(m.record_link?.identifiers||{}),m.species,m.country,m.host,m.reference,...labels(m)].join(" ");}).join(" ").toLowerCase();
  function rebuild() {
    // Prune the display only. Surviving branches retain their lengths and support.
    function prune(original) {
      const n = {...original};
      if(n.children){n.children=n.children.map(prune).filter(Boolean);return n.children.length?n:null;}
      n.members=n.members.filter(a=>!species||data.members[a].species===species);
      return n.members.length?n:null;
    }
    root=prune(data.tree);
    // Omit the stem above the selected tips' common ancestor; pairwise distances stay unchanged.
    while(root.children?.length===1)root=root.children[0];
    tips=[];nodes=[];index=0;indexTree(root);
    maxDepth=Math.max(...tips.map(n=>n.depth),.001);
    filteredCount=tips.reduce((s,n)=>s+n.members.length,0);
    const shownSpecies=species?[species]:speciesList;
    $("tree-legend").innerHTML=shownSpecies.map(s=>`<span><i style="background:${color(s)}"></i>${esc(s.replace("Varroa ","V. "))}</span>`).join("");
    $("tree-summary").textContent=`${filteredCount.toLocaleString()} sequence${filteredCount===1?"":"s"} · ${tips.length} distinct aligned sequence${tips.length===1?"":"s"} · ${data.summary.window_length} COX1 sites${species?" · "+species:" · "+data.summary.excluded+" excluded by QC or overlap"}`;
    $("tree-caption").textContent=tips.length===1?"One sequence group is available for this species; no within-species branching can be shown.":(species?"Species view of the full inferred tree. ":"")+"Branch length = substitutions per site. Unrooted inference; select a tip to inspect its accessions.";
    tips.forEach(n=>{
    n.search = textFor(n);
    n.annotated = n.members.some(a=>data.members[a].source_annotations.some(s=>s.record_id.startsWith("R") || s.label === "type T"));
    const names = [...new Set(n.members.flatMap(a=>labels(data.members[a])))];
    const preferred = names.find(n=>n === "type T") || names[0];
    n.label = preferred ? `${preferred}${names.length>1?" +":""}` : n.members[0];
    n.label += n.members.length>1 ? ` · ${n.members.length}` : "";
    });
  }
  rebuild();
  const matches = n => query && n.search.includes(query);
  const point = (r,a) => [500+r*Math.cos(a),450+r*Math.sin(a)];
  const xy = p => p.map(v=>v.toFixed(3)).join(",");
  const supportTitle = n => n.support ? `SH-aLRT / ultrafast bootstrap: ${n.support}` : "Support unavailable";
  function draw() {
    tips.forEach((n,i)=>{n.order=i;n.angle=-Math.PI/2+(i+.5)*2*Math.PI/tips.length;n.y=35+i*24;});
    function place(n) {
      if(n.children){n.children.forEach(place);n.angle=n.children.reduce((s,c)=>s+c.angle,0)/n.children.length;n.y=n.children.reduce((s,c)=>s+c.y,0)/n.children.length;}
      n.radius=n.depth/maxDepth*260;n.x=35+n.depth/maxDepth*580;
    }
    place(root);
    const radial=layout === "radial", height=radial?900:Math.max(400,tips.length*24+85), width=1000;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="Unrooted Varroa COX1 maximum-likelihood tree" style="width:${zoom*100}%;min-width:${radial?0:850}px;height:auto;background:#fffefa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><title>${esc(species||"Varroa")} COX1 phylogeny — ${esc(data.status)}</title><desc>${filteredCount} sequences grouped by exact aligned sequence. ${esc(data.model)}. Branch support is SH-aLRT / ultrafast bootstrap. ${species?"Subset of the full inferred tree.":""}</desc>`;
    for(const n of nodes){
      if(!n.parent)continue;
      const p=n.parent;
      let d;
      if(radial){const a=point(p.radius,p.angle),b=point(p.radius,n.angle),c=point(n.radius,n.angle);d=`M${xy(a)} A${p.radius},${p.radius} 0 ${Math.abs(n.angle-p.angle)>Math.PI?1:0} ${n.angle>p.angle?1:0} ${xy(b)} L${xy(c)}`;}
      else d=`M${p.x},${p.y} V${n.y} H${n.x}`;
      svg+=`<path d="${d}" fill="none" stroke="${n.color}" stroke-width="1.6" stroke-linecap="round"><title>${esc(n.children?supportTitle(n):n.label)}</title></path>`;
      if(n.children && $("tree-support").checked && n.support){const pos=radial?point(n.radius,n.angle):[n.x,n.y];svg+=`<text x="${pos[0]+3}" y="${pos[1]-4}" fill="#354e48" font-size="9">${esc(n.support)}</text>`;}
    }
    for(const n of tips){
      const hit=matches(n),active=n===selected,visibleLabel=!radial||n.annotated||hit||active;
      const pos=radial?point(n.radius,n.angle):[n.x,n.y];
      const end=radial?point(tips.length===1?0:285,n.angle):[640,n.y];
      if(visibleLabel)svg+=`<path d="M${xy(pos)} L${xy(end)}" stroke="${n.color}" opacity=".28" stroke-width=".8" stroke-dasharray="2 3"/>`;
      const tipSize=hit||active?6:Math.min(5,2.7+Math.log10(n.members.length));
      svg+=`<g data-tip="${n.uid}" tabindex="0" role="button" aria-label="${esc(n.label)}; ${n.members.length} accessions" style="cursor:pointer"><title>${esc(n.label)} — ${n.members.length} accessions</title>`;
      if(hit||active)svg+=`<circle cx="${pos[0]}" cy="${pos[1]}" r="10" fill="#d8b651" opacity=".5"/>`;
      svg+=`<circle cx="${pos[0]}" cy="${pos[1]}" r="${tipSize}" fill="${n.color}" stroke="${hit||active?'#243f36':'#fffefa'}" stroke-width="1.2"/>`;
      if(visibleLabel){
        const text=n.label.length>34?n.label.slice(0,32)+"…":n.label;
        if(radial && tips.length===1){svg+=`<text x="512" y="454" fill="${n.color}" font-size="14">${esc(text)}</text>`;}
        else if(radial){const deg=n.angle*180/Math.PI,left=Math.cos(n.angle)<0;svg+=`<text transform="translate(${xy(end)}) rotate(${left?deg+180:deg})" x="${left?-7:7}" dy="4" text-anchor="${left?'end':'start'}" fill="${hit||active?'#183e34':n.color}" font-size="12" font-weight="${hit||active?'700':'450'}">${esc(text)}</text>`;}
        else svg+=`<text x="650" y="${n.y+4}" fill="${n.color}" font-size="12" font-weight="${hit||active?'700':'450'}">${esc(text)}</text>`;
      }
      svg+="</g>";
    }
    const magnitude=10**Math.floor(Math.log10(maxDepth/4)),ratio=maxDepth/4/magnitude;
    const scale=magnitude*(ratio>=5?5:ratio>=2?2:1),scaleWidth=scale/maxDepth*(radial?260:580),y=height-32;
    if(tips.length>1)svg+=`<path d="M35,${y-4} V${y} H${35+scaleWidth} V${y-4}" fill="none" stroke="#34564a"/><text x="35" y="${y+18}" font-size="11" fill="#34564a">${Number(scale.toPrecision(2))} substitutions / site</text>`;
    svg+=`<text x="965" y="${y+18}" text-anchor="end" font-size="10" fill="#526b65">${esc(species||"Varroa")} · ${filteredCount} sequences · ${esc(data.model)} · ${data.status === "draft_not_manually_verified" ? "DRAFT" : "REVIEWED"}</text></svg>`;
    $("tree-canvas").innerHTML=svg;
  }
  function memberCard(ac) {
    const m=data.members[ac];
    const ann=m.source_annotations;
    const places=[...new Set([m.country,...ann.map(a=>a.country)].filter(Boolean))];
    const hosts=[...new Set([m.host,...ann.map(a=>a.host)].filter(Boolean))];
    const link=m.record_link, name=link?.sample_name?`${link.sample_name} · ${ac}`:ac;
    const reports=[...new Map(ann.map(a=>[a.record_id,a])).values()];
    return `<article class="tree-member">${link?`<button class="tree-sample-link" data-record="${esc(link.record_id)}">${esc(name)}</button>`:`<a href="https://www.ncbi.nlm.nih.gov/nuccore/${encodeURIComponent(ac)}" target="_blank" rel="noopener">${esc(name)} ↗</a>`}<span class="badge pending">Not verified</span><p><i>${esc(m.species)}</i>${places.length?` · ${esc(places.join("; "))}`:""}</p>${hosts.length?`<p>${esc(hosts.join("; "))}</p>`:""}<a class="tree-ncbi-link" href="https://www.ncbi.nlm.nih.gov/nuccore/${encodeURIComponent(ac)}" target="_blank" rel="noopener">NCBI ↗</a>${reports.length?`<p class="muted">Study / locality records</p><ul>${reports.map(a=>`<li><button class="tree-source-link" data-record="${esc(a.record_id)}">${esc(a.record_id)} · ${esc(a.label)} — ${esc(a.reference)}</button></li>`).join("")}</ul>`:`<p class="muted">${esc(m.reported_lineage||"No reported lineage")}</p>`}<details><summary>Source</summary><p>${esc(m.reference)}</p><p class="muted">Names, host and place may include annotations from study or locality records, which can describe more than one specimen.</p></details></article>`;
  }
  function detail(n) {
    selected=n;
    $("tree-detail").innerHTML=`<h2>${esc(n.label)}</h2><p class="muted">${n.members.length} accession${n.members.length===1?"":"s"} with the same aligned sequence. This group is not a new lineage name.</p>${n.members.map(memberCard).join("")}`;
    draw();
    if(n.members.length===1&&data.members[n.members[0]].record_link)openRecord(data.members[n.members[0]].record_link.record_id);
    else $('tree-detail').scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function search() {
    query=$("tree-search").value.trim().toLowerCase();selected=null;
    const found=tips.filter(matches);
    if(query)$("tree-detail").innerHTML=`<h2>${found.length} matching tip${found.length===1?"":"s"}</h2><p class="muted">${found.reduce((s,n)=>s+n.members.length,0)} accessions in these sequence groups.</p>${found.map(n=>`<button class="tree-result" data-result="${n.uid}">${esc(n.label)} <span>Inspect ↗</span></button>`).join("")}`;
    else $("tree-detail").innerHTML='<h2>Sequences</h2><p class="muted">Select a tip or search for an accession.</p>';
    draw();
  }
  $("tree-search").addEventListener("input",search);
  $("tree-species").onchange=()=>{species=$("tree-species").value;zoom=1;rebuild();search();};
  $("tree-taiwan").onclick=()=>{species="Varroa destructor";$("tree-species").value=species;rebuild();$("tree-search").value="type T";search();};
  $("tree-reset").onclick=()=>{$("tree-search").value="";$("tree-species").value="";species="";zoom=1;rebuild();search();};
  $("tree-layout").onchange=()=>{layout=$("tree-layout").value;zoom=1;draw();};
  $("tree-support").onchange=draw;
  $("tree-plus").onclick=()=>{zoom=Math.min(4,zoom*1.3);draw();};
  $("tree-minus").onclick=()=>{zoom=Math.max(.7,zoom/1.3);draw();};
  $("tree-fit").onclick=()=>{zoom=1;draw();};
  $("tree-canvas").addEventListener("click",e=>{const target=e.target.closest("[data-tip]");if(target)detail(tips.find(n=>n.uid===Number(target.dataset.tip)));});
  $("tree-canvas").addEventListener("keydown",e=>{if(!["Enter"," "].includes(e.key))return;const target=e.target.closest("[data-tip]");if(target){e.preventDefault();detail(tips.find(n=>n.uid===Number(target.dataset.tip)));}});
  $("tree-detail").addEventListener("click",e=>{const record=e.target.closest('[data-record]');if(record){openRecord(record.dataset.record);return;}const target=e.target.closest("[data-result]");if(target)detail(tips.find(n=>n.uid===Number(target.dataset.result)));});
  for(const [id,file] of [["tree-newick","tree.treefile"],["tree-fasta","window_alignment.fasta"],["tree-qc","window_qc.tsv"]])$(id).href=base+file;
  $("tree-svg").onclick=()=>{
    const svg=$("tree-canvas").querySelector("svg").cloneNode(true);svg.removeAttribute("style");svg.setAttribute("width","1400");svg.setAttribute("height",String(Math.round(1400*svg.viewBox.baseVal.height/svg.viewBox.baseVal.width)));
    const href=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"}));
    const a=document.createElement("a");a.href=href;a.download="varroa_cox1_draft.svg";a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  };
  $("tree-methods").innerHTML=`<p>Species colours and filters use reported GenBank names, including historical taxonomy. The species view preserves branches from the full tree; it does not rerun inference.</p><p>GenBank snapshot: 5 November 2026. ${data.summary.records} records retrieved; ${data.summary.included} retained. Annotated COX1 was extracted and screened for length, ambiguity and internal stop codons (invertebrate mitochondrial code 5).</p><p>MAFFT 7.526 aligned 20 historical sequences with a full-length COX1 scaffold (NC_004454.2), then added the remaining fragments with orientation correction and insertion mapping. The tree uses the 458-base AF106899.1 coordinate window; sequences require at least ${data.summary.min_overlap} unambiguous overlapping bases. A further alignment screen requires no more than 15% difference from a historical anchor; this is a review threshold, not a species boundary. Exact aligned strings are grouped; gaps are not treated as matching bases.</p><p>IQ-TREE 2.3.6: maximum likelihood, ModelFinder (BIC: <strong>${esc(data.model)}</strong>), 1,000 ultrafast bootstraps with BNNI, 1,000 SH-aLRT replicates, seed 20261105, four threads. Support is shown as SH-aLRT / ultrafast bootstrap. No outgroup or lineage reassignment was imposed.</p><p>Short fragments and failed checks remain in the <a href="${base}window_qc.tsv">QC table</a>. They have not been placed on this tree. IQ-TREE flagged 30 near-zero internal branches: fine-scale relationships should be treated as unresolved unless the support and alignment justify them.</p><p><a href="${base}tree.iqtree">IQ-TREE report</a> · <a href="${base}tree.log">Analysis log</a> · <a href="${base}tree_input.fasta">Grouped alignment</a> · <a href="${base}groups.json">Tip membership</a> · <a href="${base}taiwan_reference_comparisons.tsv">Taiwan T comparisons</a> · <a href="${base}inputs.json">Input checksums</a></p>`;
  draw();
})();
