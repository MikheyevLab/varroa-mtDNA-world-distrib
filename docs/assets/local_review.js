function addLocalReviewLink(){
/* A curator workspace link is useful locally; the public resource has no write API. */
if (["127.0.0.1","localhost","[::1]"].includes(location.hostname)) {
  const nav=document.querySelector('nav[aria-label="Resource navigation"]');
  if(nav){const link=document.createElement("a");link.href="review.html";link.textContent="Review";if(document.body.dataset.page==="review")link.setAttribute("aria-current","page");(nav.querySelector("div")||nav).append(link);}
}

}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addLocalReviewLink,{once:true});else addLocalReviewLink();
