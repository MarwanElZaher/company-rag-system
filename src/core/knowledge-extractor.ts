// src/core/knowledge-extractor.ts
import { KnowledgeItem } from './rag-engine';
import { createHash } from 'crypto';
import { basename, extname } from 'path';

export interface FileInfo {
    repository: string;
    filePath: string;
    content: string;
    lastModified: Date;
}

export interface ExtractionConfig {
    includePatterns: string[];
    excludePatterns: string[];
    languageConfigs: Record<string, LanguageConfig>;
}

export interface LanguageConfig {
    extensions: string[];
    commentPatterns: string[];
    importPatterns: string[];
    functionPatterns: string[];
    classPatterns: string[];
}

export class KnowledgeExtractor {
    private config: ExtractionConfig;

    constructor() {
        this.config = {
            includePatterns: [
                '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx',
                '**/*.py', '**/*.java', '**/*.go', '**/*.rs',
                '**/*.cpp', '**/*.c', '**/*.h', '**/*.hpp',
                '**/*.php', '**/*.rb', '**/*.swift', '**/*.kt',
                '**/*.md', '**/*.yaml', '**/*.yml', '**/*.json',
                '**/*.sql', '**/*.sh', '**/*.dockerfile',
                '**/README*', '**/CHANGELOG*', '**/API*'
            ],
            excludePatterns: [
                '**/node_modules/**',
                '**/dist/**',
                '**/build/**',
                '**/.git/**',
                '**/coverage/**',
                '**/*.min.js',
                '**/*.bundle.js',
                '**/vendor/**',
                '**/third_party/**'
            ],
            languageConfigs: {
                javascript: {
                    extensions: ['.js', '.jsx'],
                    commentPatterns: ['//', '/*', '*/', '/**'],
                    importPatterns: ['import', 'require', 'from'],
                    functionPatterns: ['function', '=>', 'async function'],
                    classPatterns: ['class', 'extends']
                },
                typescript: {
                    extensions: ['.ts', '.tsx'],
                    commentPatterns: ['//', '/*', '*/', '/**'],
                    importPatterns: ['import', 'require', 'from'],
                    functionPatterns: ['function', '=>', 'async function'],
                    classPatterns: ['class', 'extends', 'interface', 'type']
                },
                python: {
                    extensions: ['.py'],
                    commentPatterns: ['#', '"""', "'''"],
                    importPatterns: ['import', 'from'],
                    functionPatterns: ['def ', 'async def'],
                    classPatterns: ['class ']
                },
                markdown: {
                    extensions: ['.md'],
                    commentPatterns: ['<!--', '-->'],
                    importPatterns: [],
                    functionPatterns: [],
                    classPatterns: []
                }
            }
        };
    }

    // Check if file should be processed
    shouldProcessFile(filePath: string): boolean {
        // Check exclude patterns first
        for (const pattern of this.config.excludePatterns) {
            if (this.matchesPattern(filePath, pattern)) {
                return false;
            }
        }

        // Check include patterns
        for (const pattern of this.config.includePatterns) {
            if (this.matchesPattern(filePath, pattern)) {
                return true;
            }
        }

        return false;
    }

    // Extract knowledge from file
    async extractKnowledge(fileInfo: FileInfo): Promise<KnowledgeItem | null> {
        if (!this.shouldProcessFile(fileInfo.filePath)) {
            return null;
        }

        const contentHash = createHash('md5').update(fileInfo.content).digest('hex');
        const fileType = this.getFileType(fileInfo.filePath);
        const analysis = this.analyzeContent(fileInfo.content, fileType);

        const knowledgeItem: KnowledgeItem = {
            id: this.generateId(fileInfo.repository, fileInfo.filePath),
            title: this.generateTitle(fileInfo.filePath, analysis),
            content: this.prepareContent(fileInfo.content, analysis, fileInfo.filePath),
            metadata: {
                repository: fileInfo.repository,
                filePath: fileInfo.filePath,
                fileType,
                lastModified: fileInfo.lastModified,
                contentHash,
                tags: this.generateTags(fileInfo.filePath, analysis),
                language: analysis.language,
                framework: analysis.framework,
                dependencies: analysis.dependencies
            }
        };

        return knowledgeItem;
    }

    // Generate unique ID for knowledge item
    private generateId(repository: string, filePath: string): string {
        const cleanRepo = repository.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanPath = filePath.replace(/[^a-zA-Z0-9]/g, '_');
        return `${cleanRepo}_${cleanPath}`;
    }

