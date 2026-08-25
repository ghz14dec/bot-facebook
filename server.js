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

function addLog(m,t='INFO'){const h=new Date().toLocaleTimeString('pt-BR');LOGS.unshift({time:h,msg:m,type:t});if(LOGS.length>100)LOGS.pop();console.log(m);}
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname,'public')));

app.get('/webhook/facebook-page',(req,res)=>{ if(req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']); res.sendStatus(403); });

app.post('/webhook/facebook-page', async (req,res)=>{
  res.sendStatus(200);
  try{
    const e=req.body.entry?.[0]; const v=e?.changes?.[0]?.value;
    if(!v || v.item!=='comment' || v.verb!=='add') return;
    addLog(`Comentario: ${v.message}`,'WEBHOOK');
    const pd=PAGE_TOKENS[e.id]||Object.values(PAGE_TOKENS)[0];
    const tk=pd?.token||process.env.PAGE_ACCESS_TOKEN;
    if(!tk) return;
    const f=FLOWS.find(x=>x.active)||{reply:'Te enviei no privado!',dmText:'Seu link aqui',buttonUrl:'',buttonText:'Acessar'};

    // Checa se post está no fluxo
    if(f.postScope==='specific' && f.postIds?.length>0 && v.post_id){
      if(!f.postIds.includes(v.post_id)) return;
    }

    await axios.post(`https://graph.facebook.com/v26.0/${v.comment_id}/private_replies`,{message:f.reply},{params:{access_token:tk}});
    addLog('private_replies OK','SUCESSO');

    try{
      if(f.hasButton && f.buttonUrl){
        await axios.post(`https://graph.facebook.com/v26.0/me/messages`,{
          recipient:{comment_id:v.comment_id},
          message:{attachment:{type:"template",payload:{template_type:"button",text:f.dmText,buttons:[{type:"web_url",url:f.buttonUrl,title:(f.buttonText||'Acessar').substring(0,20)}]}}}
        },{params:{access_token:tk}});
      }else{
        await axios.post(`https://graph.facebook.com/v26.0/me/messages`,{
          recipient:{comment_id:v.comment_id},
          message:{text:f.dmText||'Seu link'}
        },{params:{access_token:tk}});
      }
    }catch(err){ addLog('DM falhou, mas private_replies foi','INFO'); }
  }catch(err){ addLog(JSON.stringify(err.response?.data||err.message),'ERRO'); }
});

app.get('/api/status',(req,res)=>{ res.json({pages:Object.values(PAGE_TOKENS).map(p=>({id:p.id,name:p.name,online:true})),flows:FLOWS,connected:Object.keys(PAGE_TOKENS).length>0}); });
app.get('/api/logs',(req,res)=>res.json(LOGS));
app.get('/api/posts',async(req,res)=>{
  try{
    const pd=Object.values(PAGE_TOKENS)[0]; const tk=pd?.token||process.env.PAGE_ACCESS_TOKEN; const pid=pd?.id||'1035901842949830';
    if(!tk) return res.json({posts:[]});
    const r=await axios.get(`https://graph.facebook.com/v26.0/${pid}/posts`,{params:{access_token:tk,limit:10,fields:'id,message,created_time,permalink_url,full_picture'}});
    res.json({posts:r.data.data});
  }catch(e){ res.json({posts:[],error:e.response?.data}); }
});
app.get('/api/flows',(req,res)=>res.json(FLOWS));
app.post('/api/flows',(req,res)=>{FLOWS=req.body; res.json({ok:true});});

app.get('/auth/facebook',(req,res)=>{
  const url=`https://www.facebook.com/v26.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management&response_type=code`;
  res.redirect(url);
});
app.get('/auth/facebook/callback',async(req,res)=>{
  try{
    const tr=await axios.get('https://graph.facebook.com/v26.0/oauth/access_token',{params:{client_id:process.env.FB_APP_ID,client_secret:process.env.FB_APP_SECRET,redirect_uri:process.env.REDIRECT_URI,code:req.query.code}});
    const pr=await axios.get('https://graph.facebook.com/v26.0/me/accounts',{params:{access_token:tr.data.access_token}});
    for(const p of pr.data.data){ PAGE_TOKENS[p.id]={id:p.id,name:p.name,token:p.access_token}; try{await axios.post(`https://graph.facebook.com/v26.0/${p.id}/subscribed_apps`,null,{params:{subscribed_fields:'feed',access_token:p.access_token}});}catch{} }
    res.send(`<script>location='/'</script>Conectado ${pr.data.data.length} paginas`);
  }catch(e){ res.send(`<pre>${JSON.stringify(e.response?.data||e.message,null,2)}</pre>`); }
});
app.get('/',(req,res)=>{
  if(fs.existsSync(path.join(__dirname,'public','index.html'))) return res.sendFile(path.join(__dirname,'public','index.html'));
  if(fs.existsSync(path.join(__dirname,'index.html'))) return res.sendFile(path.join(__dirname,'index.html'));
  res.send('OK - suba index.html');
});
app.listen(process.env.PORT||3000,()=>console.log('Online'));
