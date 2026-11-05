/* The form prepares a draft on the visitor's device; nothing is sent by the site. */
"use strict";
function submissionDraft(values) {
  const clean=value=>String(value||"").trim();
  const subject="Varroa atlas — missing record";
  const body=["Suggested record for manual review", "", "Source: "+clean(values.source),
    "Species: "+(clean(values.species)||"Not specified"), "Country / locality: "+(clean(values.place)||"Not specified"),
    "", "Notes:", clean(values.notes)||"None", "", "Submitted by: "+(clean(values.contributor)||"Not specified")].join("\n");
  return {subject,body,url:"mailto:maeva.angelique.techer@gmail.com?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body)};
}
if(typeof document!=="undefined") {
  const form=document.getElementById("submission-form"), status=document.getElementById("submission-status");
  const draft=()=>submissionDraft(Object.fromEntries(new FormData(form)));
  function preview(d){document.getElementById("submission-fallback").hidden=false;document.getElementById("submission-preview").value="Subject: "+d.subject+"\n\n"+d.body;}
  form.addEventListener("submit",event=>{
    event.preventDefault();const d=draft();preview(d);
    status.textContent="Email draft prepared. Send it from your mail app to submit. If no app opens, use Copy details and email Maeva directly.";
    window.location.href=d.url;
  });
  document.getElementById("copy-submission").addEventListener("click",async()=>{
    if(!form.reportValidity())return;
    const d=draft();preview(d);
    try{await navigator.clipboard.writeText("To: maeva.angelique.techer@gmail.com\nSubject: "+d.subject+"\n\n"+d.body);status.textContent="Copied. Paste into an email to maeva.angelique.techer@gmail.com and send for review.";}
    catch(_){document.getElementById("submission-fallback").open=true;document.getElementById("submission-preview").select();status.textContent="Copy the email text below and send it to Maeva for review.";}
  });
}
