// src/index.ts
import * as dotenv from 'dotenv';
import { CompanyRAGEngine } from './core/rag-engine';
import { GitHubWatcher } from './integrations/github-watcher';
import { LocalFileWatcher } from './integrations/local-watcher';
import { WebhookHandler } from './integrations/webhook-handler';
import repoConfig from '../config/repos.json';

// Load environment variables
dotenv.config();

interface CompanyRAGSystem {
    ragEngine: CompanyRAGEngine;
    githubWatcher: GitHubWatcher;
    localWatcher: LocalFileWatcher;
    webhookHandler: WebhookHandler;
}

class CompanyRAGApplication {
    private system: CompanyRAGSystem | null = null;

    async initialize(): Promise<CompanyRAGSystem> {
        console.log('🚀 Initializing Company RAG System...');

        // Initialize core RAG engine
        const ragEngine = new CompanyRAGEngine();
        await ragEngine.initialize();

        // Initialize GitHub watcher
        const githubWatcher = new GitHubWatcher(ragEngine);
        githubWatcher.addRepositories(repoConfig.githubRepositories);

        // Initialize local file watcher
        const localWatcher = new LocalFileWatcher(ragEngine);
        localWatcher.addLocalRepositories(repoConfig.localRepositories);

        // Initialize webhook handler
        const webhookHandler = new WebhookHandler(githubWatcher);

        this.system = {
            ragEngine,
            githubWatcher,
            localWatcher,
            webhookHandler
        };

        console.log('✅ Company RAG System initialized');
        return this.system;
    }

    async startSystem(): Promise<void> {
        if (!this.system) {
            throw new Error('System not initialized. Call initialize() first.');
        }

        console.log('▶️ Starting Company RAG System...');

        // Start webhook server
        const port = parseInt(process.env.PORT || '3000');
        await this.system.webhookHandler.start(port);

        // Perform initial sync
        if (repoConfig.settings.enableRealTimeSync) {
            console.log('🔄 Performing initial sync...');

            // Sync GitHub repositories
            await this.system.githubWatcher.performInitialSync();

            // Scan local repositories
            await this.system.localWatcher.performInitialScan();

            // Start local file watchers
            await this.system.localWatcher.startWatching();

            console.log('✅ Initial sync completed');
        }

        // Set up webhooks if enabled
        if (repoConfig.settings.enableWebhooks) {
            await this.setupWebhooks();
        }

        console.log('🎉 Company RAG System is running!');
        this.printSystemInfo();
    }

    private async setupWebhooks(): Promise<void> {
        if (!this.system) return;

        console.log('🔗 Setting up GitHub webhooks...');

        const baseUrl = process.env.WEBHOOK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        const webhookUrl = `${baseUrl}/webhook/github`;

        for (const repo of repoConfig.githubRepositories) {
            try {
                await this.system.githubWatcher.addWebhookToRepository(repo, webhookUrl);
            } catch (error) {
                console.warn(`⚠️ Could not add webhook to ${repo.owner}/${repo.repo}:`, error);
            }
        }
    }

    private printSystemInfo(): void {
        const port = process.env.PORT || 3000;

        console.log('\n📊 System Information:');
        console.log('─'.repeat(50));
        console.log(`🌐 Webhook Server: http://localhost:${port}`);
        console.log(`📨 GitHub Webhook: http://localhost:${port}/webhook/github`);
        console.log(`❤️ Health Check: http://localhost:${port}/health`);
        console.log(`📊 Status: http://localhost:${port}/status`);
        console.log(`📁 GitHub Repos: ${repoConfig.githubRepositories.length}`);
        console.log(`💻 Local Repos: ${repoConfig.localRepositories.length}`);
        console.log(`🔄 Real-time Sync: ${repoConfig.settings.enableRealTimeSync ? 'Enabled' : 'Disabled'}`);
        console.log(`🔗 Webhooks: ${repoConfig.settings.enableWebhooks ? 'Enabled' : 'Disabled'}`);
        console.log('─'.repeat(50));
    }

    async askQuestion(question: string, context?: string): Promise<string> {
        if (!this.system) {
            throw new Error('System not initialized');
        }

        return await this.system.ragEngine.generateResponse(question, context);
    }

    async searchKnowledge(query: string, limit: number = 10): Promise<any[]> {
        if (!this.system) {
            throw new Error('System not initialized');
        }

        return await this.system.ragEngine.searchKnowledge(query, limit);
    }

