import express from 'express';
import tiktokApp from './tiktok.js';
import instagramApp from './instagram.js';
import spotifyApp from './spotify.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/tiktok', tiktokApp);
app.use('/api/instagram', instagramApp);
app.use('/api/spotify', spotifyApp);

app.get('/api/test', (req, res) => {
  res.json({ status: true, message: 'API is working' });
});

app.get('/', (req, res) => {
  res.json({
    status: true,
    message: 'Social Media Downloader API',
    platforms: ['tiktok', 'instagram', 'spotify']
  });
});

export default app;
