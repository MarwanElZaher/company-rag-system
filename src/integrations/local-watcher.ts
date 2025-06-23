import * as chokidar from 'chokidar';
import { promises as fs } from 'fs';
import { CompanyRAGEngine } from '../core/rag-engine';
import { KnowledgeExtractor, FileInfo } from '../core/knowledge-extractor';
import { resolve, relative } from 'path';

export interface LocalRepoConfig {
    name: string;
    path: string;
    excludePaths?: string[];
}

export class LocalFileWatcher {
    private ragEngine: CompanyRAGEngine;
    private extractor: KnowledgeExtractor;
    private watchers: Map<string, chokidar.FSWatcher> = new Map();
    private repos: LocalRepoConfig[] = [];

    constructor(ragEngine: CompanyRAGEngine) {
        this.ragEngine = ragEngine;
        this.extractor = new KnowledgeExtractor();
    }

    // Add local repositories to watch
    addLocalRepositories(repos: LocalRepoConfig[]): void {
        this.repos = [...this.repos, ...repos];
        console.log(`📁 Added ${repos.length} local repositories to watch`);
    }

    // Start watching all local repositories
    async startWatching(): Promise<void> {
        console.log('👀 Starting local file watchers...');

        for (const repo of this.repos) {
            await this.watchRepository(repo);
        }

        console.log('✅ All local file watchers started');
    }

    // Watch a single local repository
    private async watchRepository(repo: LocalRepoConfig): Promise<void> {
        const absolutePath = resolve(repo.path);

        try {
            // Check if directory exists
            await fs.access(absolutePath);

            // Create exclude patterns
            const ignored = this.createIgnorePatterns(repo.excludePaths);

            const watcher = chokidar.watch(absolutePath, {
                ignored,
                persistent: true,
                ignoreInitial: false, // Process existing files
                followSymlinks: false,
                awaitWriteFinish: {
                    stabilityThreshold: 2000,
                    pollInterval: 100
                }
            });

            // Set up event handlers
            watcher
                .on('add', (filePath) => this.handleFileEvent('added', repo, filePath))
                .on('change', (filePath) => this.handleFileEvent('modified', repo, filePath))
                .on('unlink', (filePath) => this.handleFileEvent('removed', repo, filePath))
                .on('ready', () => {
                    console.log(`✅ Watching local repository: ${repo.name} at ${repo.path}`);
                })
                .on('error', (error) => {
                    console.error(`❌ Error watching ${repo.name}:`, error);
                });

            this.watchers.set(repo.name, watcher);

        } catch (error) {
            console.error(`❌ Cannot watch repository ${repo.name} at ${repo.path}:`, error);
        }
    }

    // Create ignore patterns for chokidar
    private createIgnorePatterns(excludePaths?: string[]): RegExp[] {
        const defaultIgnored = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            '**/.nyc_output/**',
            '**/*.log',
            '**/.DS_Store',
            '**/Thumbs.db'
        ];

        const allIgnored = [...defaultIgnored, ...(excludePaths || [])];

