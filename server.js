const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.get('/webhook/facebook-page', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook/facebook-page', async (req, res) => {
  console.log("=== WEBHOOK CHEGOU ===", JSON.stringify(req.body).substring(0, 3000));

  // Responde 200 imediatamente pra Meta não reenviar
  res.sendStatus(200);

  try {
    const change = req.body.entry?.[0]?.changes?.[0];
    const value = change?.value;

    if (!value || value.item!== 'comment' || value.verb!== 'add') {
      console.log("Não é comentário novo, ignorando");
      return;
    }

    // Ignora comentário da própria página
    if (value.from?.id === value.post_id?.split('_')[0]) {
      console.log("Comentário da própria página, ignorando");
      return;
    }

    const comment_id = value.comment_id;
    console.log(`Tentando responder comentário: ${comment_id} - ${value.message}`);

    const r = await axios.post(`https://graph.facebook.com/v26.0/${comment_id}/private_replies`, {
      message: "Te mandei no privado! Olha sua DM 🔥"
    }, { params: { access_token: PAGE_TOKEN } });

    console.log("SUCESSO private_replies:", r.data);

  } catch(e){
    console.error("ERRO AO RESPONDER:", JSON.stringify(e.response?.data || e.message));
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Online"));
