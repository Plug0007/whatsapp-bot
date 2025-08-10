import pkg from '@whiskeysockets/baileys';
import P from 'pino';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const {
  default: makeWASocket,
  useSingleFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = pkg;

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = process.env.GEMINI_API_URL;

async function getGeminiResponse(prompt) {
  try {
    const res = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GEMINI_API_KEY}`
      },
      body: JSON.stringify({
        prompt: prompt,
        max_tokens: 150
      })
    });
    const data = await res.json();
    return data.reply || 'Sorry, I could not understand that.';
  } catch (err) {
    console.error('Gemini API error:', err);
    return 'Sorry, I am having trouble right now.';
  }
}

async function startSock() {
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Scan this QR code:\n', qr);
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startSock();
      } else {
        console.log('Logged out. Please delete auth_info.json and restart.');
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp');
    }
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (!text) return;

    // Reply only in private chats, ignore groups
    if (!sender.endsWith('@s.whatsapp.net')) return;

    console.log(`Message from ${sender}: ${text}`);

    const aiReply = await getGeminiResponse(text);

    const replyText = `${aiReply}\n\n- msg by Raelyaan`;

    await sock.sendMessage(sender, { text: replyText });
  });
}

startSock();
