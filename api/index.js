import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import CryptoJS from 'crypto-js';
import yt from '@vreden/youtube_scraper';
import crypto from 'crypto';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE_YOUTUBE = "https://youtubedl.siputzx.my.id";
const APIKEY = null;

function solvePow(challenge, difficulty) {
  let nonce = 0;
  const prefix = "0".repeat(Number(difficulty));

  while (true) {
    const hash = crypto
      .createHash("sha256")
      .update(challenge + nonce.toString())
      .digest("hex");

    if (hash.startsWith(prefix)) {
      return nonce.toString();
    }

    nonce++;

    if (nonce > 10000000) {
      throw new Error("PoW solving timeout");
    }
  }
}

function createClient() {
  const jar = new CookieJar();

  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 60000,
      validateStatus: () => true,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
        Origin: BASE_YOUTUBE,
        Referer: `${BASE_YOUTUBE}/`,
        "X-Request-Id": crypto.randomUUID()
      }
    })
  );
}

function normalizeType(type) {
  return type === "audio" || type === "mp3" ? "audio" : "merge";
}

async function downloadWithExternalAPI(type, url, apikey = null) {
  const client = createClient();
  const downloadType = normalizeType(type);

  if (!apikey) {
    const challengeRes = await client.post(`${BASE_YOUTUBE}/akumaudownload`, {
      url,
      type: downloadType
    });

    if (challengeRes.status !== 200) {
      throw new Error(`Challenge ${downloadType} gagal HTTP ${challengeRes.status}`);
    }

    const { challenge, difficulty } = challengeRes.data || {};

    if (!challenge || !difficulty) {
      throw new Error(`Challenge ${downloadType} tidak ditemukan`);
    }

    const nonce = solvePow(challenge, difficulty);

    const verifyRes = await client.post(`${BASE_YOUTUBE}/cekpunyaku`, {
      url,
      type: downloadType,
      nonce
    });

    if (verifyRes.status !== 200) {
      throw new Error(`Verify ${downloadType} gagal HTTP ${verifyRes.status}`);
    }
  }

  for (let attempts = 0; attempts < 30; attempts++) {
    const downloadRes = await client.get(`${BASE_YOUTUBE}/download`, {
      params: {
        url,
        type: downloadType,
        apikey
      }
    });

    const data = downloadRes.data || {};

    if (data.status === "completed" && data.fileUrl) {
      return `${BASE_YOUTUBE}${data.fileUrl}`;
    }

    if (data.status === "failed") {
      throw new Error(data.error || `Download ${downloadType} failed`);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error(`Download ${downloadType} timeout`);
}

function getYoutubeId(url) {
  return (
    url.match(/youtu\.be\/([^?&/]+)/)?.[1] ||
    url.match(/[?&]v=([^?&]+)/)?.[1] ||
    url.match(/shorts\/([^?&/]+)/)?.[1] ||
    null
  );
}

function cleanMetadata(metadata = {}, inputUrl = null) {
  const thumbnails = Array.isArray(metadata?.thumbnails)
    ? metadata.thumbnails
    : [];

  const bestThumbnail =
    thumbnails.find(v => v.quality === "maxres")?.url ||
    thumbnails.find(v => v.quality === "standard")?.url ||
    thumbnails.find(v => v.quality === "high")?.url ||
    thumbnails.at(-1)?.url ||
    metadata?.thumbnail ||
    metadata?.image ||
    metadata?.thumb ||
    null;

  const id = metadata?.id || metadata?.videoId || getYoutubeId(inputUrl);

  return {
    title: metadata?.title || null,
    author:
      metadata?.author?.name ||
      metadata?.author ||
      metadata?.channel_title ||
      metadata?.channel ||
      null,
    views:
      metadata?.statistics?.view
        ? Number(metadata.statistics.view)
        : metadata?.views || metadata?.viewCount || null,
    thumbnail: bestThumbnail,
    url:
      metadata?.url ||
      metadata?.videoUrl ||
      (id ? `https://youtube.com/watch?v=${id}` : inputUrl)
  };
}

async function getMetadata(url) {
  try {
    const data = await yt.metadata(url);
    return cleanMetadata(data, url);
  } catch {
    return cleanMetadata({}, url);
  }
}

async function scrapeYouTube(url) {
  try {
    if (!url) {
      throw new Error("URL kosong");
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;

    if (!youtubeRegex.test(url)) {
      throw new Error("URL YouTube tidak valid");
    }

    const [metadata, urlVideo, urlAudio] = await Promise.all([
      getMetadata(url),
      downloadWithExternalAPI("video", url, APIKEY),
      downloadWithExternalAPI("mp3", url, APIKEY)
    ]);

    const download = {};
    const allFormats = [];

    if (urlVideo) {
      download.video = [urlVideo];
      allFormats.push({
        type: 'video',
        format: 'mp4',
        quality: '720p'
      });
    }

    if (urlAudio) {
      download.audio = urlAudio;
      allFormats.push({
        type: 'audio',
        format: 'mp3',
        quality: '128kbps'
      });
    }

    if (metadata?.thumbnail) {
      download.thumb = metadata.thumbnail;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {
            playCount: metadata?.views || 0,
            likeCount: 0
          },
          title: metadata?.title || 'YouTube Video',
          description: metadata?.author || '',
        },
        download: download,
        allFormats: allFormats
      }
    };
  } catch (error) {
    return { error: "youtube.fetch.fail", message: error.message };
  }
}

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

    if (!match) throw new Error("Gagal mengambil CSRF token dari SaveTt.");
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
      duration: $('#video-info p.text-muted')
        .first()
        .text()
        .replace(/Duration:/i, '')
        .trim() || null,
      type: null,
      downloads: {
        nowm: [],
        wm: []
      },
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
              data.slides.push({
                index: data.slides.length + 1,
                url
              });
            });
          }
        } catch (e) { }
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
      } catch (e) { }
    });

    return data;
  }

  async process(url) {
    try {
      const csrf = await this.getCsrfToken();
      const html = await this.downloadHtml(url, csrf);
      return this.parseHtml(html);
    } catch (e) {
      throw new Error(e.message || "Gagal memproses URL");
    }
  }
}

