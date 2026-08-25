const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'meu_token_secreto_123';
let PAGE_TOKENS = {}; // { pageId: {id, name, token} }
let FLOWS = [];
let LOGS = [];

function addLog(msg, type = 'INFO') {
  const time = new Date().toLocaleTimeString('pt-BR');
  LOGS.unshift({ time, msg, type });
  if (LOGS.length > 100) LOGS.pop();
  console.log(`[${time}][${type}] ${msg}`);
}

// Serve arquivos estáticos
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// ===== WEBHOOK VERIFICATION =====
app.get('/webhook/facebook-page', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    addLog('Webhook verificado com sucesso', 'SUCESSO');
    return res.send(req.query['hub.challenge']);
  }
  addLog('Falha na verificação do webhook', 'ERRO');
  res.sendStatus(403);
});

// ===== WEBHOOK RECEBE COMENTÁRIOS =====
app.post('/webhook/facebook-page', async (req, res) => {
  res.sendStatus(200); // responde rápido
  try {
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (!value) return;

    addLog(`WEBHOOK: ${value.item} - ${value.verb} - ${value.message?.substring(0,100) || ''}`, 'WEBHOOK');

    if (value.item!== 'comment' || value.verb!== 'add') return;
    if (!value.comment_id) return;

    const pageData = PAGE_TOKENS[entry.id] || Object.values(PAGE_TOKENS)[0];
    const PAGE_TOKEN = pageData?.token || process.env.PAGE_ACCESS_TOKEN;

    if (!PAGE_TOKEN) {
      addLog('Sem PAGE_TOKEN - faça login em /auth/facebook', 'ERRO');
      return;
    }

    // Acha fluxo pela palavra-chave
    const commentText = (value.message || '').toLowerCase();
    let flow = null;

    if (FLOWS.length > 0) {
      flow = FLOWS.find(f => f.active && commentText.includes((f.trigger || '').toLowerCase()));
      if (!flow) flow = FLOWS.find(f => f.active);
    }

    // Fallback se não tem fluxo
    if (!flow) {
      flow = {
        name: 'Fallback',
        reply: 'Obrigado pelo comentário! Te mandei uma mensagem no privado 🔥',
        dm: 'Aqui está seu link: https://mariliaaustin.com'
      };
    }

    addLog(`Respondendo ${value.comment_id} com fluxo "${flow.name}" | Comentário: "${value.message}"`, 'SUCESSO');

    // Private Reply (resposta privada no comentário)
    const r = await axios.post(
      `https://graph.facebook.com/v26.0/${value.comment_id}/private_replies`,
      { message: flow.reply },
      { params: { access_token: PAGE_TOKEN } }
    );

    addLog(`private_replies enviado: ${JSON.stringify(r.data)}`, 'SUCESSO');

  } catch (e) {
    addLog(`ERRO private_replies: ${JSON.stringify(e.response?.data || e.message)}`, 'ERRO');
  }
});

// ===== API STATUS REAL =====
app.get('/api/status', (req, res) => {
  const pages = Object.values(PAGE_TOKENS).map(p => ({
    id: p.id,
    name: p.name,
    online: true
  }));
  res.json({
    pages,
    flows: FLOWS,
    connected: pages.length > 0,
    webhook: `${req.protocol}://${req.get('host')}/webhook/facebook-page`,
    hasToken:!!process.env.PAGE_ACCESS_TOKEN || pages.length > 0
  });
});

// ===== API LOGS REAIS =====
app.get('/api/logs', (req, res) => {
  res.json(LOGS);
});

