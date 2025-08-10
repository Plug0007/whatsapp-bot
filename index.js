import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

import qrcode from 'qrcode-terminal';
import express from 'express';
import { existsSync, rmSync } from 'fs';
import axios from 'axios';

const PORT = process.env.PORT || 3000;
const app = express();

const blockedNumbers = ['919876543210', '911234567890'];

const userStates = new Map();  // 0 = ask name, 1 = got name ask concern, 2 = ongoing concerns
const userNames = new Map();

const signature = " - msg by Raelyaan";

const OPENAI_API_KEY = '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';  // <-- Put your key here

async function getAIReply(userName, userMessage) {
  const prompt = `You are a helpful assistant chatting with a user named ${userName}. Respond kindly and helpfully to this message: "${userMessage}"`;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.7,
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    const aiText = response.data.choices[0].message.content.trim();
    return aiText;

  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    return "Sorry, I couldn't process your message at the moment.";
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('Scan this QR code with your WhatsApp to authenticate.');
    }
    if (connection === 'close') {
      if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('Connection closed, reconnecting...');
        startBot();
      } else {
        console.log('Logged out. Removing auth folder...');
        if (existsSync('./auth_info')) rmSync('./auth_info', { recursive: true, force: true });
      }
    }
    if (connection === 'open') {
      console.log('WhatsApp connection established!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid.replace('@s.whatsapp.net', '');

    if (blockedNumbers.includes(sender)) {
      console.log(`Blocked message from ${sender}`);
      return;
    }

    let text = '';
    if (msg.message.conversation) {
      text = msg.message.conversation;
    } else if (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) {
      text = msg.message.extendedTextMessage.text;
    } else {
      // Ignore other message types
      return;
    }

    if (!userStates.has(sender)) {
      userStates.set(sender, 0);
      await sock.sendMessage(msg.key.remoteJid, { text: `Hello! What's your name?${signature}` });
      console.log(`Asked name from ${sender}`);
      return;
    }

    const state = userStates.get(sender);

    if (state === 0) {
      userNames.set(sender, text.trim());
      userStates.set(sender, 1);
      await sock.sendMessage(msg.key.remoteJid, { text: `Hello ${text.trim()}! Owner will reply ASAP. Please drop your concern now.${signature}` });
      console.log(`Got name from ${sender}: ${text.trim()}`);
      return;
    }

    if (state === 1) {
      userStates.set(sender, 2);
      await sock.sendMessage(msg.key.remoteJid, { text: `Thank you for your concern, ${userNames.get(sender)}. Owner will get back to you soon.${signature}` });
      console.log(`Received first concern from ${sender}: ${text.trim()}`);
      return;
    }

    if (state === 2) {
      // For ongoing messages, get AI reply
      const userName = userNames.get(sender);
      const aiReply = await getAIReply(userName, text);
      const replyWithSignature = `${aiReply}${signature}`;

      await sock.sendMessage(msg.key.remoteJid, { text: replyWithSignature });
      console.log(`AI replied to ${sender}: ${aiReply}`);
      return;
    }
  });
}

app.get('/', (req, res) => res.send('WhatsApp Bot is running!'));

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  startBot();
});
