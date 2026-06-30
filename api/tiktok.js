import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const app = express();

class SaveTtClient {
  constructor() {
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({
      baseURL: "https://savett.cc",
      jar: this.jar,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Origin': 'https://savett.cc',
        'Referer': 'https://savett.cc/en1/download',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
      },
      timeout: 30000,
    }));
  }

  async getCsrfToken() {
    const { data } = await this.client.get('/en1/download');
    const match = data.match(/name="csrf_token" value="([^"]+)"/);
    if (!match) throw new Error("Failed to get CSRF token from SaveTt.");
    return match[1];
  }

  async downloadHtml(url, csrf) {
    const payload = `csrf_token=${encodeURIComponent(csrf)}&url=${encodeURIComponent(url)}`;
    const { data } = await this.client.post('/en1/download', payload);
    return data;
  }

  parseHtml(html) {
    const $ = cheerio.load(html);
    const stats = [];
    $('#video-info .my-1 span').each((_, el) => {
      stats.push($(el).text().trim());
    });

    const data = {
      username: $('#video-info h3').first().text().trim() || null,
      views: stats[0] || null,
      likes: stats[1] || null,
      bookmarks: stats[2] || null,
      comments: stats[3] || null,
      shares: stats[4] || null,
      duration: $('#video-info p.text-muted').first().text().replace(/Duration:/i, '').trim() || null,
      type: null,
      downloads: { nowm: [], wm: [] },
      mp3: [],
      slides: []
    };

    const slides = $('.carousel-item[data-data]');
    if (slides.length) {
      data.type = 'photo';
      slides.each((_, el) => {
        try {
          const rawData = $(el).attr('data-data');
          if (!rawData) return;
          const json = JSON.parse(rawData.replace(/&quot;/g, '"'));
          if (Array.isArray(json.URL)) {
            json.URL.forEach((url) => {
              data.slides.push({ index: data.slides.length + 1, url });
            });
          }
        } catch (e) {}
      });
      return data;
    }

    data.type = 'video';
    $('#formatselect option').each((_, el) => {
      const label = $(el).text().toLowerCase();
      const raw = $(el).attr('value');
      if (!raw) return;
      try {
        const json = JSON.parse(raw.replace(/&quot;/g, '"'));
        if (!json.URL) return;
        if (label.includes('mp4') && !label.includes('watermark')) {
          data.downloads.nowm.push(...json.URL);
        }
        if (label.includes('watermark')) {
          data.downloads.wm.push(...json.URL);
        }
        if (label.includes('mp3')) {
          data.mp3.push(...json.URL);
        }
      } catch (e) {}
    });
    return data;
  }

  async process(url) {
    try {
      const csrf = await this.getCsrfToken();
      const html = await this.downloadHtml(url, csrf);
      return this.parseHtml(html);
    } catch (e) {
      throw new Error(e.message || "Failed to process URL");
    }
  }
}

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, message: 'URL is required' });
  try {
    const client = new SaveTtClient();
    const result = await client.process(url);
    if (result.type === 'photo' && Array.isArray(result.slides)) {
      result.slides = result.slides.filter(slide => slide.url.includes('.jpeg') || slide.url.includes('.webp'));
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/download', async (req, res) => {
  const fileUrl = req.query.url;
  const type = req.query.type || 'video';
  if (!fileUrl) return res.status(400).send('Invalid media URL');
  try {
    const response = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    const filename = `tiktok_${Date.now()}`;
    let ext = type === 'mp3' ? '.mp3' : type === 'photo' ? '.jpeg' : '.mp4';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}${ext}"`);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Failed to download media file');
  }
});

export default app;