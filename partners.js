'use strict';
// PREVIEW SAFETY: keep false until a partner-specific endpoint and Formspree
// Required destination: partners@fohboh.ai (configure recipient in Formspree, not a hidden field).
// dashboard settings (including no visitor autoresponder) are verified.
const FORM_CONFIG = Object.freeze({live:false, endpoint:'https://formspree.io/f/REPLACE_WITH_VERIFIED_PARTNER_FORM_ID'});
const form=document.querySelector('#partner-form');
const checks=[...document.querySelectorAll('input[name="categories"]')];
const list=document.querySelector('#selected');
const status=document.querySelector('#status');
function selection(){return checks.filter(el=>el.checked).map(el=>el.value)}
function render(){
 const chosen=selection();document.querySelector('#count').textContent=chosen.length;
 document.querySelector('#empty').hidden=chosen.length>0;document.querySelector('#clear').hidden=!chosen.length;
 document.querySelector('#category-error').hidden=true;status.textContent='';list.replaceChildren();
 checks.forEach(el=>{el.closest('.card').classList.toggle('chosen',el.checked);el.nextElementSibling.textContent=el.checked?'Added to inquiry':'Add to inquiry'});
 chosen.forEach(value=>{const li=document.createElement('li');const text=document.createElement('span');text.textContent=value;const button=document.createElement('button');button.type='button';button.textContent='×';button.setAttribute('aria-label','Remove '+value);button.addEventListener('click',()=>{const check=checks.find(el=>el.value===value);check.checked=false;render();check.focus()});li.append(text,button);list.append(li)});
}
checks.forEach(el=>el.addEventListener('change',render));
document.querySelector('#clear').addEventListener('click',()=>{checks.forEach(el=>el.checked=false);render();checks[0].focus()});
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!selection().length){document.querySelector('#category-error').hidden=false;checks[0].focus();return}
 if(!form.reportValidity())return;
 if(!FORM_CONFIG.live){status.textContent='Your inquiry includes '+selection().join(', ')+'. Nothing has been sent or saved. The inquiry form must be connected before it can send to partners@fohboh.ai.';return}
 if(!/^https:\/\/formspree\.io\/f\/[a-z0-9]+$/i.test(FORM_CONFIG.endpoint)){status.textContent='The inquiry service is not configured. Nothing was sent.';return}
 const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Sending your inquiry…';
 try{const response=await fetch(FORM_CONFIG.endpoint,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'}});if(!response.ok)throw Error('Submission failed');status.textContent='Thank you. Your inquiry has been received.';form.reset();checks.forEach(el=>el.checked=false);render();status.textContent='Thank you. Your inquiry has been received.'}catch(error){status.textContent='We could not confirm your inquiry was received. Please try again later.'}finally{button.disabled=false}
});render();
