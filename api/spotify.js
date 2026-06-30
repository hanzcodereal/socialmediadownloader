import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';

const app = express();

async function getsession() {
  const res = await axios.get('https://spotmate.online/en1', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    }
  });
  const $ = cheerio.load(res.data);
  const token = $('meta[name="csrf-token"]').attr('content');
  const cookies = res.headers['set-cookie'] || [];
  return {
    token,
    cookieStr: cookies.map(c => c.split(';')[0]).join('; ')
  };
}

async function trackdata(url, session) {
  const res = await axios.post('https://spotmate.online/getTrackData',
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
  return res.data;
}

async function convert(trackurl, session) {
  const res = await axios.post('https://spotmate.online/convert',
    { urls: trackurl },
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
  return res.data;
}

async function cektask(taskid, session) {
  const res = await axios.get(`https://spotmate.online/tasks/${taskid}`,
    {
      headers: {
        'x-csrf-token': session.token,
        'cookie': session.cookieStr,
        'origin': 'https://spotmate.online',
        'referer': 'https://spotmate.online/en1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
      }
    }
  );
  return res.data;
}

async function spotmate(url) {
  const session = await getsession();
  const trackInfo = await trackdata(url, session);
  if (!trackInfo || trackInfo.status === 'error') {
    throw new Error('Failed to get track information');
  }
  const convertInfo = await convert(url, session);
  const image = trackInfo.album?.images?.[0]?.url || '';
  if (convertInfo.error === false && convertInfo.url) {
    return {
      title: trackInfo.name,
      artist: trackInfo.artists?.[0]?.name,
      image: image,
      download_url: convertInfo.url
    };
  }
  const taskid = convertInfo.task_id || convertInfo.taskid;
  if (!taskid) {
    throw new Error(convertInfo.status || convertInfo.message || 'Failed to start conversion');
  }
  let taskResult;
  do {
    await new Promise(r => setTimeout(r, 3000));
    taskResult = await cektask(taskid, session);
  } while (taskResult && (taskResult.status === 'pending' || taskResult.status === 'processing'));
  return {
    title: trackInfo.name,
    artist: trackInfo.artists?.[0]?.name,
    image: image,
    download_url: taskResult.url
  };
}

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ success: false, message: 'URL is required' });
  }
  try {
    const data = await spotmate(url);
    res.json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'System error occurred' });
  }
});

app.get('/download', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) {
    return res.status(400).send('Invalid media URL');
  }
  try {
    const response = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        'Referer': 'https://spotmate.online/',
        'Accept': '*/*'
      }
    });
    const filename = `spotify_track_${Date.now()}.mp3`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Failed to download audio file from target server');
  }
});

export default app;