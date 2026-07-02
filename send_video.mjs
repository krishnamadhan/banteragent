import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/home/pi/banteragent/auth' }),
  puppeteer: {
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--headless']
  }
});

client.on('ready', async () => {
  console.log('Client ready, sending video...');
  const media = MessageMedia.fromFilePath('/home/pi/downloads/vibe_time_2min.mp4');
  await client.sendMessage('919487506127@c.us', media, { caption: 'Vibe Time — first 2 mins 🎬' });
  console.log('Sent!');
  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', () => { console.error('Auth failed'); process.exit(1); });
client.initialize();

setTimeout(() => { console.error('Timeout'); process.exit(1); }, 90000);
