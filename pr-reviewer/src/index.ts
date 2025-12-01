import 'dotenv/config';
import express from 'express';
import githubRouter from './routes/github.js';

// Validate environment variables
const requiredEnvVars = [
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} environment variable is not set`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Routes
app.use(githubRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`PR Reviewer server is running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/github`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