async function scrapeTikTok(url) {
  try {
    const client = new SaveTtClient();
    const result = await client.process(url);

    if (result.type === 'photo' && Array.isArray(result.slides)) {
      result.slides = result.slides.filter(slide => slide.url.includes('.jpeg') || slide.url.includes('.webp'));
    }

    const download = {};
    const allFormats = [];

    if (result.type === 'video') {
      if (result.downloads.nowm && result.downloads.nowm.length > 0) {
        download.video = result.downloads.nowm;
        allFormats.push({
          type: 'video',
          format: 'mp4',
          quality: 'No Watermark'
        });
      }
      if (result.downloads.wm && result.downloads.wm.length > 0) {
        if (!download.video) download.video = [];
        download.video.push(...result.downloads.wm);
        allFormats.push({
          type: 'video',
          format: 'mp4',
          quality: 'With Watermark'
        });
      }
      if (result.mp3 && result.mp3.length > 0) {
        download.audio = result.mp3[0];
        allFormats.push({
          type: 'audio',
          format: 'mp3',
          quality: '128kbps'
        });
      }
    } else if (result.type === 'photo') {
      if (result.slides && result.slides.length > 0) {
        download.photo = result.slides.map(s => s.url);
        allFormats.push({
          type: 'photo',
          format: 'jpeg',
          quality: 'HD'
        });
      }
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {
            playCount: parseInt(result.views) || 0,
            likeCount: parseInt(result.likes) || 0
          },
          title: result.username || 'TikTok Video',
          description: result.username || '',
          duration: result.duration,
          comments: result.comments,
          shares: result.shares,
          bookmarks: result.bookmarks
        },
        download: download,
        allFormats: allFormats
      }
    };
  } catch (error) {
    return { error: "tiktok.fetch.fail", message: error.message };
  }
}

async function scrapeInstagram(url) {
  try {
    const ts = Math.floor(Date.now() / 1000);
    const tt = CryptoJS.MD5(ts + 'X-Fc-Pp-Ty-eZ').toString();

    const body = new URLSearchParams();
    body.append('id', url);
    body.append('locale', 'en');
    body.append('cf-turnstile-response', '');
    body.append('tt', tt);
    body.append('ts', ts.toString());

    const response = await axios.post('https://reelsvideo.io/', body, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'hx-request': 'true',
        'hx-current-url': 'https://reelsvideo.io/',
        'hx-target': 'target',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://reelsvideo.io',
        'Referer': 'https://reelsvideo.io/'
      }
    });

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

    const download = {};
    if (videos.length > 0) download.video = videos;
    if (images.length > 0) download.photo = images;
    if (mp3.length > 0) download.audio = mp3[0].url;
    if (thumb) download.thumb = thumb;

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: username || 'Instagram Post',
          description: '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "instagram.fetch.fail", message: error.message };
  }
}

