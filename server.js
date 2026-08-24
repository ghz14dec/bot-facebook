const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = "meu_token_secreto_123"; // tem que ser igual do Facebook
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.get('/webhook/facebook-page', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook/facebook-page', async (req, res) => {
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  if (change?.field === 'feed' && change?.value?.item === 'comment') {
    const comment_id = change.value.comment_id;
    const from_id = change.value.from?.id;

    // Aqui é seu fluxo ÚNICO
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${comment_id}/private_replies`, {
        message: "Te mandei no privado! Olha sua DM 🔥"
      }, { params: { access_token: PAGE_TOKEN } });

      await axios.post(`https://graph.facebook.com/v20.0/me/messages`, {
        recipient: { comment_id: comment_id },
        message: { text: "Aqui está seu link / cupom:..." }
      }, { params: { access_token: PAGE_TOKEN } });

      console.log("DM enviada pra:", from_id);
    } catch(e){ console.log(e.response?.data) }
  }
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log("Online"));