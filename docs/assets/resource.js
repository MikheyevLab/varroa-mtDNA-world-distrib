/* Published evidence only: review decisions are made in the curator's repository. */
"use strict";
const initializeResource = () => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const url = value => /^https?:\/\//i.test(value || "") ? esc(value) : "";
  const labels = {map:"Map evidence", literature:"Literature", ncbi:"NCBI", reference:"Naming catalogue", sequence:"Sequence"};
  const badge = row => `<span class="badge ${row.verification_status === "verified" ? "verified" : row.verification_status === "needs_recheck" ? "recheck" : "pending"}">${{verified:"✓ Manually verified",not_verified:"Not yet verified",needs_recheck:"Needs recheck"}[row.verification_status]}</span>`;
  const source = row => url(row.source_url) ? `<a href="${url(row.source_url)}" target="_blank" rel="noopener">${esc(row.reference || row.accession || "Open source")} ↗</a>` : esc(row.reference || "Source unavailable");
  const norm = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const dateText = text => text ? text.slice(0,10) : "Date not recorded";
  const read = async () => {
    const response = await fetch("data/records.json");
    if (!response.ok) throw new Error("Could not load the evidence register");
    return response.json();
  };
  const home = (records, bibliography) => {
    const papers = new Map();
    records.filter(r=>r.dataset === "literature" && r.added_date).forEach(r=>{
      const key = r.reference.trim();
      if (!papers.has(key)) papers.set(key, {row:r, rows:[]});
      const group=papers.get(key); group.rows.push(r);
      if((r.added_date||"")>(group.row.added_date||""))group.row=r;
    });
    const year = r => Math.max(0,...(r.reference.match(/(?:19|20)\d{2}/g)||[]).map(Number));
    const recent = [...papers.values()].sort((a,b)=>b.row.added_date.localeCompare(a.row.added_date)||year(b.row)-year(a.row)||a.row.reference.localeCompare(b.row.reference)).slice(0,5);
    document.querySelector("#paper-feed").innerHTML = recent.map(({row})=>{
      const doi=(row.source.DOI || row.source_url || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
      const journal=bibliography[doi];
      const journalText=journal ? ` · <abbr title="${esc(journal.journal)}">${esc(journal.abbreviation)}</abbr>` : "";
      return `<article class="feed-line"><a class="feed-title" href="records.html?dataset=literature&q=${encodeURIComponent(row.reference)}">${esc(row.reference)}${journalText} <span aria-hidden="true">↗</span></a><time datetime="${esc(row.added_date)}" title="Date added to this resource">${dateText(row.added_date)}</time></article>`;
    }).join("");
    const ncbi=records.filter(r=>r.dataset==="ncbi").sort((a,b)=>(b.ncbi_created||"").localeCompare(a.ncbi_created||"")||a.accession.localeCompare(b.accession)).slice(0,5);
    const snapshot=records.filter(r=>r.dataset==="ncbi").map(r=>r.snapshot_date||"").sort().at(-1);
    document.querySelector("#ncbi-snapshot").textContent="Snapshot · "+(snapshot||"Date unavailable");
    document.querySelector("#ncbi-feed").innerHTML=ncbi.map(r=>`<article class="feed-line"><a class="feed-title" href="records.html?dataset=ncbi&q=${encodeURIComponent(r.accession)}" title="${esc(r.species)} · ${esc(r.source.Gene || r.source.gene || "")}">${esc(r.accession)} <span aria-hidden="true">↗</span></a>${badge(r)}<time datetime="${esc(r.ncbi_created)}" title="GenBank creation date">${dateText(r.ncbi_created)}</time></article>`).join("");
  };
  const browser = records => {
    let page=0, filtered=[];
    const size=25;
    const search=document.querySelector("#record-search"), dataset=document.querySelector("#record-dataset"), verification=document.querySelector("#record-verification"), sort=document.querySelector("#record-sort");
    const params=new URLSearchParams(location.search);
    let selectedRecord=params.get('record')||'';
    search.value=params.get("q")||"";dataset.value=params.get("dataset")||"";verification.value=params.get("verification")||"";
    records.forEach(r=>r.searchText=norm(JSON.stringify(r)));
    const detail = id => {
      const r=records.find(r=>r.record_id===id);if(!r){document.querySelector('#record-count').textContent='This record is not available in the published register.';return;}
      selectedRecord=id;const link=new URL(location.href);link.searchParams.set('record',id);history.replaceState(null,'',link);
      const review=r.verification_status==="verified" ? `Certified by ${esc(r.verified_by)} on ${esc(dateText(r.verified_at))}.` : r.verification_status==="needs_recheck" ? `The record changed after the review by ${esc(r.verified_by)} on ${esc(dateText(r.verified_at))}. The previous certification no longer applies.` : "No current manual certification is recorded. Automated checks cannot change this status.";
      document.querySelector("#detail-content").innerHTML=`<p class="eyebrow">${esc(labels[r.dataset])} · ${esc(r.record_id)}</p><h2>${esc(r.species || r.reference)}</h2>${badge(r)}<p>${review}</p>${r.verification_note?`<p>Review note: ${esc(r.verification_note)}</p>`:""}<p>${source(r)}</p><h3>Original source fields</h3><dl>${Object.entries(r.source).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==="object"?JSON.stringify(v):v)||"—"}</dd>`).join("")}</dl><p class="fingerprint">Record fingerprint: ${esc(r.fingerprint)}</p>`;
      document.querySelector("#record-detail").showModal();
    };
    const render = () => {
      const rows=filtered.slice(page*size,(page+1)*size);
      document.querySelector("#record-count").textContent=`${filtered.length.toLocaleString()} matching records`;
      document.querySelector("#record-rows").innerHTML=rows.length ? rows.map(r=>`<tr><td><button class="record-open" data-id="${esc(r.record_id)}">${esc(r.record_id)}</button><small>${esc(labels[r.dataset])}</small>${r.accession?`<small>${esc(r.accession)}</small>`:""}</td><td><i>${esc(r.species)}</i><small>${esc(r.host || "Host unavailable")}</small></td><td>${esc(r.country || "Unavailable")}<small>${esc(r.locality || "")}</small></td><td>${esc(r.reported_lineage || "Unresolved / unavailable")}</td><td>${source(r)}<small>${r.added_date?`Added ${dateText(r.added_date)}`:"Addition date not recorded"}</small></td><td>${badge(r)}${r.verification_status==="verified"?`<small>${esc(r.verified_by)} · ${dateText(r.verified_at)}</small>`:""}</td></tr>`).join("") : '<tr><td colspan="6">No matching records. Broaden your search or clear a filter.</td></tr>';
      document.querySelector("#page-number").textContent=`Page ${page+1} of ${Math.max(1,Math.ceil(filtered.length/size))}`;
      document.querySelector("#previous-page").disabled=page===0;document.querySelector("#next-page").disabled=(page+1)*size>=filtered.length;
      document.querySelector("#download-filtered").disabled=!filtered.length;
    };
    const update = () => {
      const words=norm(search.value).trim().split(/\s+/).filter(Boolean);
      filtered=records.filter(r=>(!dataset.value||r.dataset===dataset.value)&&(!verification.value||r.verification_status===verification.value)&&words.every(w=>r.searchText.includes(w)));
      filtered.sort((a,b)=>sort.value==="added"?(b.added_date||"").localeCompare(a.added_date||""):sort.value==="ncbi"?(b.ncbi_created||"").localeCompare(a.ncbi_created||""):sort.value==="country"?(a.country||"").localeCompare(b.country||""):a.record_id.localeCompare(b.record_id,undefined,{numeric:true}));
      page=0;render();
      const p=new URLSearchParams();if(search.value)p.set("q",search.value);if(dataset.value)p.set("dataset",dataset.value);if(verification.value)p.set("verification",verification.value);
      if(selectedRecord)p.set('record',selectedRecord);
      history.replaceState(null,"",location.pathname+(p.size?"?"+p.toString():""));
    };
    [search,dataset,verification,sort].forEach(el=>el.addEventListener(el===search?"input":"change",update));
    document.querySelector("#record-rows").addEventListener("click",event=>{const b=event.target.closest("[data-id]");if(b)detail(b.dataset.id);});
    document.querySelector(".dialog-close").addEventListener("click",()=>document.querySelector("#record-detail").close());
    document.querySelector('#record-detail').addEventListener('close',()=>{selectedRecord='';const link=new URL(location.href);link.searchParams.delete('record');history.replaceState(null,'',link);});
    document.querySelector("#previous-page").onclick=()=>{page--;render();};document.querySelector("#next-page").onclick=()=>{page++;render();};
    document.querySelector("#download-filtered").onclick=()=>{
      const columns=["record_id","dataset","verification_status","verified_by","verified_at","verification_note","fingerprint","species","host","country","locality","collection_year","reported_lineage","canonical_lineage","accession","reference","source_url","added_date","ncbi_created","ncbi_updated","snapshot_date","publication_status","source_json"];
      const quote=value=>'"'+String(value??"").replace(/"/g,'""')+'"';
      const tsv=columns.join("\t")+"\n"+filtered.map(r=>columns.map(k=>quote(k==="source_json"?JSON.stringify(r.source):r[k])).join("\t")).join("\n")+"\n";
      const href=URL.createObjectURL(new Blob([tsv],{type:"text/tab-separated-values;charset=utf-8"}));const a=document.createElement("a");a.href=href;a.download="varroa_records_filtered.tsv";a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
    };
    update();
    if(selectedRecord)detail(selectedRecord);
  };
  if(["phylogeny","review","submit","maps"].includes(document.body.dataset.page))return;
  read().then(({records,bibliography={}})=>document.body.dataset.page==="index"?home(records,bibliography):browser(records)).catch(error=>{
    const target=document.querySelector("#record-count")||document.querySelector("#paper-feed");if(target)target.textContent=error.message+". Please reload or download the TSV.";
  });
 };
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initializeResource,{once:true});else initializeResource();
