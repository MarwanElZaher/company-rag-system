// src/integrations/github-watcher.ts
import { Octokit } from '@octokit/rest';
import { CompanyRAGEngine } from '../core/rag-engine';
import { KnowledgeExtractor, FileInfo } from '../core/knowledge-extractor';

export interface RepoConfig {
    owner: string;
    repo: string;
    branch?: string;
    excludePaths?: string[];
}

export interface GitHubEvent {
    action: 'added' | 'modified' | 'removed';
    repository: string;
    filePath: string;
    content?: string;
    sha?: string;
}

export class GitHubWatcher {
    private octokit: Octokit;
    private ragEngine: CompanyRAGEngine;
    private extractor: KnowledgeExtractor;
    private repos: RepoConfig[] = [];

    constructor(ragEngine: CompanyRAGEngine) {
        this.octokit = new Octokit({
            auth: process.env.GITHUB_TOKEN
        });
        this.ragEngine = ragEngine;
        this.extractor = new KnowledgeExtractor();
    }

    // Add repositories to watch
    addRepositories(repos: RepoConfig[]): void {
        this.repos = [...this.repos, ...repos];
        console.log(`📋 Added ${repos.length} repositories to watch`);
    }

    // Perform initial sync of all repositories
    async performInitialSync(): Promise<void> {
        console.log('🔄 Starting initial sync of repositories...');

        for (const repo of this.repos) {
            await this.syncRepository(repo);
        }

        console.log('✅ Initial sync completed');
    }

