// Reloj virtual: con __vt.on() el juego avanza solo cuando se llama __vt.step(ms)
(()=>{const rRAF=window.requestAnimationFrame.bind(window),rCAF=window.cancelAnimationFrame.bind(window);
const rNow=performance.now.bind(performance);let on=false,vt=0,off=0,q=new Map(),id=1e6;
performance.now=()=>on?vt:rNow();
window.requestAnimationFrame=cb=>{if(!on)return rRAF(cb);const i=id++;q.set(i,cb);return i;};
window.cancelAnimationFrame=i=>{if(q.has(i))q.delete(i);else rCAF(i);};
window.__vt={on(){vt=rNow();on=true;},off(){on=false;const c=[...q.values()];q.clear();c.forEach(f=>rRAF(f));},
 step(ms){vt+=ms;const c=[...q.values()];q.clear();for(const f of c){try{f(vt)}catch(e){console.error(e)}}},
 get pending(){return q.size}};})();
