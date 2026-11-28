import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from './db/client.js';
import { initSchema } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { authRouter } from './routes/authRoutes.js';
import { adminRouter } from './routes/adminRoutes.js';
import { scorecardRouter } from './routes/scorecardRoutes.js';
import { evaluationRouter } from './routes/evaluationRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import { attendanceRouter } from './routes/attendanceRoutes.js';

export async function createApp() {
  const db = await getDb();
  await initSchema(db);
  await seedIfEmpty(db);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'danh-gia-co-so-doan-tan-nhut', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/scorecards', scorecardRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', evaluationRouter);
  app.use('/api/reports', reportRouter);

  // Serve built frontend in production
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  const PORT = Number(process.env.PORT || 4100);
  const HOST = process.env.HOST || '0.0.0.0';
  createApp()
    .then((app) => {
      app.listen(PORT, HOST, () => {
        console.log(`[API] Phân hệ Đánh giá Cơ sở Đoàn – Tuổi trẻ Tân Nhựt running on http://${HOST}:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
