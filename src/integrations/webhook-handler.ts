import express from 'express';
import { createHmac } from 'crypto';
import { GitHubWatcher } from './github-watcher';

export class WebhookHandler {
    private app: express.Application;
    private githubWatcher: GitHubWatcher;
    private webhookSecret: string;

    constructor(githubWatcher: GitHubWatcher) {
        this.app = express();
        this.githubWatcher = githubWatcher;
        this.webhookSecret = process.env.WEBHOOK_SECRET || '';

        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        // Raw body parser for webhook signature verification
        this.app.use('/webhook', express.raw({ type: 'application/json' }));

        // JSON parser for other routes
        this.app.use(express.json());

        // CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });
    }

    private setupRoutes(): void {
        // GitHub webhook endpoint
        this.app.post('/webhook/github', this.handleGitHubWebhook.bind(this));

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        // Status endpoint
        this.app.get('/status', async (req, res) => {
            try {
                const watchedRepos = this.githubWatcher.getWatchedRepositories();
                res.json({
                    status: 'active',
                    watchedRepositories: watchedRepos.length,
                    repositories: watchedRepos.map(repo => `${repo.owner}/${repo.repo}`)
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to get status' });
            }
        });

        // Manual sync endpoint
        this.app.post('/sync/:owner/:repo', async (req, res) => {
            try {
                const { owner, repo } = req.params;
                const { branch } = req.body;

                await this.githubWatcher.syncRepository({
                    owner,
                    repo,
                    branch: branch || 'main'
                });

                res.json({
                    message: `Successfully synced ${owner}/${repo}`,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Manual sync error:', error);
                res.status(500).json({ error: 'Sync failed' });
            }
        });

        // List webhooks endpoint
        this.app.get('/webhooks/:owner/:repo', async (req, res) => {
            try {
                const { owner, repo } = req.params;
                const webhooks = await this.githubWatcher.listWebhooks({ owner, repo });
                res.json({ webhooks });
            } catch (error) {
                console.error('List webhooks error:', error);
                res.status(500).json({ error: 'Failed to list webhooks' });
            }
        });

        // Add webhook endpoint
        this.app.post('/webhooks/:owner/:repo', async (req, res) => {
            try {
                const { owner, repo } = req.params;
                const { webhookUrl } = req.body;

                await this.githubWatcher.addWebhookToRepository(
                    { owner, repo },
                    webhookUrl || `${req.protocol}://${req.get('host')}/webhook/github`
                );

                res.json({
                    message: `Webhook added to ${owner}/${repo}`,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Add webhook error:', error);
                res.status(500).json({ error: 'Failed to add webhook' });
            }
        });
    }

    // Handle GitHub webhook events
    private async handleGitHubWebhook(req: express.Request, res: express.Response): Promise<void> {
        try {
            const signature = req.headers['x-hub-signature-256'] as string;
            const payload = req.body;

            // Verify webhook signature
            if (!this.verifySignature(payload, signature)) {
                console.warn('❌ Invalid webhook signature');
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }

            const event = req.headers['x-github-event'] as string;
            const deliveryId = req.headers['x-github-delivery'] as string;

            console.log(`📨 GitHub webhook received: ${event} (${deliveryId})`);

            // Parse JSON payload
            const eventData = JSON.parse(payload.toString());

            // Handle ping event
            if (event === 'ping') {
                console.log('🏓 GitHub webhook ping received');
                res.json({ message: 'pong' });
                return;
            }

            // Process the webhook event
            await this.githubWatcher.handleWebhookEvent({
                type: event,
                ...eventData
            });

            res.json({
                message: 'Webhook processed successfully',
                event,
                deliveryId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Webhook processing error:', error);
            res.status(500).json({
                error: 'Webhook processing failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // Verify GitHub webhook signature
    private verifySignature(payload: Buffer, signature: string): boolean {
        if (!this.webhookSecret) {
            console.warn('⚠️ No webhook secret configured, skipping signature verification');
            return true; // Allow if no secret is configured
        }

        if (!signature) {
            return false;
        }

        const hmac = createHmac('sha256', this.webhookSecret);
        hmac.update(payload);
        const calculatedSignature = `sha256=${hmac.digest('hex')}`;

        return signature === calculatedSignature;
    }

    // Start the webhook server
    start(port: number = 3000): Promise<void> {
        return new Promise((resolve) => {
            this.app.listen(port, () => {
                console.log(`🚀 Webhook server running on port ${port}`);
                console.log(`📨 GitHub webhook endpoint: http://localhost:${port}/webhook/github`);
                console.log(`❤️ Health check: http://localhost:${port}/health`);
                console.log(`📊 Status: http://localhost:${port}/status`);
                resolve();
            });
        });
    }

    // Get Express app (for testing or custom setup)
    getApp(): express.Application {
        return this.app;
    }
}