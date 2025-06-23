import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChromaClient } from 'chromadb';
import { createHash } from 'crypto';

export interface KnowledgeItem {
    id: string;
    title: string;
    content: string;
    metadata: {
        repository: string;
        filePath: string;
        fileType: string;
        lastModified: Date;
        contentHash: string;
        tags: string[];
        language?: string;
        framework?: string;
        dependencies?: string[];
    };
}

export interface SearchResult {
    content: string;
    score: number;
    metadata: any;
}

export class CompanyRAGEngine {
    private gemini: GoogleGenerativeAI;
    private chroma: ChromaClient;
    private collectionName = 'company_knowledge';
    private model: any;

    constructor() {
        this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        this.chroma = new ChromaClient({
            path: process.env.CHROMA_URL || 'http://localhost:8000'
        });
        this.initializeModel();
    }

    private async initializeModel() {
        // Try different Gemini models in order of preference
        const models = [
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-1.0-pro'
        ];

        for (const modelName of models) {
            try {
                this.model = this.gemini.getGenerativeModel({ model: modelName });
                await this.model.generateContent('test');
                console.log(`✅ Using Gemini model: ${modelName}`);
                break;
            } catch (error) {
                console.log(`❌ Model ${modelName} not available, trying next...`);
                continue;
            }
        }

        if (!this.model) {
            throw new Error('No Gemini model available. Check your API key.');
        }
    }

    async initialize(): Promise<void> {
        try {
            await this.chroma.createCollection({
                name: this.collectionName,
                metadata: { description: 'Company codebase knowledge' }
            });
            console.log('✅ ChromaDB collection created');
        } catch (error) {
            console.log('📝 ChromaDB collection already exists');
        }
    }

    // Generate embeddings using Gemini
    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const embeddings: number[][] = [];

        for (const text of texts) {
            try {
                const result = await this.model.embedContent(text);
                embeddings.push(result.embedding.values);
            } catch (error) {
                console.error('Error generating embedding:', error);
                // Fallback: create a simple hash-based embedding
                const hashEmbedding = this.createHashEmbedding(text);
                embeddings.push(hashEmbedding);
            }
        }

        return embeddings;
    }

    // Fallback embedding using hash
    private createHashEmbedding(text: string): number[] {
        const hash = createHash('sha256').update(text).digest();
        const embedding = new Array(384).fill(0);

        for (let i = 0; i < hash.length && i < 384; i++) {
            embedding[i] = (hash[i] / 255) * 2 - 1; // Normalize to [-1, 1]
        }

        return embedding;
    }

    // Add knowledge to the system
    async addKnowledge(item: KnowledgeItem): Promise<void> {
        const collection = await this.chroma.getCollection({
            name: this.collectionName
        });

        // Split content into chunks for better retrieval
        const chunks = this.splitContent(item.content);
        const embeddings = await this.generateEmbeddings(chunks);

        for (let i = 0; i < chunks.length; i++) {
            await collection.add({
                ids: [`${item.id}_chunk_${i}`],
                embeddings: [embeddings[i]],
                documents: [chunks[i]],
                metadatas: [{
                    ...item.metadata,
                    originalId: item.id,
                    chunkIndex: i,
                    title: item.title,
                    totalChunks: chunks.length
                }]
            });
        }

        console.log(`✅ Added knowledge: ${item.title} (${chunks.length} chunks)`);
    }

    // Update existing knowledge
    async updateKnowledge(item: KnowledgeItem): Promise<void> {
        // Remove old version
        await this.removeKnowledge(item.id);
        // Add new version
        await this.addKnowledge(item);
        console.log(`🔄 Updated knowledge: ${item.title}`);
    }

    // Remove knowledge
    async removeKnowledge(id: string): Promise<void> {
        const collection = await this.chroma.getCollection({
            name: this.collectionName
        });

        try {
            const results = await collection.query({
                queryTexts: [''],
                nResults: 1000,
                where: { originalId: id }
            });

            if (results.ids[0].length > 0) {
                await collection.delete({
                    ids: results.ids[0]
                });
                console.log(`🗑️ Removed knowledge: ${id}`);
            }
        } catch (error) {
            console.error(`Error removing knowledge ${id}:`, error);
        }
    }

    // Search knowledge
    async searchKnowledge(query: string, limit: number = 5): Promise<SearchResult[]> {
        const collection = await this.chroma.getCollection({
            name: this.collectionName
        });

        const queryEmbedding = await this.generateEmbeddings([query]);

        const results = await collection.query({
            queryEmbeddings: queryEmbedding,
            nResults: limit
        });

        return results.documents[0].map((doc, index) => ({
            content: doc || '',
            score: 1 - (results.distances?.[0]?.[index] || 1),
            metadata: results.metadatas?.[0]?.[index] || {}
        }));
    }

    // Generate response using knowledge
    async generateResponse(question: string, context?: string): Promise<string> {
        // Retrieve relevant knowledge
        const searchResults = await this.searchKnowledge(question, 10);

        // Build context from search results
        const knowledgeContext = searchResults
            .map(result => `${result.metadata.title}: ${result.content}`)
            .join('\n\n');

        const prompt = `
You are an expert software engineer familiar with the company's codebase. 
Answer the question based on the provided code context and knowledge.

Knowledge from codebase:
${knowledgeContext}

${context ? `Additional context: ${context}` : ''}

Question: ${question}

Provide a detailed, accurate answer based on the codebase knowledge. Include:
1. Direct answer to the question
2. Relevant code examples from the knowledge base
3. Best practices from the codebase
4. File references where applicable

Answer:`;

        try {
            const result = await this.model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error('Error generating response:', error);
            return 'Sorry, I encountered an error generating a response. Please try again.';
        }
    }

    // Split content into manageable chunks
    private splitContent(content: string): string[] {
        const maxChunkSize = 1000;
        const chunks: string[] = [];

        // Split by lines first
        const lines = content.split('\n');
        let currentChunk = '';

        for (const line of lines) {
            if (currentChunk.length + line.length > maxChunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                currentChunk = line;
            } else {
                currentChunk += (currentChunk ? '\n' : '') + line;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks.length > 0 ? chunks : [content];
    }

    // Get knowledge statistics
    async getStats(): Promise<any> {
        const collection = await this.chroma.getCollection({
            name: this.collectionName
        });

        try {
            const count = await collection.count();
            return {
                totalChunks: count,
                collectionName: this.collectionName
            };
        } catch (error) {
            return { totalChunks: 0, error: error.message };
        }
    }
}