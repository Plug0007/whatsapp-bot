import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

import qrcode from 'qrcode-terminal';
import express from 'express';
import { existsSync, rmSync } from 'fs';

const PORT = process.env.PORT || 3000;
const app = express();

const blockedNumbers = ['919876543210', '911234567890'];

const knownUsers = new Set();

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

    let reply;
    if (!knownUsers.has(sender)) {
      knownUsers.add(sender);
      reply = `Hello ${sender}! Welcome to the WhatsApp bot. - msg by Raelyaan`;
    } else {
      reply = `Welcome back, ${sender}! How can I assist you today? - msg by Raelyaan`;
    }

    try {
      await sock.sendMessage(msg.key.remoteJid, { text: reply });
      console.log(`Replied to ${sender}: ${reply}`);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  });
}

app.get('/', (req, res) => res.send('WhatsApp Bot is running!'));

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  startBot();
});