    // Generate title for knowledge item
    private generateTitle(filePath: string, analysis: any): string {
        const fileName = basename(filePath);

        if (analysis.mainFunction) {
            return `${fileName} - ${analysis.mainFunction}`;
        }

        if (analysis.mainClass) {
            return `${fileName} - ${analysis.mainClass}`;
        }

        if (analysis.exports && analysis.exports.length > 0) {
            return `${fileName} - ${analysis.exports.slice(0, 2).join(', ')}`;
        }

        return fileName;
    }

    // Analyze file content
    private analyzeContent(content: string, fileType: string): any {
        const analysis = {
            language: this.getLanguage(fileType),
            framework: this.detectFramework(content),
            dependencies: this.extractDependencies(content),
            imports: this.extractImports(content),
            exports: this.extractExports(content),
            functions: this.extractFunctions(content),
            classes: this.extractClasses(content),
            mainFunction: null as string | null,
            mainClass: null as string | null,
            summary: this.generateSummary(content),
            complexity: this.calculateComplexity(content)
        };

        // Determine main function/class
        if (analysis.functions.length > 0) {
            analysis.mainFunction = analysis.functions[0];
        }

        if (analysis.classes.length > 0) {
            analysis.mainClass = analysis.classes[0];
        }

        return analysis;
    }

    // Get file type from extension
    private getFileType(filePath: string): string {
        const ext = extname(filePath).toLowerCase();
        const typeMap: Record<string, string> = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.cpp': 'cpp',
            '.c': 'c',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.md': 'markdown',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.json': 'json',
            '.sql': 'sql',
            '.sh': 'shell'
        };

