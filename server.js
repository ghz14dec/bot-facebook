
const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'meu_token_secreto_123';
let PAGE_TOKENS = {}; // { pageId: { token, name } }
let FLOWS = [
  { id: 1, name: 'Resposta padrão comentários', trigger: 'Qualquer comentário', reply: 'Te mandei no privado! Olha sua DM 🔥', dm: 'Aqui está seu link / cupom: https://seu-link.com', active: true }
];

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.get('/webhook/facebook-page', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook/facebook-page', async (req, res) => {
  console.log("WEBHOOK:", JSON.stringify(req.body).substring(0, 3000));
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (!value) return;
    if (value.item !== 'comment' || value.verb !== 'add') return;
    if (!value.comment_id) return;

    // pega token da pagina correspondente
    const pageId = entry.id;
    const pageData = PAGE_TOKENS[pageId] || Object.values(PAGE_TOKENS)[0];
    const PAGE_TOKEN = pageData?.token || process.env.PAGE_ACCESS_TOKEN;

    if (!PAGE_TOKEN) {
      console.log("SEM PAGE_TOKEN configurado");
      return;
    }

    // encontra fluxo ativo
    const flow = FLOWS.find(f => f.active) || FLOWS[0];
    console.log(`Respondendo ${value.comment_id} com fluxo ${flow.name}`);

    const r = await axios.post(`https://graph.facebook.com/v26.0/${value.comment_id}/private_replies`, {
      message: flow.reply
    }, { params: { access_token: PAGE_TOKEN } });
    console.log("private_replies SUCESSO:", r.data);

    // opcional: mandar DM extra se quiser - descomente se precisar
    // await axios.post(`https://graph.facebook.com/v26.0/me/messages`, {
    //   recipient: { comment_id: value.comment_id },
    //   message: { text: flow.dm }
    // }, { params: { access_token: PAGE_TOKEN } });

  } catch (e) {
    console.error("ERRO private_replies:", JSON.stringify(e.response?.data || e.message));
  }
});

// API para o painel
app.get('/api/status', (req,res)=>{
  const pages = Object.values(PAGE_TOKENS).map(p=>({ id: p.id, name: p.name, token: p.token.substring(0,20)+'...', online: true }));
  res.json({ pages, flows: FLOWS, connected: pages.length>0, webhook: `${req.protocol}://${req.get('host')}/webhook/facebook-page` });
});

app.post('/api/flows', (req,res)=>{
  FLOWS = req.body;
  console.log("Flows atualizados", FLOWS.length);
  res.json({ ok: true });
});

// OAuth igual Manychat
app.get('/auth/facebook', (req,res)=>{
  if(!FB_APP_ID) return res.send("Configure FB_APP_ID no Railway");
  const scopes = "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management";
  const url = `https://www.facebook.com/v26.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code&state=123`;
  res.redirect(url);
});

app.get('/auth/facebook/callback', async (req,res)=>{
  try{
    const code = req.query.code;
    const tokenRes = await axios.get(`https://graph.facebook.com/v26.0/oauth/access_token`,{
      params:{ client_id: FB_APP_ID, client_secret: FB_APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });
    const userToken = tokenRes.data.access_token;

    const pagesRes = await axios.get(`https://graph.facebook.com/v26.0/me/accounts`,{
      params:{ access_token: userToken }
    });

    for(const page of pagesRes.data.data){
      PAGE_TOKENS[page.id] = { id: page.id, name: page.name, token: page.access_token };
      // auto subscribe
      try{
        await axios.post(`https://graph.facebook.com/v26.0/${page.id}/subscribed_apps`, null, {
          params:{ subscribed_fields: 'feed', access_token: page.access_token }
        });
        console.log(`Inscrito na pagina ${page.name}`);
      }catch(e){ console.log("Erro subscribe", e.response?.data); }
    }

    res.send(`<html><body style="font-family:Arial;text-align:center;padding:50px"><h1>✅ Conectado!</h1><p>${pagesRes.data.data.length} página(s) conectada(s). Voltando pro painel...</p><script>setTimeout(()=>window.location='/',2000)</script></body></html>`);
  }catch(e){
    console.error(e.response?.data || e.message);
    res.status(500).send("<h1>Erro no login</h1><pre>"+JSON.stringify(e.response?.data || e.message, null, 2)+"</pre><a href='/'>Voltar</a>");
  }
});

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("Online na porta", PORT));
