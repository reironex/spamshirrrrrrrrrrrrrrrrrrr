const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const ADMIN_USER = "admin";
const ADMIN_PASS = "supersecret123"; // palitan mo
let announcement = {
  message: "",
  updatedAt: null
};
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/announcement', (req, res) => {
  res.json(announcement);
});
app.post('/api/announcement', (req, res) => {
  const { username, password, message } = req.body;

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!message || message.trim() === "") {
    return res.status(400).json({ error: "Empty message" });
  }

  announcement = {
    message,
    updatedAt: Date.now()
  };

  res.json({ status: 200, message: "Announcement updated" });
});

const total = new Map();      // session info
const timers = new Map();     // para sa mga interval timer

app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index)  => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
  }));
  res.json(JSON.parse(JSON.stringify(data || [], null, 2)));
});

app.get('/', (res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  if (!cookie || !url || !amount || !interval) return res.status(400).json({
    error: 'Missing state, url, amount, or interval'
  });

  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({ status: 500, error: 'Invalid cookies' });
    };
    const id = await share(cookies, url, amount, interval);
    res.status(200).json({ status: 200, id });
  } catch (err) {
    return res.status(500).json({ status: 500, error: err.message || err });
  }
});

// ðŸ›‘ STOP API
app.post('/api/stop', (req, res) => {
  const { id } = req.body;

  if (id) {
    if (timers.has(id)) {
      clearInterval(timers.get(id));
      timers.delete(id);
      total.delete(id);
      return res.json({ status: 200, message: `Session ${id} tinigil na` });
    }
    return res.status(404).json({ error: 'Walang active session na may ganitong id' });
  }

  // Kung walang id, ihinto lahat ng session
  timers.forEach((timer, key) => {
    clearInterval(timer);
    total.delete(key);
  });
  timers.clear();
  return res.json({ status: 200, message: 'Lahat ng sessions tinigil na' });
});

async function share(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);
  if (!id) throw new Error("Unable to get link id: invalid URL, it's either a private post or visible to friends only");

  total.set(id, { url, id, count: 0, target: amount });

  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate',
    'connection': 'keep-alive',
    'content-length': '0',
    'cookie': cookies,
    'host': 'graph.facebook.com'
  };

  let sharedCount = 0;
  async function sharePost() {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {},
        { headers }
      );
      if (response.status === 200) {
        total.set(id, { ...total.get(id), count: total.get(id).count + 1 });
        sharedCount++;
      }
      if (sharedCount === amount) {
        clearInterval(timers.get(id));
        timers.delete(id);
      }
    } catch (error) {
      clearInterval(timers.get(id));
      timers.delete(id);
      total.delete(id);
    }
  }

  const timer = setInterval(sharePost, interval * 1000);
  timers.set(id, timer);

  // auto cleanup
  setTimeout(() => {
    if (timers.has(id)) {
      clearInterval(timers.get(id));
      timers.delete(id);
      total.delete(id);
    }
  }, amount * interval * 1000);

  return id;
}

async function getPostID(url) {
  try {
    const response = await axios.post('https://id.traodoisub.com/api.php', `link=${encodeURIComponent(url)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data.id;
  } catch {
    return;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'cookie': cookie,
      'referer': 'https://www.facebook.com/',
    };
    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);
    if (token && token[1]) return token[1];
  } catch {
    return;
  }
}

async function convertCookie(cookie) {
  return new Promise((resolve, reject) => {
    try {
      const cookies = JSON.parse(cookie);
      const sbCookie = cookies.find(cookies => cookies.key === "sb");
      if (!sbCookie) reject("Detect invalid appstate please provide a valid appstate");
      const sbValue = sbCookie.value;
      const data = `sb=${sbValue}; ${cookies.slice(1).map(cookies => `${cookies.key}=${cookies.value}`).join('; ')}`;
      resolve(data);
    } catch {
      reject("Error processing appstate please provide a valid appstate");
    }
  });
}

app.listen(5000);