        return allIgnored.map(pattern => {
            // Convert glob patterns to RegExp
            const regexPattern = pattern
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '.');

            return new RegExp(regexPattern);
        });
    }

    // Handle file system events
    private async handleFileEvent(action: 'added' | 'modified' | 'removed', repo: LocalRepoConfig, filePath: string): Promise<void> {
        try {
            const relativePath = relative(repo.path, filePath);

            // Skip if extractor shouldn't process this file
            if (!this.extractor.shouldProcessFile(relativePath)) {
                return;
            }

            console.log(`📝 ${action} file: ${relativePath} in ${repo.name}`);

            if (action === 'removed') {
                const knowledgeId = this.generateKnowledgeId(repo.name, relativePath);
                await this.ragEngine.removeKnowledge(knowledgeId);
                return;
            }

            // Read file content
            const content = await fs.readFile(filePath, 'utf8');
            const stats = await fs.stat(filePath);

            const fileInfo: FileInfo = {
                repository: repo.name,
                filePath: relativePath,
                content,
                lastModified: stats.mtime
            };

            const knowledge = await this.extractor.extractKnowledge(fileInfo);

            if (knowledge) {
                if (action === 'modified') {
                    await this.ragEngine.updateKnowledge(knowledge);
                } else {
                    await this.ragEngine.addKnowledge(knowledge);
                }
            }

        } catch (error) {
            console.error(`Error handling ${action} event for ${filePath}:`, error);
        }
    }

    // Generate knowledge ID for local files
    private generateKnowledgeId(repoName: string, filePath: string): string {
        const cleanRepo = repoName.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanPath = filePath.replace(/[^a-zA-Z0-9]/g, '_');
        return `${cleanRepo}_${cleanPath}`;
    }

    // Perform initial scan of all repositories
    async performInitialScan(): Promise<void> {
        console.log('🔍 Performing initial scan of local repositories...');

        for (const repo of this.repos) {
            await this.scanRepository(repo);
        }

        console.log('✅ Initial scan completed');
    }

    // Scan a single repository
    private async scanRepository(repo: LocalRepoConfig): Promise<void> {
        console.log(`🔍 Scanning ${repo.name} at ${repo.path}...`);

        try {
            const files = await this.getAllFiles(repo.path, repo.excludePaths);
            let processedFiles = 0;

            for (const filePath of files) {
                const relativePath = relative(repo.path, filePath);

                if (!this.extractor.shouldProcessFile(relativePath)) {
                    continue;
                }

                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    const stats = await fs.stat(filePath);

                    const fileInfo: FileInfo = {
                        repository: repo.name,
                        filePath: relativePath,
                        content,
                        lastModified: stats.mtime
                    };

                    const knowledge = await this.extractor.extractKnowledge(fileInfo);

                    if (knowledge) {
                        await this.ragEngine.addKnowledge(knowledge);
                        processedFiles++;
                    }
                } catch (error) {
                    console.error(`Error processing file ${relativePath}:`, error);
                }
            }

            console.log(`✅ Scanned ${repo.name} - ${processedFiles} files processed`);
        } catch (error) {
            console.error(`Error scanning repository ${repo.name}:`, error);
        }
    }

    // Recursively get all files in a directory
    private async getAllFiles(dir: string, excludePaths?: string[]): Promise<string[]> {
        const files: string[] = [];

        const items = await fs.readdir(dir);

        for (const item of items) {
            const fullPath = resolve(dir, item);
            const relativePath = relative(process.cwd(), fullPath);

            // Check if should be excluded
            if (this.shouldExcludePath(relativePath, excludePaths)) {
                continue;
            }

            const stats = await fs.stat(fullPath);

            if (stats.isDirectory()) {
                const subFiles = await this.getAllFiles(fullPath, excludePaths);
                files.push(...subFiles);
            } else if (stats.isFile()) {
                files.push(fullPath);
            }
        }

        return files;
    }

    // Check if path should be excluded
    private shouldExcludePath(path: string, excludePaths?: string[]): boolean {
        const defaultExcludes = [
            'node_modules',
            '.git',
            'dist',
            'build',
            'coverage',
            '.nyc_output'
        ];

        const allExcludes = [...defaultExcludes, ...(excludePaths || [])];

        return allExcludes.some(exclude => {
            if (exclude.endsWith('/**')) {
                return path.includes(exclude.slice(0, -3));
            }
            return path.includes(exclude);
        });
    }

    // Stop watching a specific repository
    async stopWatching(repoName: string): Promise<void> {
        const watcher = this.watchers.get(repoName);

        if (watcher) {
            await watcher.close();
            this.watchers.delete(repoName);
            console.log(`🛑 Stopped watching ${repoName}`);
        }
    }

    // Stop all watchers
    async stopAllWatchers(): Promise<void> {
        console.log('🛑 Stopping all file watchers...');

        for (const [repoName, watcher] of this.watchers) {
            await watcher.close();
            console.log(`🛑 Stopped watching ${repoName}`);
        }

        this.watchers.clear();
        console.log('✅ All file watchers stopped');
    }

    // Get status of all watchers
    getWatcherStatus(): { repoName: string; isWatching: boolean; path: string }[] {
        return this.repos.map(repo => ({
            repoName: repo.name,
            isWatching: this.watchers.has(repo.name),
            path: repo.path
        }));
    }

    // Manually trigger a rescan of a repository
    async rescanRepository(repoName: string): Promise<void> {
        const repo = this.repos.find(r => r.name === repoName);

        if (!repo) {
            throw new Error(`Repository ${repoName} not found`);
        }

        console.log(`🔄 Rescanning ${repoName}...`);
        await this.scanRepository(repo);
    }

    // Get repository statistics
    async getRepositoryStats(repoName: string): Promise<any> {
        const repo = this.repos.find(r => r.name === repoName);

        if (!repo) {
            return null;
        }

        try {
            const files = await this.getAllFiles(repo.path, repo.excludePaths);
            const processableFiles = files.filter(file => {
                const relativePath = relative(repo.path, file);
                return this.extractor.shouldProcessFile(relativePath);
            });

            return {
                repoName,
                path: repo.path,
                totalFiles: files.length,
                processableFiles: processableFiles.length,
                isWatching: this.watchers.has(repoName)
            };
        } catch (error) {
            console.error(`Error getting stats for ${repoName}:`, error);
            return null;
        }
    }
}