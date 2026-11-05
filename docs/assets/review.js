"use strict";
(async()=>{
  const $=id=>document.getElementById(id), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  if(!["localhost","127.0.0.1","[::1]"].includes(location.hostname)){$("review-message").textContent="This workspace is available on the curator’s computer.";return;}
  let token, page=0, current=null, busy=false, listRequest=0, selectionRequest=0, dirty=false;
  const message=(text,error=false)=>{$("review-message").textContent=text;$("review-message").className=error?"review-error":"muted";};
  const api=async(path,body)=>{const r=await fetch("api/review/"+path,body?{method:"POST",headers:{"Content-Type":"application/json","X-Review-Token":token},body:JSON.stringify(body)}:{cache:"no-store"});const data=await r.json();if(!r.ok)throw new Error(data.error||"The request failed");return data;};
  const status=r=>r.verification_status==="verified"?"Verified":r.verification_status==="needs_recheck"?"Needs recheck":"Not verified";
  async function list(){
    const request=++listRequest;
    const p=new URLSearchParams({q:$("review-search").value,dataset:$("review-dataset").value,status:$("review-status").value,page});
    try{const data=await api("records?"+p);if(request!==listRequest)return;
      $("review-count").textContent=`${data.total.toLocaleString()} ${data.total===1?"record":"records"} · ${data.verified} verified overall`;
      $("review-page").textContent=`${data.page+1} / ${data.pages}`;$("review-prev").disabled=page===0;$("review-next").disabled=page+1>=data.pages;
      $("review-list").innerHTML=data.records.map(r=>`<button class="review-item ${current?.record.record_id===r.record_id?'selected':''}" data-record="${esc(r.record_id)}"><strong>${esc(r.record_id)} · ${esc(r.species||r.accession||r.dataset)}</strong><span>${esc(r.reference||"Source not specified")}</span><small>${esc(r.country)} · ${esc(status(r))}${r.publication_status==="pending_review"?" · Pending publication":""}</small></button>`).join("")||'<p class="muted">No matching records.</p>';
    }catch(e){message(e.message,true);}
  }
  const urls=r=>{
    const values=new Set();if(/^https?:\/\//.test(r.source_url||""))values.add(r.source_url);
    const text=JSON.stringify(r.source);
    (text.match(/https?:\/\/[^\s"<>\\]+/g)||[]).forEach(s=>values.add(s.replace(/[),.;]+$/, "")));
    return [...values].slice(0,12);
  };
  function render(){
    const {record:r,notes,history,open_issues}=current;
    const source=r.source||{};
    const sample=[source.qualifiers?.specimen_voucher,source.qualifiers?.isolate,source.qualifiers?.strain].filter(Boolean).join(' · ');
    const coords=source["coord.X"]!==undefined?`${source["coord.X"]}, ${source["coord.Y"]} (${source["Coord.type"]||"precision unspecified"})`:"Not recorded / not applicable";
    const fields=[["Sample / voucher",sample],["Species",r.species],["Host",r.host],["Country / place",[r.country,r.locality].filter(Boolean).join(" · ")],["Collection date",r.collection_year],["Reported lineage",r.reported_lineage],["Accession",r.accession],["Coordinates (latitude, longitude)",coords]];
    const links=urls(r);
    $("review-record").innerHTML=`<div class="review-record-heading"><h2>${esc(r.record_id)} · ${esc(r.species||r.dataset)}</h2><span class="badge ${r.verification_status==='verified'?'verified':'pending'}">${status(r)}</span></div><p>${esc(r.reference)}</p><div class="review-links">${links.map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener">${u.includes("doi.org")?'Paper / DOI':u.includes('ncbi.nlm.nih.gov')?'NCBI source':`Source ${i+1}`} ↗</a>`).join("")||'<span class="muted">No direct source link recorded.</span>'}<button id="review-copy" class="button">Copy for our chat</button><button id="review-refresh" class="button">Refresh</button></div>
    <dl class="review-fields">${fields.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v||"Not recorded")}</dd>`).join("")}</dl>
    <details class="review-source"><summary>Original source fields</summary><dl>${Object.entries(source).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v):v)||"—"}</dd>`).join("")}</dl></details>
    <section class="review-notes"><h3>Notes &amp; proposed corrections</h3><div id="review-history">${notes.map(n=>`<article class="review-note"><strong>${esc(n.author)}${n.author_role==='assistant'?' · Assistant suggestion':''}</strong><small>${esc(n.kind)} · ${esc(n.timestamp.slice(0,10))}${!n.current_version?' · Earlier record version':''}${n.resolved?' · Resolved':''}</small><p>${esc(n.text)}</p>${n.field?`<p><b>${esc(n.field)}:</b> proposed ${esc(n.proposed_value)}</p>`:''}${n.evidence?`<p class="muted">Source: ${esc(n.evidence)}</p>`:''}${n.current_version&&!n.resolved&&['question','correction'].includes(n.kind)?`<button class="button" data-resolve="${esc(n.note_id)}">Resolve issue</button>`:''}</article>`).join("")||'<p class="muted">No notes yet.</p>'}</div>
    <label>Your name<input id="review-author" autocomplete="name" value="${esc(localStorage.getItem('atlas-reviewer')||'')}" placeholder="Name of the person reviewing"></label>
    <div class="review-note-controls"><label>Type<select id="review-kind"><option value="note">Note</option><option value="question">Question</option><option value="correction">Proposed correction</option></select></label><label>Field (for a correction)<input id="review-field" placeholder="e.g. host, coordinates, year"></label><label>Proposed value<input id="review-proposed" placeholder="Leave empty for a note"></label></div>
    <label>Note or question<textarea id="review-note" rows="3" placeholder="What should we check? Which value needs correction?"></textarea></label><label>Evidence / source location<input id="review-evidence" placeholder="DOI or accession, page, table, row…"></label><p class="muted">Proposed corrections are saved for discussion. Source data stay unchanged until we apply an agreed correction.</p><button id="review-save" class="button">Save note</button></section>
    <section class="review-decision"><h3>Manual decision</h3><p class="muted">Check each item against the source. Documented unknowns may remain unknown.</p><div class="review-checks">${[['source','Source / accession'],['species','Species'],['host','Host'],['location','Location & precision'],['date','Collection date'],['lineage','Reported lineage & terminology']].map(([k,l])=>`<label><input type="checkbox" data-check="${k}">${l}</label>`).join("")}</div><label>Review note<textarea id="review-decision-note" rows="2" placeholder="Sources checked and interpretation retained; or reason for revoking"></textarea></label><label class="review-attest"><input type="checkbox" id="review-attest">I personally checked this record and am recording my decision.</label>${open_issues?`<p class="review-error">${open_issues} unresolved issue(s) must be resolved before verification.</p>`:''}<div class="review-links"><button id="review-verify" class="button primary" ${open_issues?'disabled':''}>Mark verified</button>${r.verification_status==='verified'?'<button class="button" data-decision="revoke">Revoke verification</button>':''}${r.verification_status==='verified'&&r.publication_status==='pending_review'?'<button class="button" data-decision="release">Release to local site</button>':''}</div><p class="muted">Verification is recorded for this exact version. New imports need a separate release; the website is not deployed by this action.</p></section>
    <details class="review-source"><summary>Decision history &amp; version</summary><p class="fingerprint">${esc(r.fingerprint)}</p>${history.map(h=>`<p>${esc(h.action)} · ${esc(h.reviewer)} · ${esc(h.timestamp)}<br>${esc(h.note)}</p>`).join("")||'<p>No decisions recorded.</p>'}</details>`;
    dirty=false;
    $("review-record").querySelectorAll('input,textarea,select').forEach(el=>el.addEventListener('input',()=>{dirty=true;}));
    $("review-copy").onclick=async()=>{const prompt=`Please help me review atlas record ${r.record_id}.\nVersion: ${r.fingerprint}\nSource: ${r.reference}\n${links.join('\n')}\n${$("review-note").value||'Check the species, host, collection date, location, coordinates and reported lineage against the source. Add findings or proposed corrections to the shared review notes. Do not certify this record on my behalf.'}\nLocal workspace: ${location.origin}/review.html?id=${encodeURIComponent(r.record_id)}`;try{await navigator.clipboard.writeText(prompt);message('Copied. Paste it into our chat to review this record together.');}catch(_){message(prompt);}};
    $("review-refresh").onclick=()=>select(r.record_id);
    $("review-save").onclick=()=>save('note');
    $("review-verify").onclick=()=>save('verify');
    $("review-record").querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>save(b.dataset.decision));
    $("review-record").querySelectorAll('[data-resolve]').forEach(b=>b.onclick=()=>save('note',b.dataset.resolve));
  }
  async function select(id){
    if(dirty&&!confirm('Leave these unsaved notes?'))return;
    const request=++selectionRequest;
    try{const data=await api('record?id='+encodeURIComponent(id));if(request!==selectionRequest)return;current=data;render();history.replaceState(null,'','review.html?id='+encodeURIComponent(id));await list();message('Notes are shared locally. Only your manual decision grants verification.');}catch(e){message(e.message,true);}
  }
  async function save(action,resolves=''){
    if(busy)return;
    const author=$("review-author").value.trim();localStorage.setItem('atlas-reviewer',author);
    const payload={action,record_id:current.record.record_id,fingerprint:current.record.fingerprint,author,author_role:'human',
      text:action==='note'?$("review-note").value:$("review-decision-note").value,
      evidence:$("review-evidence").value,kind:resolves?'resolution':$("review-kind").value,resolves,
      field:$("review-field").value,proposed_value:$("review-proposed").value,
      attest:$("review-attest").checked,checks:Object.fromEntries([...document.querySelectorAll('[data-check]')].map(c=>[c.dataset.check,c.checked]))};
    if(resolves&&!payload.text.trim()){message('Write how the issue was resolved in the note field, then choose Resolve issue.',true);return;}
    busy=true;
    try{current=await api('action',payload);dirty=false;render();await list();message(action==='note'?'Note saved. Verification is unchanged.':'Decision saved. Rebuilding the local website…');if(action!=='note')pollBuild();}catch(e){message(e.message,true);}finally{busy=false;}
  }
  async function pollBuild(){try{const s=await api('session');if(s.build.status==='building')setTimeout(pollBuild,2000);else message(s.build.status==='failed'?`Decision saved, but the site build failed. See ${s.build.log||s.build.error}`:'Local website updated. Reload other pages to see the new status.',s.build.status==='failed');}catch(e){message(e.message,true);}}
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  try{const session=await api('session');token=session.token;$("review-workspace").hidden=false;
    let timer;$("review-search").oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;list();},250);};
    [$("review-dataset"),$("review-status")].forEach(el=>el.onchange=()=>{page=0;list();});
    $("review-prev").onclick=()=>{page--;list();};$("review-next").onclick=()=>{page++;list();};
    $("review-list").onclick=e=>{const b=e.target.closest('[data-record]');if(b)select(b.dataset.record);};
    await list();const id=new URLSearchParams(location.search).get('id');if(id)await select(id);else message('Select a record to begin. No records have been verified automatically.');
  }catch(_){message('Start the local review server with: python scripts/review_workspace.py serve — use the Python environment listed in CURATION.md.',true);}
})();