    async getSystemStats(): Promise<any> {
        if (!this.system) {
            throw new Error('System not initialized');
        }

        const ragStats = await this.system.ragEngine.getStats();
        const watcherStatus = this.system.localWatcher.getWatcherStatus();

        return {
            rag: ragStats,
            watchers: watcherStatus,
            repositories: {
                github: repoConfig.githubRepositories.length,
                local: repoConfig.localRepositories.length
            }
        };
    }

    async shutdown(): Promise<void> {
        if (!this.system) return;

        console.log('🛑 Shutting down Company RAG System...');

        // Stop local file watchers
        await this.system.localWatcher.stopAllWatchers();

        console.log('✅ Company RAG System shutdown complete');
    }
}

// CLI Interface
async function main(): Promise<void> {
    const app = new CompanyRAGApplication();

    try {
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            await app.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            await app.shutdown();
            process.exit(0);
        });

        // Parse command line arguments
        const command = process.argv[2];
        const args = process.argv.slice(3);

        if (command === 'start') {
            await app.initialize();
            await app.startSystem();

            // Keep the process running
            process.stdin.resume();

        } else if (command === 'ask') {
            if (args.length === 0) {
                console.error('❌ Please provide a question to ask');
                process.exit(1);
            }

            await app.initialize();
            const question = args.join(' ');
            const answer = await app.askQuestion(question);

            console.log('\n📝 Question:', question);
            console.log('💭 Answer:', answer);

        } else if (command === 'search') {
            if (args.length === 0) {
                console.error('❌ Please provide a search query');
                process.exit(1);
            }

            await app.initialize();
            const query = args.join(' ');
            const results = await app.searchKnowledge(query);

            console.log('\n🔍 Search Query:', query);
            console.log('📋 Results:');
            results.forEach((result, index) => {
                console.log(`\n${index + 1}. ${result.metadata.title}`);
                console.log(`   Repository: ${result.metadata.repository}`);
                console.log(`   File: ${result.metadata.filePath}`);
                console.log(`   Score: ${result.score.toFixed(3)}`);
                console.log(`   Content: ${result.content.substring(0, 200)}...`);
            });

        } else if (command === 'stats') {
            await app.initialize();
            const stats = await app.getSystemStats();

            console.log('\n📊 System Statistics:');
            console.log(JSON.stringify(stats, null, 2));

        } else if (command === 'sync') {
            await app.initialize();

            if (args[0] === 'github') {
                const system = await app.initialize();
                await system.githubWatcher.performInitialSync();
            } else if (args[0] === 'local') {
                const system = await app.initialize();
                await system.localWatcher.performInitialScan();
            } else {
                console.log('🔄 Performing full sync...');
                const system = await app.initialize();
                await system.githubWatcher.performInitialSync();
                await system.localWatcher.performInitialScan();
            }

            console.log('✅ Sync completed');

        } else {
            console.log(`
Company RAG System - Gemini Edition

Usage:
  npm start                          Start the full system with webhook server
  npm run ask "your question"        Ask a question about your codebase
  npm run search "search query"      Search through your codebase
  npm run stats                      Show system statistics
  npm run sync [github|local]       Manually sync repositories

Examples:
  npm start
  npm run ask "How do we handle authentication in our backend?"
  npm run search "React component patterns"
  npm run sync github
  npm run stats

Environment Variables Required:
  GEMINI_API_KEY=your_gemini_api_key
  GITHUB_TOKEN=your_github_token
  CHROMA_URL=http://localhost:8000
  WEBHOOK_SECRET=your_webhook_secret
  PORT=3000
      `);
        }

    } catch (error) {
        console.error('❌ Error:', error);

        if (error instanceof Error) {
            if (error.message.includes('API key')) {
                console.log('\n💡 Make sure you have set all required environment variables:');
                console.log('- GEMINI_API_KEY: Get from https://makersuite.google.com/app/apikey');
                console.log('- GITHUB_TOKEN: Create at https://github.com/settings/tokens');
                console.log('- CHROMA_URL: ChromaDB server URL (default: http://localhost:8000)');
            }
        }

        process.exit(1);
    }
}

// Export for testing
export { CompanyRAGApplication };

// Run if called directly
if (require.main === module) {
    main();
}