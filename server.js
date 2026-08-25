const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'meu_token_secreto_123';
let PAGE_TOKENS = {};
let FLOWS = [{ id: 1, name: 'Resposta padrão', trigger: 'Qualquer comentário', reply: 'Te mandei no privado! Olha sua DM 🔥', dm: 'Aqui está seu link: https://seu-link.com', active: true }];

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/webhook/facebook-page', (req,res)=>{
  if(req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook/facebook-page', async (req,res)=>{
  console.log("WEBHOOK:", JSON.stringify(req.body).substring(0,3000));
  res.sendStatus(200);
  try{
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if(!value || value.item!=='comment' || value.verb!=='add') return;
    const pageData = PAGE_TOKENS[entry.id] || Object.values(PAGE_TOKENS)[0];
    const PAGE_TOKEN = pageData?.token || process.env.PAGE_ACCESS_TOKEN;
    if(!PAGE_TOKEN) return;
    const flow = FLOWS.find(f=>f.active) || FLOWS[0];
    await axios.post(`https://graph.facebook.com/v26.0/${value.comment_id}/private_replies`,{message: flow.reply},{params:{access_token: PAGE_TOKEN}});
    console.log("SUCESSO private_replies");
  }catch(e){ console.error("ERRO:", e.response?.data || e.message); }
});

app.get('/api/status',(req,res)=>{
  const pages = Object.values(PAGE_TOKENS).map(p=>({id:p.id,name:p.name,online:true}));
  res.json({pages,flows:FLOWS,connected:pages.length>0, webhook: `${req.protocol}://${req.get('host')}/webhook/facebook-page`});
});

app.post('/api/flows',(req,res)=>{ FLOWS=req.body; res.json({ok:true}); });

app.get('/auth/facebook',(req,res)=>{
  if(!FB_APP_ID) return res.send("Configure FB_APP_ID no Railway");
  const url = `https://www.facebook.com/v26.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management&response_type=code`;
  res.redirect(url);
});

app.get('/auth/facebook/callback', async (req,res)=>{
  try{
    const code = req.query.code;
    const tokenRes = await axios.get(`https://graph.facebook.com/v26.0/oauth/access_token`,{params:{client_id:FB_APP_ID,client_secret:FB_APP_SECRET,redirect_uri:REDIRECT_URI,code}});
    const userToken = tokenRes.data.access_token;
    const pagesRes = await axios.get(`https://graph.facebook.com/v26.0/me/accounts`,{params:{access_token:userToken}});
    for(const page of pagesRes.data.data){
      PAGE_TOKENS[page.id]={id:page.id,name:page.name,token:page.access_token};
      try{ await axios.post(`https://graph.facebook.com/v26.0/${page.id}/subscribed_apps`,null,{params:{subscribed_fields:'feed',access_token:page.access_token}}); }catch(e){}
    }
    res.send(`<html><body style="font-family:Arial;text-align:center;padding:50px"><h1>✅ Conectado!</h1><p>${pagesRes.data.data.length} página(s). Voltando...</p><script>setTimeout(()=>window.location='/',1500)</script></body></html>`);
  }catch(e){ res.status(500).send("<pre>"+JSON.stringify(e.response?.data||e.message,null,2)+"</pre>"); }
});

app.get('/',(req,res)=>{
  const p1 = path.join(__dirname,'public','index.html');
  const p2 = path.join(__dirname,'index.html');
  if(fs.existsSync(p1)) return res.sendFile(p1);
  if(fs.existsSync(p2)) return res.sendFile(p2);
  res.send("Painel não encontrado - suba index.html");
});

app.listen(process.env.PORT||3000,()=>console.log("Online"));
