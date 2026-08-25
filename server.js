const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'meu_token_secreto_123';
let PAGE_TOKENS = {};
let FLOWS = [];
let LOGS = [];
function addLog(m,t='INFO'){const h=new Date().toLocaleTimeString('pt-BR');LOGS.unshift({time:h,msg:m,type:t});if(LOGS.length>150)LOGS.pop();console.log(m);}
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname,'public')));
app.get('/webhook/facebook-page',(req,res)=>{if(req.query['hub.verify_token']===VERIFY_TOKEN)return res.send(req.query['hub.challenge']);res.sendStatus(403);});
app.post('/webhook/facebook-page', async (req,res)=>{
  res.sendStatus(200);
  try{
    const entry=req.body.entry?.[0];const value=entry?.changes?.[0]?.value;
    if(!value||value.item!=='comment'||value.verb!=='add'||!value.comment_id)return;
    addLog(`WEBHOOK: ${value.post_id} | ${value.message}`,'WEBHOOK');
    const pd=PAGE_TOKENS[entry.id]||Object.values(PAGE_TOKENS)[0];
    const tk=pd?.token||process.env.PAGE_ACCESS_TOKEN;
    if(!tk)return;
    const txt=(value.message||'').toLowerCase();
    let flow=null;
    for(const f of FLOWS){
      if(!f.active)continue;
      if(f.postScope==='specific'&&f.postIds?.length>0&&value.post_id&&!f.postIds.includes(value.post_id))continue;
      if(!f.trigger||f.triggerMode==='any'){flow=f;break;}
      const keys=f.trigger.toLowerCase().split(',').map(s=>s.trim());
      if(keys.some(k=>txt.includes(k))){flow=f;break;}
    }
    if(!flow)flow=FLOWS.find(f=>f.active);
    if(!flow)flow={reply:'Te enviei no privado! 🔥',dmText:'Aqui seu acesso:',hasButton:true,buttonText:'ACESSAR',buttonUrl:'https://mariliaaustin.com'};
    await axios.post(`https://graph.facebook.com/v26.0/${value.comment_id}/private_replies`,{message:flow.reply},{params:{access_token:tk}});
    addLog('Private Reply OK','SUCESSO');
    if(flow.hasButton&&flow.buttonUrl){
      await axios.post(`https://graph.facebook.com/v26.0/me/messages`,{recipient:{comment_id:value.comment_id},message:{attachment:{type:"template",payload:{template_type:"button",text:flow.dmText,buttons:[{type:"web_url",url:flow.buttonUrl,title:(flow.buttonText||'Acessar').substring(0,20)}]}}}},{params:{access_token:tk}});
    }else{
      await axios.post(`https://graph.facebook.com/v26.0/me/messages`,{recipient:{comment_id:value.comment_id},message:{text:flow.dmText}},{params:{access_token:tk}});
    }
    addLog('DM com botão OK','SUCESSO');
  }catch(e){addLog(JSON.stringify(e.response?.data||e.message),'ERRO');}
});
app.get('/api/status',(req,res)=>{res.json({pages:Object.values(PAGE_TOKENS).map(p=>({id:p.id,name:p.name})),flows:FLOWS,connected:Object.keys(PAGE_TOKENS).length>0,webhook:`${req.protocol}://${req.get('host')}/webhook/facebook-page`,verify:VERIFY_TOKEN});});
app.get('/api/logs',(req,res)=>res.json(LOGS));
app.get('/api/flows',(req,res)=>res.json(FLOWS));
app.post('/api/flows',(req,res)=>{FLOWS=req.body;addLog('Fluxos salvos','SUCESSO');res.json({ok:true});});
app.get('/api/posts',async(req,res)=>{try{const pd=Object.values(PAGE_TOKENS)[0];const tk=pd?.token||process.env.PAGE_ACCESS_TOKEN;const pid=pd?.id||'1035901842949830';if(!tk)return res.json({posts:[]});const r=await axios.get(`https://graph.facebook.com/v26.0/${pid}/posts`,{params:{access_token:tk,limit:12,fields:'id,message,permalink_url,full_picture'}});res.json({posts:r.data.data});}catch(e){res.json({posts:[]});}});
app.get('/auth/facebook',(req,res)=>{res.redirect(`https://www.facebook.com/v26.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management&response_type=code&auth_type=rerequest`);});
app.get('/auth/facebook/callback',async(req,res)=>{
  try{
    const tr=await axios.get('https://graph.facebook.com/v26.0/oauth/access_token',{params:{client_id:process.env.FB_APP_ID,client_secret:process.env.FB_APP_SECRET,redirect_uri:process.env.REDIRECT_URI,code:req.query.code}});
    let long=tr.data.access_token;
    try{const ll=await axios.get('https://graph.facebook.com/v26.0/oauth/access_token',{params:{grant_type:'fb_exchange_token',client_id:process.env.FB_APP_ID,client_secret:process.env.FB_APP_SECRET,fb_exchange_token:tr.data.access_token}});long=ll.data.access_token;}catch{}
    const pr=await axios.get('https://graph.facebook.com/v26.0/me/accounts',{params:{access_token:long}});
    for(const p of pr.data.data){PAGE_TOKENS[p.id]={id:p.id,name:p.name,token:p.access_token};try{await axios.post(`https://graph.facebook.com/v26.0/${p.id}/subscribed_apps`,null,{params:{subscribed_fields:'feed',access_token:p.access_token}});}catch{}}
    if(FLOWS.length===0){FLOWS=[{id:Date.now(),name:'Cupom BLACK - Post Viral',trigger:'quero,link,cupom,black,quero cupom',triggerMode:'keywords',postScope:'all',postIds:[],reply:'Te enviei o cupom no privado! Olha sua DM 🔥',dmText:'🔥 Seu cupom BLACK20 tá aqui! Clique abaixo:',hasButton:true,buttonText:'PEGAR CUPOM',buttonUrl:'https://mariliaaustin.com',active:true}];}
    res.send(`<html><body style="background:#0a0a0f;color:#fff;text-align:center;padding:50px;font-family:Arial"><h1>✅ TUDO CONFIGURADO!</h1><p>${pr.data.data.length} página(s) conectada(s)</p><p>Webhook ativo + Fluxo com botão criado</p><a href="/" style="background:#1877f2;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;display:inline-block;margin-top:20px">IR PARA O PAINEL</a><script>setTimeout(()=>location='/',2000)</script></body></html>`);
  }catch(e){res.send(`<pre>${JSON.stringify(e.response?.data||e.message,null,2)}</pre>`);}
});
app.get('/',(req,res)=>{if(fs.existsSync(path.join(__dirname,'public','index.html')))return res.sendFile(path.join(__dirname,'public','index.html'));if(fs.existsSync(path.join(__dirname,'index.html')))return res.sendFile(path.join(__dirname,'index.html'));res.send('suba index.html');});
app.listen(process.env.PORT||3000,()=>console.log('FINAL 100%'));
