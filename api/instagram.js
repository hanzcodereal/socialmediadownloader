import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';
import CryptoJS from 'crypto-js';

const app = express();

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'hx-request': 'true',
  'hx-current-url': 'https://reelsvideo.io/',
  'hx-target': 'target',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Origin': 'https://reelsvideo.io',
  'Referer': 'https://reelsvideo.io/'
};

function generateTS() {
  return Math.floor(Date.now() / 1000);
}

function generateTT(ts) {
  return CryptoJS.MD5(ts + 'X-Fc-Pp-Ty-eZ').toString();
}

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ success: false, error: "URL parameter is required" });
  }
  try {
    const ts = generateTS();
    const tt = generateTT(ts);
    const body = new URLSearchParams();
    body.append('id', url);
    body.append('locale', 'en');
    body.append('cf-turnstile-response', '');
    body.append('tt', tt);
    body.append('ts', ts.toString());

    const response = await axios.post('https://reelsvideo.io/', body, { headers });
    const $ = cheerio.load(response.data);
    const username = $('.bg-white span.text-400-16-18').first().text().trim() || null;
    const thumb = $('div[data-bg]').first().attr('data-bg') || null;
    const videos = [];
    $('a.type_videos').each((i, el) => {
      const href = $(el).attr('href');
      if (href) videos.push(href);
    });
    const images = [];
    $('a.type_images').each((i, el) => {
      const href = $(el).attr('href');
      if (href) images.push(href);
    });
    const mp3 = [];
    $('a.type_audio').each((i, el) => {
      const href = $(el).attr('href');
      const id = $(el).attr('data-id');
      if (href && id) {
        mp3.push({ id, url: href });
      }
    });
    let type = 'unknown';
    if (videos.length && images.length) type = 'carousel';
    else if (videos.length) type = 'video';
    else if (images.length) type = 'photo';
    return res.json({
      success: true,
      data: { type, username, thumb, videos, images, mp3 }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
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
        'Referer': 'https://www.instagram.com/'
      }
    });
    const filename = `instagram_${Date.now()}`;
    let ext = '.mp4';
    if (type === 'mp3') ext = '.mp3';
    if (type === 'photo') ext = '.jpeg';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}${ext}"`);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Failed to download media file');
  }
});

export default app;