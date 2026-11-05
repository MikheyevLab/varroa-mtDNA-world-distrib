function foldMapCode(){
/* Keep reproducible code available without a separate report-theme toolbar. */
document.querySelectorAll('pre.sourceCode,pre.r,pre.bash').forEach(pre=>{
  if(pre.closest('details'))return;
  const block=pre.closest('div.sourceCode')||pre, details=document.createElement('details'), summary=document.createElement('summary');
  details.className='map-code';summary.textContent='Code';block.before(details);details.append(summary,block);
});

}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",foldMapCode,{once:true});else foldMapCode();
