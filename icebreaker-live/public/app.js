'use strict';
const $=id=>document.getElementById(id);
const socket=io({reconnection:true});
let state=null, deckData=null, viewedGroup=1, session=null;
const storageKey='icebreaker-live-session-v1';
try{session=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
const colors=['#547fba','#328d7b','#dc9251'];
const en=['GETTING TO KNOW YOU','SPEAK CLEARLY','LISTEN & RESPOND'];
const hints=['分享特質與故事，認識小組成員。','先說結論，再補充理由與例子，最後歸納。','先摘要重點，確認理解，再延伸提問。'];
const guides=[['第一階段｜認識彼此','14 分鐘。每人 2 分 30 秒：抽卡思考 15 秒、分享 60 秒、組員提問 30 秒、回答 30 秒、換人 15 秒；最後小組自由交流 4 分鐘。'],['第二階段｜說得清楚','16 分鐘。每人 3 分鐘：抽卡 15 秒、表達 75 秒、提問 30 秒、補充 30 秒、回饋 30 秒；最後組內討論 4 分鐘。'],['第三階段｜聽懂與回應','15 分鐘。四輪各 3 分鐘：抽卡 15 秒、分享 60 秒、傾聽者摘要 30 秒、提問 20 秒、回答 25 秒、觀察回饋 30 秒；最後討論 3 分鐘。']];
let popupHandle;
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';clearTimeout(popupHandle);popupHandle=setTimeout(()=>$('toast').style.display='none',3200)}
function action(event,payload={},success=()=>{}){if(!socket.connected)return toast('網路連線中斷，請等待重新連線。');socket.timeout(7000).emit(event,payload,(err,res)=>{if(err)return toast('連線逾時，請再試一次。');if(!res?.ok)return toast(res?.error||'操作失敗');success(res)});}
function link(code){return `${location.origin}/?room=${encodeURIComponent(code)}`}
const params=new URLSearchParams(location.search);
if(params.get('room'))$('joinCode').value=params.get('room').toUpperCase();
fetch('/api/decks').then(r=>r.json()).then(data=>{deckData=data;render()}).catch(()=>toast('題庫載入失敗，請重新整理網頁。'));
socket.on('connect',()=>{$('connection').textContent='● 已連線，即時同步中';$('connection').classList.remove('offline');if(session?.code&&session?.token){action('room:resume',session,()=>{})}});
socket.on('disconnect',()=>{$('connection').textContent='● 連線中斷，正在重新連線';$('connection').classList.add('offline')});
socket.on('room:state',data=>{const wasHost=state?.isHost;state=data;if(!state.isHost&&state.myGroup)viewedGroup=state.myGroup;render()});
socket.on('session:invalid',()=>{state=null;session=null;localStorage.removeItem(storageKey);render();toast('活動登入已失效')});
$('createForm').addEventListener('submit',e=>{e.preventDefault();action('room:create',{name:$('hostName').value},res=>{session={code:res.code,token:res.token};localStorage.setItem(storageKey,JSON.stringify(session));history.replaceState(null,'',`/?room=${encodeURIComponent(res.code)}`);toast('活動已建立！請複製新人加入連結。')})});
$('joinForm').addEventListener('submit',e=>{e.preventDefault();action('room:join',{code:$('joinCode').value,name:$('joinName').value,token:session?.code===$('joinCode').value.toUpperCase()?session.token:null},res=>{session={code:res.code,token:res.token};localStorage.setItem(storageKey,JSON.stringify(session));history.replaceState(null,'',`/?room=${encodeURIComponent(res.code)}`);toast('成功加入活動')})});
$('draw').onclick=()=>action('card:draw',{group:viewedGroup});
$('timerStart').onclick=()=>action('timer:start');
$('timerReset').onclick=()=>action('timer:reset');
$('copyInvite').onclick=async()=>{try{await navigator.clipboard.writeText(link(state.code));toast('已複製新人加入連結')}catch{window.prompt('複製以下連結：',link(state.code))}};
$('leave').onclick=()=>{if(!confirm('確定離開此裝置的活動畫面？你的入組名額仍會保留。'))return;localStorage.removeItem(storageKey);session=null;state=null;socket.disconnect();socket.connect();history.replaceState(null,'','/');render()};
$('export').onclick=()=>action('room:export',{},res=>{const blob=new Blob([JSON.stringify(res.data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`icebreaker-${state.code}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)});
$('clear').onclick=()=>{const input=prompt(`這將清空全部小組的抽卡紀錄（不會移除成員）。請輸入活動代碼 ${state.code} 確認：`);if(input===null)return;action('room:clear',{confirm:input.toUpperCase()},()=>toast('已重置抽卡進度'))};
function render(){if(!state){$('gate').classList.remove('hidden');$('app').classList.add('hidden');return} $('gate').classList.add('hidden');$('app').classList.remove('hidden');
 $('roomTitle').textContent=`活動代碼 ${state.code}`;$('myRole').textContent=state.isHost?'講師控制台｜可切換階段、控制所有小組與倒數計時':`新人參與者｜第 ${state.myGroup} 組（每組最多 4 人）`;
 $('hostTools').classList.toggle('hidden',!state.isHost);$('groupHelp').textContent=state.isHost?'可檢視並操作五個小組的卡牌；抽卡會同步到組員裝置。':'你只能抽取自己小組的卡牌；講師統一切換活動階段。';
 const stage=state.stage;$('stageBadge').textContent=`第 ${stage+1} 階段`;document.documentElement.style.setProperty('--accent',colors[stage]);
 $('stageTabs').replaceChildren();state.stageNames.forEach((name,i)=>{const b=document.createElement('button');b.className='tab'+(stage===i?' active':'');b.textContent=`0${i+1} ${name}`;b.disabled=!state.isHost;b.title=state.isHost?'點擊切換所有人的階段':'只有講師可以切換階段';b.onclick=()=>action('stage:set',{stage:i});$('stageTabs').appendChild(b)});
 $('groupButtons').replaceChildren();state.groups.forEach(g=>{const b=document.createElement('button');b.className='group-btn'+(viewedGroup===g.id?' current':'');b.textContent=`${g.id} 組 ${g.members.length}/4`;b.disabled=!state.isHost;b.onclick=()=>{viewedGroup=g.id;render()};$('groupButtons').appendChild(b)});
 const g=state.groups[viewedGroup-1];const h=g.history[stage];const last=g.current;$('cardEn').textContent=en[stage];$('cardNo').textContent=last===null?'CARD —':`CARD ${String(last+1).padStart(2,'0')}`;
 $('question').textContent=last===null?'按下「抽一張卡」開始交流':deckData?.decks?.[stage]?.[last]||'題庫載入中……';$('cardHint').textContent=hints[stage];
 $('draw').disabled=h.length>=10||!deckData;$('draw').textContent=h.length>=10?'本階段卡牌已抽完':'✦ 抽一張卡';$('drawInfo').textContent=h.length?'本組卡牌由所有組員共用':'請由一名組員負責抽卡';
 $('progressLabel').textContent=`本階段已抽 ${h.length} / 10 張`;$('groupLabel').textContent=`第 ${viewedGroup} 組`;$('progressBar').style.width=`${h.length*10}%`;
 $('guide').replaceChildren();const strong=document.createElement('strong');strong.textContent=guides[stage][0];const p=document.createElement('p');p.textContent=guides[stage][1];$('guide').append(strong,p);
 $('timePresets').replaceChildren();[60,75,120,150,180].forEach(sec=>{const b=document.createElement('button');b.textContent=sec<120?`${sec} 秒`:sec===120?'2 分鐘':sec===150?'2 分 30 秒':'3 分鐘';b.className=state.timer.seconds===sec?'active':'';b.disabled=!state.isHost;b.onclick=()=>action('timer:set',{seconds:sec});$('timePresets').appendChild(b)});
 $('timerStart').disabled=!state.isHost;$('timerReset').disabled=!state.isHost;$('timerNote').textContent=state.isHost?'講師統一操作，所有參與者同步看到倒數。':'倒數由講師統一控制，自動同步至本裝置。';
 $('people').replaceChildren();state.groups.forEach(g=>{const d=document.createElement('div');d.className='people-group';const title=document.createElement('strong');title.textContent=`第 ${g.id} 組 · ${g.members.length}/4 人`;const members=document.createElement('span');members.textContent=g.members.length?g.members.map(x=>x.name).join('、'):'尚無成員';d.append(title,members);$('people').appendChild(d)});updateTimer()}
function updateTimer(){if(!state)return;const t=state.timer;const remain=t.endsAt===null?t.seconds:Math.max(0,Math.ceil((t.endsAt-Date.now())/1000));$('timer').textContent=`${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;$('timer').classList.toggle('warning',remain<=10&&t.endsAt!==null);$('timerStart').textContent=t.endsAt!==null&&remain>0?'重新開始':'開始倒數'}
setInterval(updateTimer,250);
