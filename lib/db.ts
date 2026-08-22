// lib/db.ts — Neon serverless connection (works on Vercel edge/serverless)
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = neon(url);
