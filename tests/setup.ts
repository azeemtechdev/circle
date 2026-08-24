import { config } from 'dotenv';

// Tests read the same secrets the app does. `.env.local` is gitignored and is
// the only place real keys ever live; `.env.example` documents the shape.
// `override: false` means real CI environment variables win over the file.
config({ path: '.env.local', override: false, quiet: true });
