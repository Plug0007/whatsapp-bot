import makeWASocket, { useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import fetch from 'node-fetch';

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

async function queryPaLM(prompt) {
  const API_KEY = 'AIzaSyDaQu5JTSL9Yf1EE_4lqJJwLdNL2RJWHwU'; // Replace with your Gemini API key
  const url = `https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText?key=${API_KEY}`;

  const body = {
    prompt: { text: prompt },
    temperature: 0.7,
    maxOutputTokens: 256,
  };

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`PaLM API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data?.candidates?.[0]?.output || 'Sorry, I did not get that.';
}

async function startBot() {
  const [version] = await fetchLatestBaileysVersion();
  console.log(`Using Baileys version: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Scan the QR code above with your WhatsApp mobile app');
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting?', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return; // Ignore own messages or empty

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const messageType = Object.keys(msg.message)[0];
    const sender = msg.key.participant || from;

    // Extract text message
    let text = '';
    if (messageType === 'conversation') {
      text = msg.message.conversation;
    } else if (messageType === 'extendedTextMessage') {
      text = msg.message.extendedTextMessage.text;
    } else {
      return; // Ignore other message types for simplicity
    }

    // Check if bot is mentioned in group or message is private
    const botNumber = sock.user.id.split(':')[0];
    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const isMentioned = mentionedJid.includes(botNumber + '@s.whatsapp.net');

    if (isGroup && !isMentioned) {
      // Don't reply if group message but not mentioned
      return;
    }

    // Clean the text removing mention (if any)
    if (isMentioned) {
      const mentionRegex = new RegExp(`@${botNumber}`, 'g');
      text = text.replace(mentionRegex, '').trim();
    }

    console.log(`Message from ${isGroup ? 'Group' : 'Private'} ${from}: ${text}`);

    try {
      const replyText = await queryPaLM(text);

      await sock.sendMessage(from, { text: replyText }, { quoted: msg });
      console.log(`Replied to ${from}`);
    } catch (err) {
      console.error('Error replying:', err);
    }
  });
}

startBot().catch(console.error);
