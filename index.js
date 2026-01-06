const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();

const ADMIN_USER = "admin";
const ADMIN_PASS = "supersecret123";

let announcement = {
  message: "",
  updatedAt: null
};

app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= ANNOUNCEMENT =================
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

// ================= SHARE SYSTEM =================
const total = new Map();
const timers = new Map();

app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index) => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
    startTime: link.startTime
  }));
  res.json(data);
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;

  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const cookies = await convertCookie(cookie);
    const id = await share(cookies, url, amount, interval);
    res.json({ status: 200, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= STOP =================
app.post('/api/stop', (req, res) => {
  timers.forEach((timer, key) => {
    clearInterval(timer);
    total.delete(key);
  });
  timers.clear();

  res.json({ status: 200, message: 'All sessions stopped' });
});

// ================= CORE SHARE =================
async function share(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);

  if (!id) {
    throw new Error("Invalid or private post URL");
  }

  amount = Number(amount);
  interval = Number(interval);

  total.set(id, {
    url,
    id,
    count: 0,
    target: amount,
    startTime: Date.now()
  });

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
    // ✅ STOP LANG KAPAG TAPOS NA
    if (sharedCount >= amount) {
      clearInterval(timers.get(id));
      timers.delete(id);
      total.delete(id);
      return;
    }

    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {},
        { headers }
      );

      if (response.status === 200) {
        sharedCount++;
        total.set(id, {
          ...total.get(id),
          count: sharedCount
        });
      }
    } catch (error) {
      console.log("Share failed, retrying...");
      // ❗ WALANG auto-stop dito
    }
  }

  const timer = setInterval(sharePost, interval);
  timers.set(id, timer);

  return id;
}

// ================= HELPERS =================
async function getPostID(url) {
  try {
    const response = await axios.post(
      'https://id.traodoisub.com/api.php',
      `link=${encodeURIComponent(url)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.id;
  } catch {
    return null;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'cookie': cookie,
      'referer': 'https://www.facebook.com/'
    };
    const response = await axios.get(
      'https://business.facebook.com/content_management',
      { headers }
    );
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);
    if (token) return token[1];
  } catch {}
  return null;
}

async function convertCookie(cookie) {
  try {
    const cookies = JSON.parse(cookie);
    const sb = cookies.find(c => c.key === "sb");
    if (!sb) throw new Error("Invalid appstate");

    return `sb=${sb.value}; ` +
      cookies.slice(1).map(c => `${c.key}=${c.value}`).join('; ');
  } catch {
    throw new Error("Invalid appstate format");
  }
}

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