// ===== API POSTS REAIS DA PÁGINA =====
app.get('/api/posts', async (req, res) => {
  try {
    const pageData = Object.values(PAGE_TOKENS)[0];
    const PAGE_TOKEN = pageData?.token || process.env.PAGE_ACCESS_TOKEN;
    const PAGE_ID = pageData?.id || '1035901842949830';

    if (!PAGE_TOKEN) {
      return res.json({ posts: [], error: 'Faça login em /auth/facebook primeiro' });
    }

    addLog(`Buscando posts da página ${PAGE_ID}`, 'INFO');

    const r = await axios.get(`https://graph.facebook.com/v26.0/${PAGE_ID}/posts`, {
      params: {
        access_token: PAGE_TOKEN,
        limit: 10,
        fields: 'id,message,created_time,permalink_url,full_picture,comments.summary(true)'
      }
    });

    res.json({ posts: r.data.data });
  } catch (e) {
    const err = e.response?.data || e.message;
    addLog(`Erro ao buscar posts: ${JSON.stringify(err)}`, 'ERRO');
    res.json({ posts: [], error: err });
  }
});

// ===== API FLUXOS =====
app.get('/api/flows', (req, res) => res.json(FLOWS));

app.post('/api/flows', (req, res) => {
  FLOWS = req.body;
  addLog(`Fluxos salvos: ${FLOWS.length} fluxos`, 'SUCESSO');
  res.json({ ok: true, count: FLOWS.length });
});

// ===== OAUTH IGUAL MANYCHAT =====
app.get('/auth/facebook', (req, res) => {
  if (!FB_APP_ID) return res.status(500).send('Configure FB_APP_ID e FB_APP_SECRET nas Variables do Railway');
  const scopes = 'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management';
  const url = `https://www.facebook.com/v26.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
  res.redirect(url);
});

app.get('/auth/facebook/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.send('Sem code retornado');

    const tokenRes = await axios.get('https://graph.facebook.com/v26.0/oauth/access_token', {
      params: {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code
      }
    });

    const userToken = tokenRes.data.access_token;
    const pagesRes = await axios.get('https://graph.facebook.com/v26.0/me/accounts', {
      params: { access_token: userToken }
    });

    for (const page of pagesRes.data.data) {
      PAGE_TOKENS[page.id] = { id: page.id, name: page.name, token: page.access_token };
      try {
        await axios.post(`https://graph.facebook.com/v26.0/${page.id}/subscribed_apps`, null, {
          params: { subscribed_fields: 'feed', access_token: page.access_token }
        });
        addLog(`✅ Conectado e inscrito na página ${page.name} (${page.id})`, 'SUCESSO');
      } catch (e) {
        addLog(`Erro ao inscrever ${page.name}: ${JSON.stringify(e.response?.data)}`, 'ERRO');
      }
    }

    res.send(`
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:Arial;text-align:center;padding:50px;background:#111;color:#fff">
          <h1>✅ Conectado!</h1>
          <p>${pagesRes.data.data.length} página(s) conectada(s): ${pagesRes.data.data.map(p=>p.name).join(', ')}</p>
          <p>Voltando pro painel...</p>
          <script>setTimeout(()=>window.location='/',1500)</script>
        </body>
      </html>
    `);
  } catch (e) {
    const err = e.response?.data || e.message;
    addLog(`Erro no OAuth: ${JSON.stringify(err)}`, 'ERRO');
    res.status(500).send(`<h1>Erro no login</h1><pre>${JSON.stringify(err, null, 2)}</pre><a href="/">Voltar</a>`);
  }
});

// Rota principal - tenta achar o index.html em qualquer lugar
app.get('/', (req, res) => {
  const paths = [
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'painel_real_facebook_agentic_artifact_3_311d38228c09.html')
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.send(`
    <h1>Bot Facebook Online</h1>
    <p>API funcionando. Acesse:</p>
    <ul>
      <li><a href="/auth/facebook">/auth/facebook - Logar</a></li>
      <li><a href="/api/status">/api/status - Status</a></li>
      <li><a href="/api/posts">/api/posts - Posts reais</a></li>
      <li><a href="/api/logs">/api/logs - Logs</a></li>
    </ul>
    <p>Suba um index.html na raiz ou em /public</p>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot REAL Online na porta ${PORT}`);
  addLog(`Servidor iniciado na porta ${PORT}`, 'SUCESSO');
});