    // Sync a single repository
    async syncRepository(repo: RepoConfig): Promise<void> {
        console.log(`🔄 Syncing ${repo.owner}/${repo.repo}...`);

        try {
            // Get repository tree
            const tree = await this.octokit.git.getTree({
                owner: repo.owner,
                repo: repo.repo,
                tree_sha: repo.branch || 'main',
                recursive: 'true'
            });

            let processedFiles = 0;

            for (const item of tree.data.tree) {
                if (item.type === 'blob' && item.path) {
                    // Check if file should be excluded
                    if (this.shouldExcludeFile(item.path, repo.excludePaths)) {
                        continue;
                    }

                    // Check if extractor should process this file
                    if (!this.extractor.shouldProcessFile(item.path)) {
                        continue;
                    }

                    try {
                        const content = await this.fetchFileContent(repo.owner, repo.repo, item.path);

                        if (content) {
                            const fileInfo: FileInfo = {
                                repository: `${repo.owner}/${repo.repo}`,
                                filePath: item.path,
                                content,
                                lastModified: new Date()
                            };

                            const knowledge = await this.extractor.extractKnowledge(fileInfo);

                            if (knowledge) {
                                await this.ragEngine.addKnowledge(knowledge);
                                processedFiles++;
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing file ${item.path}:`, error);
                    }
                }
            }

            console.log(`✅ Synced ${repo.owner}/${repo.repo} - ${processedFiles} files processed`);
        } catch (error) {
            console.error(`Error syncing repository ${repo.owner}/${repo.repo}:`, error);
        }
    }

    // Check if file should be excluded
    private shouldExcludeFile(filePath: string, excludePaths?: string[]): boolean {
        if (!excludePaths) return false;

        return excludePaths.some(excludePath => {
            if (excludePath.endsWith('/**')) {
                const prefix = excludePath.slice(0, -3);
                return filePath.startsWith(prefix);
            }
            return filePath.includes(excludePath);
        });
    }

    // Fetch file content from GitHub
    private async fetchFileContent(owner: string, repo: string, path: string): Promise<string | null> {
        try {
            const response = await this.octokit.repos.getContent({
                owner,
                repo,
                path
            });

            if ('content' in response.data && !Array.isArray(response.data)) {
                return Buffer.from(response.data.content, 'base64').toString('utf8');
            }

            return null;
        } catch (error) {
            console.error(`Error fetching content for ${path}:`, error);
            return null;
        }
    }

    // Handle webhook events from GitHub
    async handleWebhookEvent(payload: any): Promise<void> {
        if (payload.zen) {
            console.log('🔔 GitHub webhook ping received');
            return;
        }

        if (payload.action && payload.repository) {
            await this.processRepositoryEvent(payload);
        } else if (payload.commits && payload.repository) {
            await this.processPushEvent(payload);
        }
    }

    // Process repository events (created, deleted, etc.)
    private async processRepositoryEvent(payload: any): Promise<void> {
        const repoFullName = payload.repository.full_name;
        console.log(`📦 Repository event: ${payload.action} for ${repoFullName}`);

        if (payload.action === 'deleted') {
            await this.removeRepositoryKnowledge(repoFullName);
        } else if (payload.action === 'created') {
            const [owner, repo] = repoFullName.split('/');
            await this.syncRepository({ owner, repo });
        }
    }

    // Process push events
    private async processPushEvent(payload: any): Promise<void> {
        const repoFullName = payload.repository.full_name;
        console.log(`📝 Push event for ${repoFullName} - ${payload.commits.length} commits`);

        for (const commit of payload.commits) {
            // Process added files
            for (const filePath of commit.added || []) {
                await this.processFileChange('added', repoFullName, filePath);
            }

            // Process modified files
            for (const filePath of commit.modified || []) {
                await this.processFileChange('modified', repoFullName, filePath);
            }

            // Process removed files
            for (const filePath of commit.removed || []) {
                await this.processFileChange('removed', repoFullName, filePath);
            }
        }
    }

    // Process individual file changes
    private async processFileChange(action: 'added' | 'modified' | 'removed', repoFullName: string, filePath: string): Promise<void> {
        const [owner, repo] = repoFullName.split('/');

        // Check if we're watching this repository
        const repoConfig = this.repos.find(r => `${r.owner}/${r.repo}` === repoFullName);
        if (!repoConfig) {
            return;
        }

        // Check if file should be excluded
        if (this.shouldExcludeFile(filePath, repoConfig.excludePaths)) {
            return;
        }

        // Check if extractor should process this file
        if (!this.extractor.shouldProcessFile(filePath)) {
            return;
        }

        console.log(`🔄 Processing ${action} file: ${filePath}`);

        if (action === 'removed') {
            const knowledgeId = this.extractor['generateId'](repoFullName, filePath);
            await this.ragEngine.removeKnowledge(knowledgeId);
            return;
        }

        try {
            const content = await this.fetchFileContent(owner, repo, filePath);

            if (content) {
                const fileInfo: FileInfo = {
                    repository: repoFullName,
                    filePath,
                    content,
                    lastModified: new Date()
                };

                const knowledge = await this.extractor.extractKnowledge(fileInfo);

                if (knowledge) {
                    if (action === 'modified') {
                        await this.ragEngine.updateKnowledge(knowledge);
                    } else {
                        await this.ragEngine.addKnowledge(knowledge);
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing ${action} file ${filePath}:`, error);
        }
    }

    // Remove all knowledge for a repository
    private async removeRepositoryKnowledge(repoFullName: string): Promise<void> {
        console.log(`🗑️ Removing all knowledge for repository: ${repoFullName}`);

        // This would need to be implemented in the RAG engine
        // For now, we'll search and remove individually
        const searchResults = await this.ragEngine.searchKnowledge(`repository:${repoFullName}`, 1000);

        for (const result of searchResults) {
            if (result.metadata.repository === repoFullName) {
                await this.ragEngine.removeKnowledge(result.metadata.originalId);
            }
        }
    }

    // Get list of watched repositories
    getWatchedRepositories(): RepoConfig[] {
        return [...this.repos];
    }

    // Add webhook to repository
    async addWebhookToRepository(repo: RepoConfig, webhookUrl: string): Promise<void> {
        try {
            await this.octokit.repos.createWebhook({
                owner: repo.owner,
                repo: repo.repo,
                config: {
                    url: webhookUrl,
                    content_type: 'json',
                    secret: process.env.WEBHOOK_SECRET
                },
                events: ['push', 'repository']
            });

            console.log(`✅ Webhook added to ${repo.owner}/${repo.repo}`);
        } catch (error) {
            console.error(`Error adding webhook to ${repo.owner}/${repo.repo}:`, error);
        }
    }

    // List all webhooks for a repository
    async listWebhooks(repo: RepoConfig): Promise<any[]> {
        try {
            const response = await this.octokit.repos.listWebhooks({
                owner: repo.owner,
                repo: repo.repo
            });

            return response.data;
        } catch (error) {
            console.error(`Error listing webhooks for ${repo.owner}/${repo.repo}:`, error);
            return [];
        }
    }

    // Remove webhook from repository
    async removeWebhook(repo: RepoConfig, webhookId: number): Promise<void> {
        try {
            await this.octokit.repos.deleteWebhook({
                owner: repo.owner,
                repo: repo.repo,
                hook_id: webhookId
            });

            console.log(`✅ Webhook ${webhookId} removed from ${repo.owner}/${repo.repo}`);
        } catch (error) {
            console.error(`Error removing webhook from ${repo.owner}/${repo.repo}:`, error);
        }
    }

    // Get repository information
    async getRepositoryInfo(repo: RepoConfig): Promise<any> {
        try {
            const response = await this.octokit.repos.get({
                owner: repo.owner,
                repo: repo.repo
            });

            return {
                name: response.data.name,
                fullName: response.data.full_name,
                description: response.data.description,
                language: response.data.language,
                size: response.data.size,
                stargazersCount: response.data.stargazers_count,
                forksCount: response.data.forks_count,
                openIssuesCount: response.data.open_issues_count,
                defaultBranch: response.data.default_branch,
                updatedAt: response.data.updated_at
            };
        } catch (error) {
            console.error(`Error getting repository info for ${repo.owner}/${repo.repo}:`, error);
            return null;
        }
    }

    // Search repositories in organization
    async searchOrganizationRepositories(org: string): Promise<RepoConfig[]> {
        try {
            const response = await this.octokit.repos.listForOrg({
                org,
                per_page: 100
            });

            return response.data.map(repo => ({
                owner: repo.owner.login,
                repo: repo.name,
                branch: repo.default_branch
            }));
        } catch (error) {
            console.error(`Error searching repositories for organization ${org}:`, error);
            return [];
        }
    }
}