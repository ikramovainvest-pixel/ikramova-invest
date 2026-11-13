import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { calculateFreightEstimate } from './src/utils/freightMath.ts';
import type { FreightEstimateInput, InquiryPayload } from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');

interface StoredInquiry extends InquiryPayload {
  referenceId: string;
  submittedAt: string;
}

const memoryInquiries: StoredInquiry[] = [];

function persistInquiry(record: StoredInquiry) {
  memoryInquiries.push(record);
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    let existing: StoredInquiry[] = [];
    if (fs.existsSync(INQUIRIES_FILE)) {
      const raw = fs.readFileSync(INQUIRIES_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        existing = parsed;
      }
    }
    existing.push(record);
    fs.writeFileSync(INQUIRIES_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  } catch {
    // Keep memory store active if disk is ephemeral/read-only
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ikramova-invest' });
  });

  app.post('/api/freight-estimate', (req, res) => {
    const body = req.body as Partial<FreightEstimateInput>;
    const validOrigins = ['china', 'turkey', 'europe', 'vietnam', 'bangladesh'];
    const validModes = ['sea_lcl', 'container_20', 'container_40hc', 'air'];

    if (!body.origin || !validOrigins.includes(body.origin)) {
      res.status(400).json({ error: 'Invalid origin hub' });
      return;
    }
    if (!body.mode || !validModes.includes(body.mode)) {
      res.status(400).json({ error: 'Invalid freight mode' });
      return;
    }

    const result = calculateFreightEstimate({
      origin: body.origin,
      mode: body.mode,
      volumeCbm: Number(body.volumeCbm) || 1,
      weightKg: Number(body.weightKg) || 100,
      goodsType: String(body.goodsType ?? '').slice(0, 120),
      includeInspection: Boolean(body.includeInspection),
    });

    res.json(result);
  });

  app.post('/api/inquiries', (req, res) => {
    const body = req.body as Partial<InquiryPayload>;
    const fullName = String(body.fullName ?? '').trim();
    const email = String(body.email ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const message = String(body.message ?? '').trim();

    if (fullName.length < 2) {
      res.status(400).json({ error: 'Full name is required' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email address is required' });
      return;
    }
    if (message.length < 5) {
      res.status(400).json({ error: 'Please provide inquiry or quote details' });
      return;
    }

    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const referenceId = `IKR-2026-${randomCode}`;
    const submittedAt = new Date().toISOString();

    const record: StoredInquiry = {
      referenceId,
      submittedAt,
      fullName: fullName.slice(0, 120),
      companyName: String(body.companyName ?? '').trim().slice(0, 120),
      email: email.slice(0, 160),
      phone: phone.slice(0, 40),
      serviceCategory: body.serviceCategory ?? 'freight',
      message: message.slice(0, 4000),
      language: body.language ?? 'en',
      attachedContext: body.attachedContext ? String(body.attachedContext).slice(0, 4000) : undefined,
    };

    persistInquiry(record);

    res.status(201).json({
      ok: true,
      referenceId,
      submittedAt,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
