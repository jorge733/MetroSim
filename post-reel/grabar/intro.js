const c=require('./common');
(async()=>{const {b,p}=await c.open({keepIntro:true});
await c.rec(p,'clip-intro',300);
await b.close();})();
