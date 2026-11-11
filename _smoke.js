// 无头冒烟测试：模拟浏览器环境，AI bot 自动防守多波
const fs = require('fs');
const html = fs.readFileSync('D:/code/userfeed/3/neon-sentry.html', 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

function makeCtx(){
  const noop=()=>{};
  const grad={addColorStop:noop};
  return new Proxy({}, { get(t,k){
    if(k==='createLinearGradient'||k==='createRadialGradient') return ()=>grad;
    if(k==='measureText') return ()=>({width:100});
    return typeof t[k]!=='undefined' ? t[k] : noop;
  }, set(t,k,v){ t[k]=v; return true; }});
}
const listeners={}, canvasListeners={};
const elements={};
function makeEl(){
  return { style:{}, classList:{add(){},remove(){},contains(){return false;}},
    onclick:null, innerHTML:'', textContent:'', appendChild(){}, addEventListener(){},
    getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}) };
}
const canvas = { width:1280, height:720, style:{}, getContext:()=>makeCtx(),
  getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
  addEventListener:(ev,fn)=>{(canvasListeners[ev]=canvasListeners[ev]||[]).push(fn);} };
const documentStub = {
  getElementById:(id)=> elements[id] || (elements[id]= id==='game' ? canvas : makeEl()),
  createElement:()=>({ width:0,height:0,getContext:()=>makeCtx() })
};
const storage={};
function FakeNode(){
  return { connect(){}, gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},
    frequency:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},
    type:'', start(){}, stop(){} };
}
function FakeAudioContext(){
  return { currentTime:0, sampleRate:44100, destination:{},
    createGain:()=>FakeNode(), createOscillator:()=>FakeNode(),
    createBiquadFilter:()=>FakeNode(),
    createBuffer:(ch,len)=>({getChannelData:()=>new Float32Array(len)}),
    createBufferSource:()=>Object.assign(FakeNode(),{buffer:null}) };
}
const windowStub = {
  innerWidth:1280, innerHeight:720,
  addEventListener:(ev,fn)=>{(listeners[ev]=listeners[ev]||[]).push(fn);},
  AudioContext:FakeAudioContext, webkitAudioContext:FakeAudioContext
};
const rafQueue=[];
let simTime=0;
const sandbox={
  document:documentStub, window:windowStub, canvas,
  localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=String(v);}},
  performance:{now:()=>simTime*1000},
  requestAnimationFrame:(fn)=>{rafQueue.push(fn);},
  setTimeout:()=>{}, setInterval:()=>0, clearInterval(){},
  console, Math, Date, JSON, isNaN, parseInt, parseFloat,
};
sandbox.globalThis=sandbox;
const vm=require('vm');
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__T={G,CARDS,CORE,startGame,startWave,mouse,keys,deployDrone,droneType};', sandbox, {filename:'game.js'});
const T=sandbox.__T;

const key=(code,evt={})=>(listeners['keydown']||[]).forEach(fn=>fn(Object.assign({code,preventDefault(){},repeat:false},evt)));
const canvasEv=(ev,evt)=>{ (canvasListeners[ev]||[]).forEach(fn=>fn(Object.assign({clientX:0,clientY:0},evt))); };
const deployAt=(x,y,type)=>{
  key('Digit'+type);
  T.mouse.x=x; T.mouse.y=y;
  canvasEv('mousedown',{button:2});
};

T.startGame();
console.log('started, state =', T.G.state, 'wave =', T.G.wave);

// 防御阵地：核心(150,360) 周围的部署点（哨兵三角 + 护盾）
const SENTRY_SPOTS=[[380,220],[380,500],[520,360]];
const SHIELD_SPOTS=[[262,250],[262,470]];
let errors=[];
const STEP=1/60;
let lastWave=1, upgradesChosen=0, maxDrones=0, bossSeen=false;

