'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { randomBytes, timingSafeEqual } = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {maxHttpBufferSize:10000,cors:{origin:false}});
const PORT = Number(process.env.PORT || 3000);
const dir = process.env.DATA_DIR || path.join(__dirname,'data');
fs.mkdirSync(dir,{recursive:true});
const file = path.join(dir,'rooms.json');
let rooms = {};
try {rooms=JSON.parse(fs.readFileSync(file,'utf8'));} catch (err) {if(err.code!=='ENOENT') console.error('Saved data unavailable:',err.message)}
const token = (n=16) => randomBytes(n).toString('hex');
const roomCode=()=>randomBytes(4).toString('hex').toUpperCase();
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const clean=(v,n=24)=>typeof v==='string'?v.trim().slice(0,n):'';
const groupConfigs=[{id:1,mode:'online',capacity:4},{id:2,mode:'online',capacity:4},{id:3,mode:'online',capacity:3},{id:4,mode:'online',capacity:3},{id:5,mode:'onsite',capacity:4}];
const stageNames=['認識彼此','說得清楚','聽懂與回應'];
const decks=[
['如果用三個詞形容自己，你會選哪三個？為什麼？','你最近發現的一件有趣小事是什麼？','如果突然有三天假期，你會如何安排？','你有什麼不太為人所知的興趣或技能？','你最喜歡的一部電影或一本書是什麼？為什麼？','你最喜歡一天當中的哪個時段？為什麼？','你曾經收到最令你印象深刻的禮物是什麼？','如果能立即學會一項新技能，你會選擇什麼？','什麼樣的小事最容易讓你感到開心？','你希望新同事記住你的哪個特點？'],
['向大家介紹一個你最喜歡的地方，讓人想去看看。','用一分鐘教大家完成一件你擅長的小事。','介紹一個你常用的 App，並說明推薦原因。','向沒吃過的人介紹一道你喜歡的料理。','分享一次你解決困難的經驗，說明過程與結果。','如果要推薦一部電影，你會如何吸引別人觀看？','向完全不認識你的人介紹你的家鄉。','解釋一個你熟悉、但其他人可能不懂的詞語。','分享一個你曾經改變想法的經驗及原因。','描述你理想中的工作環境，以及三個重要條件。'],
['分享一次讓你感到被理解的經驗。','你認為好的溝通最重要的是什麼？','分享一個你曾經遇過的溝通誤會。','當別人不同意你的觀點時，你通常怎麼處理？','你曾經接受過什麼令你印象深刻的幫助？','你認為一位好的客服人員應該具備什麼特質？','當你不理解別人的意思時，你會如何確認？','分享一個你曾經耐心教導別人的經驗。','當你感到緊張時，會用什麼方式讓自己平靜？','你希望未來的同事如何與你合作？']
];
function save(){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rooms));fs.renameSync(tmp,file)}
function createRoom(name){let code;do{code=roomCode()}while(rooms[code]);const room={code,hostToken:token(24),hostName:name,stage:0,createdAt:Date.now(),timer:{seconds:60,endsAt:null},groups:groupConfigs.map(g=>({...g,history:[[],[],[]]})),members:{}};rooms[code]=room;save();return room}
function role(room,personToken){if(equal(personToken,room.hostToken))return {isHost:true};const m=Object.values(room.members).find(x=>x.token&&equal(x.token,personToken));return m?{isHost:false,member:m}:null}
function publicRoom(room, auth){return {code:room.code,stage:room.stage,stageNames,groups:room.groups.map(g=>({id:g.id,mode:g.mode||groupConfigs[g.id-1].mode,capacity:g.capacity||groupConfigs[g.id-1].capacity,members:Object.values(room.members).filter(m=>m.group===g.id).map(m=>({id:m.id,name:m.name,active:!!m.token,...(auth.isHost&&m.inviteCode?{inviteCode:m.inviteCode}:{})})),history:g.history,current:g.history[room.stage].length?g.history[room.stage].at(-1):null})),timer:room.timer,createdAt:room.createdAt,isHost:auth.isHost,myGroup:auth.member?.group||null,myId:auth.member?.id||null};}
function sync(room){for(const [id,s] of io.sockets.sockets){if(s.data.room!==room.code)continue;const r=role(room,s.data.token);if(!r){s.emit('session:invalid');s.leave(room.code);s.data.room=null;continue}s.emit('room:state',publicRoom(room,r));}}
const responses=(s,evt,fn)=>s.on(evt,(payload={},ack)=>{const callback=typeof ack==='function'?ack:()=>{};try{if(!s.data.rate)s.data.rate=[];const now=Date.now();s.data.rate=s.data.rate.filter(t=>now-t<1000);if(s.data.rate.length>=12)return callback({ok:false,error:'操作過於頻繁，請稍後再試。'});s.data.rate.push(now);fn(payload,callback)}catch(e){console.error(evt,e);callback({ok:false,error:'伺服器發生錯誤。'})}});
const fail=(ack,message)=>ack({ok:false,error:message});
function authSocket(s,ack,needHost=false){const r=rooms[s.data.room];const a=r&&role(r,s.data.token);if(!r||!a){fail(ack,'登入狀態已失效，請重新進入活動。');return null}if(needHost&&!a.isHost){fail(ack,'只有講師可以執行這個操作。');return null}return {room:r,auth:a}}
app.use(express.static(path.join(__dirname,'public'),{index:'index.html'}));
app.get('/health',(_req,res)=>res.json({ok:true}));
app.get('/api/decks',(_req,res)=>res.json({decks,stageNames}));
io.on('connection',s=>{
 responses(s,'room:create',(p,ack)=>{const name=clean(p.name)||'講師';const r=createRoom(name);s.data.room=r.code;s.data.token=r.hostToken;s.join(r.code);ack({ok:true,code:r.code,token:r.hostToken});sync(r)});
 responses(s,'room:join',(p,ack)=>{const code=clean(p.code,20).toUpperCase();const r=rooms[code];if(!r)return fail(ack,'找不到活動，請確認加入代碼。');const name=clean(p.name);if(!name)return fail(ack,'請輸入姓名或暱稱。');let existing=Object.values(r.members).find(m=>m.token&&equal(m.token,p.token));if(existing){existing.name=name;save()}else{const mode=clean(p.mode,10);if(!['online','onsite'].includes(mode))return fail(ack,'請選擇線上或現場參與。');const invite=clean(p.inviteCode,32).toUpperCase();if(invite){const target=Object.values(r.members).find(m=>m.inviteCode&&equal(m.inviteCode,invite));if(!target)return fail(ack,'個人加入碼不正確或已使用。');if(target.mode!==mode)return fail(ack,'請選擇與預留小組相符的參與方式。');target.name=name;target.token=token(20);delete target.inviteCode;existing=target;save();}else{const eligible=r.groups.filter(g=>(g.mode||groupConfigs[g.id-1].mode)===mode).map(g=>({id:g.id,capacity:g.capacity||groupConfigs[g.id-1].capacity,count:Object.values(r.members).filter(m=>m.group===g.id).length})).filter(g=>g.count<g.capacity);if(!eligible.length)return fail(ack,mode==='online'?'線上組名額已滿（14 人）。':'現場組名額已滿（4 人）。');eligible.sort((a,b)=>a.count/a.capacity-b.count/b.capacity||a.id-b.id);const group=eligible[0].id;existing={id:token(7),token:token(20),name,group,mode};r.members[existing.id]=existing;save()}}s.data.room=code;s.data.token=existing.token;s.join(code);ack({ok:true,code,token:existing.token});sync(r)});
 responses(s,'room:resume',(p,ack)=>{const code=clean(p.code,20).toUpperCase(),r=rooms[code];if(!r||!role(r,p.token))return fail(ack,'無法恢復活動，請重新加入。');s.data.room=code;s.data.token=p.token;s.join(code);ack({ok:true});sync(r)});
 responses(s,'member:add',(p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const r=a.room,name=clean(p.name);const group=Number(p.group);if(!name)return fail(ack,'請輸入新人姓名或暱稱。');if(!Number.isInteger(group)||group<1||group>5)return fail(ack,'請選擇有效的小組。');const g=r.groups[group-1],count=Object.values(r.members).filter(m=>m.group===group).length;if(count>=g.capacity)return fail(ack,`第 ${group} 組名額已滿（${g.capacity} 人）。`);const mode=g.mode||groupConfigs[group-1].mode;let inviteCode;do{inviteCode=randomBytes(5).toString('hex').toUpperCase()}while(Object.values(r.members).some(m=>m.inviteCode===inviteCode));const m={id:token(7),token:null,inviteCode,name,group,mode};r.members[m.id]=m;save();ack({ok:true,inviteCode});sync(r)});
 responses(s,'member:remove',(p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const m=a.room.members[clean(p.memberId,40)];if(!m)return fail(ack,'找不到這位成員。');delete a.room.members[m.id];save();ack({ok:true});sync(a.room)});
 responses(s,'member:move',(p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const r=a.room,m=r.members[clean(p.memberId,40)],group=Number(p.group);if(!m)return fail(ack,'找不到這位成員。');if(!Number.isInteger(group)||group<1||group>5)return fail(ack,'無效的小組。');if(group===m.group)return ack({ok:true});const g=r.groups[group-1];if((g.mode||groupConfigs[group-1].mode)!==m.mode)return fail(ack,'線上及現場成員不可混組。');if(Object.values(r.members).filter(x=>x.group===group).length>=g.capacity)return fail(ack,'目標小組人數已滿。');m.group=group;save();ack({ok:true});sync(r)});
 responses(s,'card:draw',(_p,ack)=>{const a=authSocket(s,ack);if(!a)return;const {room:r,auth}=a;const group=Number(_p.group);if(!Number.isInteger(group)||group<1||group>5)return fail(ack,'小組不正確。');if(!auth.isHost&&auth.member.group!==group)return fail(ack,'僅能操作自己的小組。');const h=r.groups[group-1].history[r.stage];if(h.length>=10)return fail(ack,'本階段的十張卡牌已全部抽完。');const available=decks[r.stage].map((_,i)=>i).filter(i=>!h.includes(i));const next=available[randomBytes(4).readUInt32BE(0)%available.length];h.push(next);save();ack({ok:true});sync(r)});
 responses(s,'stage:set',(p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const stage=Number(p.stage);if(!Number.isInteger(stage)||stage<0||stage>2)return fail(ack,'階段無效。');a.room.stage=stage;save();ack({ok:true});sync(a.room)});
 responses(s,'timer:set',(p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const sec=Number(p.seconds);if(![60,75,120,150,180].includes(sec))return fail(ack,'時間設定無效。');a.room.timer={seconds:sec,endsAt:null};save();ack({ok:true});sync(a.room)});
 responses(s,'timer:start',(_p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const t=a.room.timer;t.endsAt=Date.now()+t.seconds*1000;save();ack({ok:true});sync(a.room)});
 responses(s,'timer:reset',(_p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;a.room.timer.endsAt=null;save();ack({ok:true});sync(a.room)});
 responses(s,'room:clear',(p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;if(p.confirm!==a.room.code)return fail(ack,'確認代碼不正確。');for(const g of a.room.groups)g.history=[[],[],[]];a.room.stage=0;a.room.timer={seconds:60,endsAt:null};save();ack({ok:true});sync(a.room)});
 responses(s,'room:export',(_p,ack)=>{const a=authSocket(s,ack,true);if(!a)return;const r=a.room;ack({ok:true,data:{code:r.code,createdAt:r.createdAt,stage:r.stage,groups:r.groups.map(g=>({id:g.id,mode:g.mode||groupConfigs[g.id-1].mode,capacity:g.capacity||groupConfigs[g.id-1].capacity,members:Object.values(r.members).filter(m=>m.group===g.id).map(m=>m.name),draws:g.history.map((h,i)=>h.map(n=>({stage:stageNames[i],card:n+1,question:decks[i][n]})))}))}})});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Icebreaker live listening on ${PORT}`));