        return typeMap[ext] || 'unknown';
    }

    // Get programming language
    private getLanguage(fileType: string): string {
        return fileType;
    }

    // Detect framework from content
    private detectFramework(content: string): string | undefined {
        const frameworks = [
            { name: 'React', patterns: ['import.*react', 'from.*react', 'useState', 'useEffect'] },
            { name: 'Vue', patterns: ['import.*vue', 'from.*vue', 'createApp', 'defineComponent'] },
            { name: 'Angular', patterns: ['@angular', '@Component', '@Injectable'] },
            { name: 'Express', patterns: ['express', 'app.get', 'app.post', 'router'] },
            { name: 'Next.js', patterns: ['next/', 'getServerSideProps', 'getStaticProps'] },
            { name: 'Django', patterns: ['django', 'models.Model', 'views.'] },
            { name: 'Flask', patterns: ['flask', 'app.route', '@app.route'] },
            { name: 'Spring', patterns: ['@SpringBootApplication', '@RestController', '@Service'] }
        ];

        for (const framework of frameworks) {
            for (const pattern of framework.patterns) {
                if (new RegExp(pattern, 'i').test(content)) {
                    return framework.name;
                }
            }
        }

        return undefined;
    }

    // Extract dependencies
    private extractDependencies(content: string): string[] {
        const dependencies: string[] = [];

        // JavaScript/TypeScript imports
        const importMatches = content.matchAll(/import.*?from\s+['"`]([^'"`]+)['"`]/g);
        for (const match of importMatches) {
            dependencies.push(match[1]);
        }

        // Python imports
        const pythonImports = content.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
        for (const match of pythonImports) {
            dependencies.push(match[1] || match[2]);
        }

        // Java imports
        const javaImports = content.matchAll(/import\s+([\w.]+);/g);
        for (const match of javaImports) {
            dependencies.push(match[1]);
        }

        return [...new Set(dependencies)]; // Remove duplicates
    }

    // Extract imports
    private extractImports(content: string): string[] {
        return this.extractDependencies(content);
    }

    // Extract exports
    private extractExports(content: string): string[] {
        const exports: string[] = [];

        // JavaScript/TypeScript exports
        const exportMatches = content.matchAll(/export\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?(\w+)/g);
        for (const match of exportMatches) {
            exports.push(match[1]);
        }

        return exports;
    }

    // Extract function names
    private extractFunctions(content: string): string[] {
        const functions: string[] = [];

        // JavaScript/TypeScript functions
        const jsFunctions = content.matchAll(/(?:function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>|(\w+):\s*(?:async\s+)?\([^)]*\)\s*=>)/g);
        for (const match of jsFunctions) {
            const funcName = match[1] || match[2] || match[3];
            if (funcName) functions.push(funcName);
        }

        // Python functions
        const pyFunctions = content.matchAll(/def\s+(\w+)\s*\(/g);
        for (const match of pyFunctions) {
            functions.push(match[1]);
        }

        return functions;
    }

    // Extract class names
    private extractClasses(content: string): string[] {
        const classes: string[] = [];

        // JavaScript/TypeScript classes
        const jsClasses = content.matchAll(/class\s+(\w+)/g);
        for (const match of jsClasses) {
            classes.push(match[1]);
        }

        // Python classes
        const pyClasses = content.matchAll(/class\s+(\w+)/g);
        for (const match of pyClasses) {
            classes.push(match[1]);
        }

        return classes;
    }

    // Generate content summary
    private generateSummary(content: string): string {
        const lines = content.split('\n');
        const firstComment = this.extractFirstComment(content);

        if (firstComment) {
            return firstComment;
        }

        // Fallback: use first few non-empty lines
        const nonEmptyLines = lines.filter(line => line.trim().length > 0);
        return nonEmptyLines.slice(0, 3).join(' ').substring(0, 200);
    }

    // Extract first comment (often contains file description)
    private extractFirstComment(content: string): string | null {
        // Multi-line comment
        const multilineMatch = content.match(/\/\*\*?([\s\S]*?)\*\//);
        if (multilineMatch) {
            return multilineMatch[1].replace(/\n\s*\*/g, '\n').trim();
        }

        // Single line comments at the top
        const lines = content.split('\n');
        const commentLines: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) {
                commentLines.push(trimmed.substring(2).trim());
            } else if (trimmed.startsWith('#')) {
                commentLines.push(trimmed.substring(1).trim());
            } else if (trimmed.length > 0) {
                break; // Stop at first non-comment line
            }
        }

        return commentLines.length > 0 ? commentLines.join(' ') : null;
    }

    // Calculate complexity score
    private calculateComplexity(content: string): number {
        let complexity = 0;

        // Count various complexity indicators
        complexity += (content.match(/if\s*\(/g) || []).length;
        complexity += (content.match(/for\s*\(/g) || []).length;
        complexity += (content.match(/while\s*\(/g) || []).length;
        complexity += (content.match(/switch\s*\(/g) || []).length;
        complexity += (content.match(/catch\s*\(/g) || []).length;
        complexity += (content.match(/&&|\|\|/g) || []).length;

        return complexity;
    }

    // Generate tags for the knowledge item
    private generateTags(filePath: string, analysis: any): string[] {
        const tags: string[] = [];

        // File-based tags
        if (filePath.includes('test')) tags.push('test');
        if (filePath.includes('api')) tags.push('api');
        if (filePath.includes('component')) tags.push('component');
        if (filePath.includes('util')) tags.push('utility');
        if (filePath.includes('config')) tags.push('configuration');
        if (filePath.includes('service')) tags.push('service');
        if (filePath.includes('model')) tags.push('model');
        if (filePath.includes('controller')) tags.push('controller');

        // Language tags
        if (analysis.language) tags.push(analysis.language);
        if (analysis.framework) tags.push(analysis.framework);

        // Content-based tags
        if (analysis.functions.length > 0) tags.push('functions');
        if (analysis.classes.length > 0) tags.push('classes');
        if (analysis.complexity > 10) tags.push('complex');
        if (analysis.complexity <= 3) tags.push('simple');

        // Dependency-based tags
        analysis.dependencies.forEach((dep: string) => {
            if (dep.includes('react')) tags.push('react');
            if (dep.includes('express')) tags.push('express');
            if (dep.includes('typescript')) tags.push('typescript');
        });

        return [...new Set(tags)]; // Remove duplicates
    }

    // Prepare content for RAG storage
    private prepareContent(content: string, analysis: any, filePath: string): string {
        return `
File: ${filePath}
Language: ${analysis.language}
Framework: ${analysis.framework || 'None'}

Summary: ${analysis.summary}

Dependencies:
${analysis.dependencies.map((dep: string) => `- ${dep}`).join('\n')}

Functions: ${analysis.functions.join(', ')}
Classes: ${analysis.classes.join(', ')}
Complexity: ${analysis.complexity}

Content:
${content}
    `.trim();
    }

    // Simple pattern matching
    private matchesPattern(filePath: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');

        return new RegExp(regexPattern).test(filePath);
    }
}