import makeWASocket, { useSingleFileAuthState } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import fetch from "node-fetch";

const { state, saveState } = useSingleFileAuthState("./auth_info.json");

const GEMINI_API_KEY = "AIzaSyDaQu5JTSL9Yf1EE_4lqJJwLdNL2RJWHwU";

async function generateGeminiReply(prompt) {
  try {
    const response = await fetch("https://api.generativelanguage.google/v1beta2/models/chat-bison-001:generateMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: {
          text: prompt
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return "Sorry, I couldn't process that.";
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content || "Sorry, no reply generated.";
  } catch (err) {
    console.error("Error calling Gemini API:", err);
    return "Sorry, an error occurred.";
  }
}

async function startBot() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom && lastDisconnect?.error.output.statusCode !== 401);
      console.log("Connection closed. Reconnecting?", shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("WhatsApp connection established!");
    }
  });

  sock.ev.on("creds.update", saveState);

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;

    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      // Skip groups
      if (msg.key.remoteJid.endsWith("@g.us")) continue;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      if (!text) continue;

      console.log(`Received message: ${text}`);

      const replyText = await generateGeminiReply(text) + "\n\n- msg by Raelyaan";

      await sock.sendMessage(msg.key.remoteJid, { text: replyText });
      console.log(`Sent reply: ${replyText}`);
    }
  });
}

startBot();
