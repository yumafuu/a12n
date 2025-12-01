# PR Reviewer - AI-Powered Code Review Bot

An automated PR review bot powered by Claude AI that provides intelligent code reviews for GitHub pull requests.

## Features

- 🤖 **AI-Powered Reviews**: Utilizes Claude 3.5 Sonnet for intelligent code analysis
- 🔒 **Secure**: Validates GitHub webhook signatures for security
- 📝 **Detailed Feedback**: Provides summary, line-by-line comments, and overall assessment
- ⚡ **Fast**: Built with Node.js and Bun for optimal performance
- 🔄 **Auto-Triggered**: Automatically reviews PRs on open and update events

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Package Manager**: Bun
- **Web Framework**: Express
- **GitHub API**: Octokit
- **AI**: Anthropic Claude API

## Installation

### Prerequisites

- [Bun](https://bun.sh/) installed
- GitHub Personal Access Token with `repo` scope
- Anthropic API Key

### Setup

1. Clone the repository
2. Navigate to the `pr-reviewer` directory
3. Install dependencies:

```bash
cd pr-reviewer
bun install
```

4. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

5. Fill in the environment variables:

```env
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_TOKEN=ghp_your_token_here
ANTHROPIC_API_KEY=sk-ant-your_api_key_here
PORT=3000
```

## Usage

### Development Mode

Run the server in development mode with auto-reload:

```bash
bun run dev
```

### Production Mode

Build and run the production server:

```bash
bun run build
bun start
```

## GitHub Webhook Configuration

1. Go to your GitHub repository settings
2. Navigate to **Settings** > **Webhooks** > **Add webhook**
3. Configure the webhook:
   - **Payload URL**: `http://your-server.com/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: Your `GITHUB_WEBHOOK_SECRET` value
   - **Events**: Select "Pull requests"

## API Endpoints

### `POST /webhook/github`

GitHub webhook endpoint for PR events.

**Headers:**
- `X-Hub-Signature-256`: Webhook signature
- `X-GitHub-Event`: Event type (should be "pull_request")

**Supported Events:**
- `pull_request.opened`: Review new PRs
- `pull_request.synchronize`: Review updated PRs

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Project Structure

```
pr-reviewer/
├── src/
│   ├── index.ts          # Entry point
│   ├── routes/
│   │   └── github.ts     # GitHub webhook handler
│   ├── services/
│   │   ├── github.ts     # GitHub API operations
│   │   └── claude.ts     # Claude API operations
│   ├── utils/
│   │   └── verify.ts     # Webhook signature verification
│   └── types/
│       └── index.ts      # Type definitions
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## How It Works

1. **Webhook Trigger**: GitHub sends a webhook when a PR is opened or updated
2. **Signature Verification**: The server verifies the webhook signature for security
3. **Fetch PR Diff**: Retrieves the file changes using GitHub API
4. **AI Review**: Sends the diff to Claude API for analysis
5. **Post Comment**: Formats and posts the review as a PR comment

## Review Format

The bot posts a structured review comment containing:

- **Summary**: Brief overview of the changes
- **Detailed Comments**: File-specific feedback with line numbers
- **Overall Assessment**:
  - ✅ LGTM (Looks Good To Me)
  - ⚠️ Needs Changes
  - 💬 Needs Discussion

## Error Handling

The application includes comprehensive error handling:

- Invalid webhook signatures return 401 Unauthorized
- Missing environment variables cause startup failure
- API errors are logged and gracefully handled
- Fallback responses for Claude API failures

## Security Considerations

- Webhook signatures are verified using HMAC SHA-256
- Timing-safe comparison prevents timing attacks
- Environment variables store sensitive credentials
- GitHub token has minimal required permissions

## Development

### Type Checking

```bash
bun run typecheck
```

### Code Quality

The codebase follows TypeScript strict mode and uses:
- Proper error handling
- Type safety
- ESM modules
- Async/await patterns

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
