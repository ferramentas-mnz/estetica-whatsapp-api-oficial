import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID!;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN!;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;

// Rota raiz
app.get('/', (req, res ) => {
  res.json({
    status: 'online',
    service: 'WhatsApp CRM Server - API Oficial',
    connected: true,
    provider: 'Meta WhatsApp Business API',
    endpoints: {
      webhook: '/webhook',
      sendMessage: '/send-message',
      status: '/status'
    }
  });
});

// Webhook - Verificação (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook não verificado!');
    res.sendStatus(403);
  }
});

// Webhook - Receber mensagens (POST)
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field === 'messages') {
            const value = change.value;

            if (value.messages) {
              for (const message of value.messages) {
                const phoneNumber = message.from;
                const messageText = message.text?.body || '';
                const whatsappId = message.id;
                const timestamp = new Date(parseInt(message.timestamp) * 1000).toISOString();

                console.log(`📩 Nova mensagem de ${phoneNumber}: ${messageText}`);

                // Salvar no Supabase
                const { error } = await supabase.rpc('process_whatsapp_message', {
                  p_phone_number: `${phoneNumber}@s.whatsapp.net`,
                  p_content: messageText,
                  p_whatsapp_id: whatsappId,
                  p_sender: 'customer',
                  p_message_type: 'text',
                  p_timestamp: timestamp,
                });

                if (error) {
                  console.error('❌ Erro ao salvar mensagem:', error);
                } else {
                  console.log('✅ Mensagem salva no banco!');
                }
              }
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.sendStatus(500);
  }
});

// Enviar mensagem
app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone e message são obrigatórios' });
    }

    // Remover caracteres especiais e adicionar código do país se necessário
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }

    // Enviar via API do WhatsApp
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: {
          body: message
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Mensagem enviada:', response.data);

    // Salvar no Supabase
    const { error } = await supabase.rpc('process_whatsapp_message', {
      p_phone_number: `${cleanPhone}@s.whatsapp.net`,
      p_content: message,
      p_whatsapp_id: response.data.messages[0].id,
      p_sender: 'clinic',
      p_message_type: 'text',
      p_timestamp: new Date().toISOString(),
    });

    if (error) {
      console.error('❌ Erro ao salvar mensagem enviada:', error);
    }

    res.json({ 
      success: true, 
      message: 'Mensagem enviada com sucesso!',
      whatsapp_message_id: response.data.messages[0].id
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar mensagem:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Erro ao enviar mensagem',
      details: error.response?.data || error.message
    });
  }
});

// Status
app.get('/status', (req, res) => {
  res.json({
    connected: true,
    provider: 'Meta WhatsApp Business API',
    phone_id: WHATSAPP_PHONE_ID,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`✅ WhatsApp API Oficial conectada!`);
  console.log(`📱 Phone ID: ${WHATSAPP_PHONE_ID}`);
});