async function scrapeFacebook(url) {
  try {
    const encodedUrl = encodeURIComponent(url);
    const formData = `url=${encodedUrl}&lang=en&type=redirect`;

    const response = await axios.post("https://getvidfb.com/", formData, {
      headers: {
        'authority': 'getvidfb.com',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'max-age=0',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://getvidfb.com',
        'referer': 'https://getvidfb.com/',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);

    const videoContainer = $('#snaptik-video');
    if (!videoContainer.length) {
      throw new Error("Video container not found");
    }

    const thumb = videoContainer.find('.snaptik-left img').attr('src');
    const title = videoContainer.find('.snaptik-middle h3').text().trim();

    const videoLinks = [];
    const audioLinks = [];

    videoContainer.find('.abuttons a').each((_, el) => {
      const link = $(el).attr('href');
      const spanText = $(el).find('.span-icon span').last().text().trim();

      if (link && spanText && link.startsWith('http')) {
        if (spanText.includes('Mp3') || spanText.includes('Audio')) {
          audioLinks.push(link);
        } else {
          videoLinks.push(link);
        }
      }
    });

    const download = {};
    if (videoLinks.length > 0) download.video = videoLinks;
    if (audioLinks.length > 0) download.audio = audioLinks[0];
    if (thumb) download.thumb = thumb;

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: title || 'Facebook Video',
          description: '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "facebook.fetch.fail", message: error.message };
  }
}

async function scrapeTwitter(url) {
  try {
    const { data: html } = await axios.get("https://snaptwitter.com/");
    const $tok = cheerio.load(html);
    const tokenValue = $tok('input[name="token"]').attr("value");

    const formData = new URLSearchParams();
    formData.append("url", url);
    formData.append("token", tokenValue || "");

    const response = await axios.post("https://snaptwitter.com/action.php", formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const $ = cheerio.load(response.data.data);

    const imgUrl = $(".videotikmate-left img").attr("src");
    const downloadLink = $(".abuttons a").attr("href");
    const videoTitle = $(".videotikmate-middle h1").text().trim();

    const download = {};
    if (downloadLink) {
      download.video = [downloadLink];
    }
    if (imgUrl) {
      download.thumb = imgUrl;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: videoTitle || 'Twitter Video',
          description: '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "twitter.fetch.fail", message: error.message };
  }
}

async function scrapeSpotify(url) {
  try {
    const res = await axios.get('https://spotmate.online/en1', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(res.data);
    const token = $('meta[name="csrf-token"]').attr('content');
    const cookies = res.headers['set-cookie'] || [];
    const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

    const session = { token, cookieStr };

    const trackRes = await axios.post('https://spotmate.online/getTrackData',
      { spotify_url: url },
      {
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': session.token,
          'cookie': session.cookieStr,
          'origin': 'https://spotmate.online',
          'referer': 'https://spotmate.online/en1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
        }
      }
    );

    const trackInfo = trackRes.data;

    if (!trackInfo || trackInfo.status === 'error') {
      throw new Error('Failed to get track info');
    }

    const convertRes = await axios.post('https://spotmate.online/convert',
      { urls: url },
      {
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': session.token,
          'cookie': session.cookieStr,
          'origin': 'https://spotmate.online',
          'referer': 'https://spotmate.online/en1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
        }
      }
    );

    const convertInfo = convertRes.data;
    const image = trackInfo.album?.images?.[0]?.url || '';

    let downloadUrl = null;

    if (convertInfo.error === false && convertInfo.url) {
      downloadUrl = convertInfo.url;
    } else {
      const taskid = convertInfo.task_id || convertInfo.taskid;
      if (taskid) {
        let taskResult;
        let attempts = 0;
        do {
          await new Promise(r => setTimeout(r, 3000));
          const taskRes = await axios.get(`https://spotmate.online/tasks/${taskid}`, {
            headers: {
              'x-csrf-token': session.token,
              'cookie': session.cookieStr,
              'origin': 'https://spotmate.online',
              'referer': 'https://spotmate.online/en1',
              'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
            }
          });
          taskResult = taskRes.data;
          attempts++;
        } while (attempts < 10 && taskResult && (taskResult.status === 'pending' || taskResult.status === 'processing'));

        if (taskResult && taskResult.url) {
          downloadUrl = taskResult.url;
        }
      }
    }

    const download = {};
    if (downloadUrl) {
      download.audio = downloadUrl;
    }
    if (image) {
      download.thumb = image;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: trackInfo.name || 'Spotify Track',
          description: trackInfo.artists?.[0]?.name || '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "spotify.fetch.fail", message: error.message };
  }
}

app.post('/api/tiktok', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeTikTok(url);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/youtube', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeYouTube(url);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/instagram', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeInstagram(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/facebook', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeFacebook(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/twitter', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeTwitter(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spotify', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeSpotify(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const { url, type } = req.query;
    if (!url) {
      return res.status(400).send('URL konten tidak valid');
    }

    const response = await axios({
      url: url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });

    const filename = `media_${Date.now()}`;
    let ext = '.mp4';
    if (type === 'mp3') ext = '.mp3';
    if (type === 'photo') ext = '.jpeg';

    res.setHeader('Content-Disposition', `attachment; filename="${filename}${ext}"`);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Gagal mengunduh file media');
  }
});

app.get('/api/platforms', (req, res) => {
  res.json({
    platforms: ['tiktok', 'youtube', 'instagram', 'facebook', 'twitter', 'spotify']
  });
});

export default app;