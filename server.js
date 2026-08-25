// ADICIONA ESSA FUNÇÃO DE BOTÃO NO SEU SERVER.JS
async function sendDMWithButton(comment_id, pageToken, flow) {
  if (!flow.hasButton || !flow.buttonUrl) {
    // Só texto
    return axios.post(`https://graph.facebook.com/v26.0/me/messages`, {
      recipient: { comment_id },
      message: { text: flow.dmText }
    }, { params: { access_token: pageToken } });
  }

  // Com botão
  return axios.post(`https://graph.facebook.com/v26.0/me/messages`, {
    recipient: { comment_id },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: flow.dmText,
          buttons: [
            {
              type: "web_url",
              url: flow.buttonUrl,
              title: flow.buttonText.substring(0, 20)
            }
          ]
        }
      }
    }
  }, { params: { access_token: pageToken } });
}

// E DENTRO DO WEBHOOK, DEPOIS DO private_replies, ADICIONA:
if (value.post_id && flow.postScope === 'specific' && flow.postIds?.length > 0) {
  if (!flow.postIds.includes(value.post_id)) {
    addLog(`Comentário ignorado - post ${value.post_id} não está no fluxo ${flow.name}`, 'INFO');
    return;
  }
}

// Depois do private_replies:
try {
  await sendDMWithButton(value.comment_id, PAGE_TOKEN, flow);
  addLog(`DM com botão enviada`, 'SUCESSO');
} catch(e) {
  // fallback texto se botão falhar
  await axios.post(`https://graph.facebook.com/v26.0/me/messages`, {
    recipient: { comment_id: value.comment_id },
    message: { text: `${flow.dmText}\n\n${flow.buttonUrl}` }
  }, { params: { access_token: PAGE_TOKEN } });
}
