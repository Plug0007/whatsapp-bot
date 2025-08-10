import { makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@adiwajshing/baileys';
import fetch from 'node-fetch';

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

// Replace with your Gemini API key here
const GEMINI_API_KEY = 'AIzaSyDaQu5JTSL9Yf1EE_4lqJJwLdNL2RJWHwU';

async function queryGeminiAPI(prompt) {
  // Adjust the endpoint & request format according to Gemini API docs
  const url = 'https://gemini.googleapis.com/v1/chat/completions'; // example endpoint

  const body = {
    model: 'gemini-1',   // or your specific Gemini model name
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 150,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GEMINI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await response.json();

  // Adjust this based on the actual Gemini API response structure
  return data.choices?.[0]?.message?.content || 'Sorry, no response from Gemini API.';
}

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using WA version v${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Scan this QR code:\n', qr);
    }
    if(connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if(shouldReconnect) startBot();
    } else if(connection === 'open') {
      console.log('WhatsApp connected!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;  // ignore if from self

    // Ignore groups
    if(msg.key.remoteJid.endsWith('@g.us')) return;

    const sender = msg.key.remoteJid;
    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if(!messageText) return;

    console.log(`Received from ${sender}: ${messageText}`);

    try {
      const reply = await queryGeminiAPI(messageText);
      await sock.sendMessage(sender, { text: reply });
      console.log(`Replied: ${reply}`);
    } catch (error) {
      console.error('Gemini API error:', error);
      await sock.sendMessage(sender, { text: "Sorry, I can't process that right now." });
    }
  });
}

startBot();
