// bot.js
import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

import qrcode from 'qrcode-terminal';
import express from 'express';
import { existsSync } from 'fs';
import axios from 'axios';

const PORT = process.env.PORT || 3000;
const app = express();

const blockedNumbers = ['919876543210', '911234567890']; 
const userStates = new Map();
const userNames = new Map();
const signature = " - msg by Raelyaan";

// ===== Hugging Face =====
const HF_API_KEY = process.env.HF_API_KEY || "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";
const HF_MODEL = "mistralai/Mistral-7B-Instruct-v0.2";

// ===== Math Helpers =====
function isSimpleMathExpression(s) {
  return /^[0-9\s\.\+\-\*\/\^\(\)]+$/.test(s.trim());
}

function safeEvalMath(expr) {
  try {
    const sanitized = expr.replace(/\^/g, '**');
    if (!/^[0-9\s\.\+\-\*\/\(\)\*]{1,500}$/.test(sanitized)) return null;
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${sanitized})`)();
    if (typeof result === 'number' && Number.isFinite(result)) return result.toString();
    return null;
  } catch { return null; }
}

// ===== Hugging Face Reply Function =====
async function getAIReply(userName, userMessage) {
  // Custom dynamic answers
  const keyword = userMessage.toLowerCase();
  if (keyword.includes('raelyaan')) {
    return "Raelyaan is a trademark by Aadil Asif Badhra. It represents a brand/identity.";
  }

  if (isSimpleMathExpression(userMessage)) {
    const mathAns = safeEvalMath(userMessage);
    if (mathAns !== null) return `${userMessage.trim()} = ${mathAns}`;
  }

  const prompt = `You are a helpful AI assistant. A user named ${userName} asked: "${userMessage}". Provide a clear, accurate, and friendly answer.`;
  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      { inputs: prompt },
      { headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" }, timeout: 120000 }
    );

    let aiText = "";
    if (Array.isArray(response.data) && response.data.length > 0) {
      aiText = response.data[0]?.generated_text ?? "";
    } else if (response.data?.generated_text) {
      aiText = response.data.generated_text;
    } else aiText = JSON.stringify(response.data).slice(0,2000);

    return (aiText || "Sorry, I couldn't generate a reply.").trim();
  } catch (err) {
    console.error("HF error:", err.response?.data || err.message);
    return "Sorry, I couldn't process your message at the moment.";
  }
}

// ===== WhatsApp Bot =====
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  let qrTimeout = null;
  let qrScanned = false;

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("Scan this QR within 1 minute if not logged in:");
      qrcode.generate(qr, { small: true });
      qrScanned = false;

      if (qrTimeout) clearTimeout(qrTimeout);
      qrTimeout = setTimeout(() => {
        if (!qrScanned) {
          console.log("QR timeout. Using existing auth info if available...");
        }
      }, 60000); // 1 min
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
    const sender = (msg.key.remoteJid || '').replace('@s.whatsapp.net','');
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
      await sock.sendMessage(msg.key.remoteJid, { text: `Hello ${text}! You can now ask anything — math, science, general knowledge.${signature}` });
      return;
    }

    if (state === 1) {
      userStates.set(sender, 2);
      await sock.sendMessage(msg.key.remoteJid, { text: `Great! I'm ready to answer your questions, ${userNames.get(sender)}. Ask me anything.${signature}` });
      return;
    }

    if (state === 2) {
      const aiReply = await getAIReply(userNames.get(sender) || "User", text);
      await sock.sendMessage(msg.key.remoteJid, { text: `${aiReply}${signature}` });
      return;
    }
  });
}

// ===== Express Server =====
app.get('/', (req, res) => res.send('WhatsApp Q&A Bot running!'));

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  startBot().catch(err => { console.error(err); process.exit(1); });
});
