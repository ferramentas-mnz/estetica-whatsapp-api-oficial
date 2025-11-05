import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configurações
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID!;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'meu_token_secreto_12345';
const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}`;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey );

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'WhatsApp CRM Server - API Oficial',
    connected: true,
    provider: 'Meta WhatsApp Business API',
    phone_id: WHATSAPP_PHONE_ID,
    endpoints: {
      webhook: '/webhook',
      status: '/status',
      sendMessage: '/send-message'
    },
    timestamp: new Date().toISOString()
  });
});

// Webhook GET - Verificação do Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('📞 Verificação de webhook recebida');
  console.log('Mode:', mode);
  console.log('Token recebido:', token);
  console.log('Token esperado:', WEBHOOK_VERIFY_TOKEN);

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Falha na verificação do webhook');
    res.sendStatus(403);
  }
});

// Webhook POST - Receber mensagens
app.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Webhook recebido:', JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages.length > 0) {
      for (const message of messages) {
        const from = message.from;
        const messageBody = message.text?.body || '';
        const messageId = message.id;
        const timestamp = message.timestamp;

        console.log(`📱 Mensagem recebida de ${from}: ${messageBody}`);

        // Salvar no Supabase
        const { error } = await supabase.rpc('process_whatsapp_message', {
          p_phone_number: `${from}@s.whatsapp.net`,
          p_content: messageBody,
          p_whatsapp_id: messageId,
          p_sender: 'customer',
          p_message_type: 'text',
          p_timestamp: new Date(parseInt(timestamp) * 1000).toISOString()
        });

        if (error) {
          console.error('❌ Erro ao salvar mensagem:', error);
        } else {
          console.log('✅ Mensagem salva no banco de dados');
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

    // Remover caracteres especiais e garantir formato correto
    const cleanPhone = phone.replace(/\D/g, '');

    console.log(`📤 Enviando mensagem para ${cleanPhone}...`);

    const response = await axios.post(
      `${WHATSAPP_API_URL}/messages`,
      {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Resposta da API WhatsApp:', JSON.stringify(response.data, null, 2));

    // Validar resposta antes de acessar
    if (!response.data || !response.data.messages || !response.data.messages[0]) {
      console.error('❌ Resposta da API inválida:', response.data);
      return res.status(500).json({
        error: 'Resposta inválida da API do WhatsApp',
        details: response.data
      });
    }

    const messageId = response.data.messages[0].id;
    console.log('✅ Mensagem enviada com ID:', messageId);

    // Salvar no Supabase
    const { error } = await supabase.rpc('process_whatsapp_message', {
      p_phone_number: `${cleanPhone}@s.whatsapp.net`,
      p_content: message,
      p_whatsapp_id: messageId,
      p_sender: 'clinic',
      p_message_type: 'text',
      p_timestamp: new Date().toISOString()
    });

    if (error) {
      console.error('❌ Erro ao salvar mensagem enviada:', error);
    } else {
      console.log('✅ Mensagem salva no banco de dados');
    }

    res.json({ 
      success: true, 
      message: 'Mensagem enviada com sucesso!',
      whatsapp_message_id: messageId
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar mensagem:', error.response?.data || error.message);
    
    // Log detalhado do erro
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    
    res.status(500).json({ 
      error: 'Erro ao enviar mensagem',
      details: error.response?.data || error.message,
      status: error.response?.status
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
  console.log(`🔐 Webhook Verify Token: ${WEBHOOK_VERIFY_TOKEN}`);
});