for(let frame=0; frame<60*60*12; frame++){
  simTime+=STEP;
  const G=T.G, p=G.player;

  // 每波开始补满无人机阵地
  if(frame%120===0 && G.state==='playing'){
    let si=0, hi=0;
    for(const d of G.drones){ if(d.kind==='sentry')si++; else hi++; }
    if(si<Math.min(3,p.s.slots) && si<SENTRY_SPOTS.length) deployAt(...SENTRY_SPOTS[si],1);
    else if(hi<1 && G.drones.length<p.s.slots && hi<SHIELD_SPOTS.length) deployAt(...SHIELD_SPOTS[hi],2);
  }

  if(G.state==='playing' && p && p.alive){
    // 走位：绕核心 (300,360) 缓慢巡航
    const tx=300+Math.cos(simTime*.5)*110, ty=360+Math.sin(simTime*.8)*180;
    T.keys.delete('KeyW');T.keys.delete('KeyA');T.keys.delete('KeyS');T.keys.delete('KeyD');
    if(Math.abs(tx-p.x)>14) T.keys.add(tx>p.x?'KeyD':'KeyA');
    if(Math.abs(ty-p.y)>14) T.keys.add(ty>p.y?'KeyS':'KeyW');
    // 瞄准最近敌人，持续开火
    let ne=null,nd=1e9;
    for(const e of G.enemies){ const d=Math.hypot(e.x-p.x,e.y-p.y); if(d<nd){nd=d;ne=e;} }
    if(ne){ T.mouse.x=ne.x; T.mouse.y=ne.y; }
    T.mouse.down=true;
    // 受伤后偶尔冲刺
    if(frame%200===0 && p.s.hp<p.s.maxHp*0.7) key('Space');
  }

  // 升级：优先无人机槽位/哨兵，其次武器，最后防御
  if(G.state==='upgrade'){
    upgradesChosen++;
    const s=G.player.s;
    const avail=T.CARDS.filter(c=>(s.cardLv[c.name]||0)<c.max);
    const pref=['额外机库','哨兵聚焦镜','超频电容','疾速枪机','复合装甲','核心抢修','穿甲光核','双联发射器','力场扩张','纳米修复'];
    const c=pref.map(n=>avail.find(a=>a.name===n)).find(Boolean) || avail[0];
    c.apply(s); s.cardLv[c.name]=(s.cardLv[c.name]||0)+1;
    elements['upgrade'].classList.add('hidden');
    T.startWave();
  }

  if(G.enemies.some(e=>e.type==='boss')) bossSeen=true;
  maxDrones=Math.max(maxDrones,G.drones.length);

  if(G.state==='gameover'){
    console.log('GAME OVER at wave', G.wave, '| score', G.score, '| kills', G.kills);
    break;
  }
  const q=rafQueue.shift();
  try{ q(simTime*1000); }
  catch(e){ errors.push({frame,msg:e.message,where:(e.stack||'').split('\n')[1]}); if(errors.length>5)break; }

  if(G.wave>lastWave){
    lastWave=G.wave;
    console.log('-> wave', lastWave, '| score', G.score, '| drones', G.drones.length,
      '| core', Math.round(T.CORE.hp), '| playerHp', Math.round(G.player.s.hp));
  }
}
console.log('\n==== 结果 ====');
console.log('最终波次:', T.G.wave, '| 状态:', T.G.state, '| 遭遇Boss:', bossSeen);
console.log('升级次数:', upgradesChosen, '| 峰值无人机:', maxDrones);
console.log('得分:', T.G.score, '| 击杀:', T.G.kills, '| 最高分持久化:', storage['neon-sentry-hi']);
console.log('残留实体 -> 敌人:', T.G.enemies.length, '无人机:', T.G.drones.length, '敌弹:', T.G.eBullets.length,
  '粒子:', T.G.particles.length, '光束:', T.G.beams.length, '能量球:', T.G.orbs.length);
console.log('运行时错误:', errors.length?errors:'无');
process.exit(errors.length?1:0);
