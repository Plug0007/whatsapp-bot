import pkg from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import qrcode from 'qrcode-terminal';
import express from 'express';
import { existsSync } from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;
const HF_API_KEY = process.env.HF_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const googleAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const blockedNumbers = [];
const userStates = new Map();
const userNames = new Map();
const userConversations = new Map();
const signature = " - msg by Raelyaan";

const specialKeywords = {
  "raelyaan": "The word 'Raelyaan' is a trademark by Aadil Asif Badhra. It cannot be used without permission."
};

async function getAIReply(userName, userMessage, context = []) {
  for (const keyword in specialKeywords) {
    if (userMessage.toLowerCase().includes(keyword.toLowerCase())) {
      return specialKeywords[keyword];
    }
  }

  const fullPrompt = `
You are a friendly, intelligent assistant talking to ${userName}.
Previous conversation context:
${context.map((m, i) => `User: ${m.user}\nBot: ${m.bot}`).join('\n')}
Current question: "${userMessage}"
Provide a clear, accurate, and friendly answer.
`;

  try {
    const response = await googleAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      config: {
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    });

    return response.text.trim() || "Sorry, I couldn't generate a reply.";
  } catch (err) {
    console.error("Gemini API error:", err.response?.data || err.message);
    return "Sorry, I couldn't process your message at the moment.";
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);

  let qrTimeout = null;
  let qrScanned = false;

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("Scan QR within 1 minute:");
      qrcode.generate(qr, { small: true });
      qrScanned = false;

      if (qrTimeout) clearTimeout(qrTimeout);
      qrTimeout = setTimeout(() => {
        if (!qrScanned) console.log("QR timeout. Using existing auth info if available...");
      }, 60000);
    }

    if (connection === 'open') {
      qrScanned = true;
      console.log('WhatsApp connected!');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('Connection lost, reconnecting...');
        setTimeout(() => startBot().catch(console.error), 2000);
      } else {
        console.log('Logged out. Delete auth_info to re-scan QR manually.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;
    const sender = (msg.key.remoteJid || '').replace('@s.whatsapp.net', '');
    if (blockedNumbers.includes(sender)) return;

    let text = '';
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else return;
    text = text.trim();

    if (!userStates.has(sender)) {
      userStates.set(sender, 0);
      await sock.sendMessage(msg.key.remoteJid, { text: `Hello! What's your name?${signature}` });
      return;
    }

    const state = userStates.get(sender);
    if (state === 0) {
      userNames.set(sender, text);
      userStates.set(sender, 1);
      await sock.sendMessage(msg.key.remoteJid, { text: `Hello ${text}! You can now ask anything dynamically.${signature}` });
      return;
    }

    if (state === 1) {
      userStates.set(sender, 2);
      await sock.sendMessage(msg.key.remoteJid, { text: `Great! I'm ready to answer your questions, ${userNames.get(sender)}. Ask me anything.${signature}` });
      return;
    }

    if (state === 2) {
      const name = userNames.get(sender) || "User";
      const context = userConversations.get(sender) || [];

      const aiReply = await getAIReply(name, text, context);

      context.push({ user: text, bot: aiReply });
      if (context.length > 5) context.shift();
      userConversations.set(sender, context);

      await sock.sendMessage(msg.key.remoteJid, { text: `${aiReply}${signature}` });
    }
  });
}

app.get('/', (req, res) => res.send('WhatsApp Gemini-like Bot with branded keyword handling running!'));

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  startBot().catch(err => { console.error(err); process.exit(1); });
});
