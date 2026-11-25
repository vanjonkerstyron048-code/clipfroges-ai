# ClipForge AI — starter build

This is a clean starter project for ClipForge AI.

## What works in this starter

- Responsive landing page
- User registration and login
- Password hashing
- SQLite user and clip records
- Video upload (maximum 250 MB)
- Server-side MP4 clip rendering with FFmpeg
- Private clip downloads for the signed-in user
- Dockerfile suitable for a Render Docker deployment

## What is NOT live yet

- AI-powered highlight detection
- Automatic captions/subtitles
- AI reframing / face tracking
- PayFast checkout or recurring billing
- Production-grade account recovery, email verification, moderation and usage metering

The pricing cards are examples only. Checkout is intentionally disabled so customers cannot be charged before the service and payment notifications are fully tested.

## Run locally

1. Install Node.js 20 or newer.
2. Install FFmpeg and make sure the `ffmpeg` command works in your terminal.
3. Copy `.env.example` to `.env`.
4. Set a long random `SESSION_SECRET`.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

## Render deployment

1. Push this folder to a GitHub repository.
2. In Render, create a new **Web Service** and connect the repository.
3. Choose **Docker** as the runtime.
4. Add environment variable `SESSION_SECRET` with a long random value.
5. Add a persistent disk mounted at `/var/data`.
6. Set `DATA_DIR=/var/data`.
7. Deploy and test registration, login, upload, rendering and download.

A persistent disk is important: without it, SQLite accounts and uploaded clips can be lost when the service is redeployed or restarted.

## Before taking real payments

Use a verified PayFast merchant account and the PayFast sandbox first. Implement and test signed checkout requests, server-side Instant Transaction Notification (ITN) validation, subscription status updates, failed-payment handling, cancellations, refunds and access control. Never trust a browser redirect as proof of payment. Keep merchant secrets only in server environment variables, never in browser code or GitHub.

Official docs: https://developers.payfast.co.za/docs

## Important product note

This first version makes manually selected clips using FFmpeg. It does not yet use AI to identify highlights. Add a tested AI/video analysis provider in a later stage and show customers exactly which features are available on each paid plan.
