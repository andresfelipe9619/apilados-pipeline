# Performance Optimization Guide

## Overview

This guide provides comprehensive performance tuning and optimization strategies for the Apilados Pipeline. It covers Lambda optimization, memory management, processing efficiency, and cost optimization techniques.

## Table of Contents

1. [Performance Architecture](#performance-architecture)
2. [Lambda Function Optimization](#lambda-function-optimization)
3. [Memory Management](#memory-management)
4. [Processing Optimization](#processing-optimization)
5. [CCTs Performance Tuning](#ccts-performance-tuning)
6. [API and Network Optimization](#api-and-network-optimization)
7. [Cost Optimization](#cost-optimization)
8. [Monitoring and Profiling](#monitoring-and-profiling)

## Performance Architecture

### Performance Goals

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Execution Time | < 5 minutes | < 10 minutes |
| Memory Usage | < 70% | < 85% |
| Success Rate | > 99% | > 95% |
| API Response Time | < 500ms | < 2000ms |
| Cost per 1000 records | < $0.10 | < $0.25 |

### Performance Monitoring Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Performance Monitoring                   │
├─────────────────────────────────────────────────────────────┤
│  CloudWatch Metrics  │  X-Ray Tracing  │  Custom Metrics   │
├─────────────────────────────────────────────────────────────┤
│           Lambda Function Performance Layer                 │
├─────────────────────────────────────────────────────────────┤
│  Memory Profiling   │  CPU Optimization │  I/O Efficiency  │
├─────────────────────────────────────────────────────────────┤
│                    Application Layer                        │
├─────────────────────────────────────────────────────────────┤
│  CCTs Management    │  Batch Processing │  API Optimization │
└─────────────────────────────────────────────────────────────┘
```

## Lambda Function Optimization

### Memory and CPU Configuration

#### Optimal Memory Sizing

```bash
# Performance testing script for memory optimization
#!/bin/bash

FUNCTION_NAME="apilados-pipeline-ingest"
MEMORY_SIZES=(512 768 1024 1536 2048 3008)

for memory in "${MEMORY_SIZES[@]}"; do
    echo "Testing with ${memory}MB memory..."
    
    # Update function memory
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --memory-size $memory \
        --profile production
    
    # Wait for update to complete
    sleep 30
    
    # Run test
    aws lambda invoke \
        --function-name $FUNCTION_NAME \
        --payload file://test-payload.json \
        --profile production \
        response-${memory}.json
    
    # Extract metrics
    DURATION=$(cat response-${memory}.json | jq '.duration')
    BILLED_DURATION=$(cat response-${memory}.json | jq '.billedDuration')
    
    echo "Memory: ${memory}MB, Duration: ${DURATION}ms, Billed: ${BILLED_DURATION}ms"
done
```

#### Recommended Configuration

Based on performance testing:

```bash
# Optimal configuration for most workloads
aws lambda update-function-configuration \
    --function-name apilados-pipeline-ingest \
    --memory-size 1536 \
    --timeout 900 \
    --profile production

# For large datasets (>10k records)
aws lambda update-function-configuration \
    --function-name apilados-pipeline-ingest \
    --memory-size 2048 \
    --timeout 900 \
    --profile production
```

### Cold Start Optimization

#### Provisioned Concurrency

```bash
# Enable provisioned concurrency for consistent performance
aws lambda put-provisioned-concurrency-config \
    --function-name apilados-pipeline-ingest \
    --provisioned-concurrency-config ProvisionedConcurrencyCount=2 \
    --profile production

# Monitor provisioned concurrency utilization
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name ProvisionedConcurrencyUtilization \
    --dimensions Name=FunctionName,Value=apilados-pipeline-ingest \
    --start-time $(date -d '24 hours ago' --iso-8601) \
    --end-time $(date --iso-8601) \
    --period 3600 \
    --statistics Average,Maximum \
    --profile production
```

#### Code Optimization for Cold Starts

```typescript
// Optimize imports and initialization
import { S3Client } from "@aws-sdk/client-s3";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";

// Initialize clients outside handler (reused across invocations)
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION });

// Cache frequently used data
let configCache: any = null;
let lastConfigUpdate = 0;

export const handler = async (event: any) => {
    // Lazy load configuration with caching
    if (!configCache || Date.now() - lastConfigUpdate > 300000) { // 5 minutes
        configCache = await loadConfiguration();
        lastConfigUpdate = Date.now();
    }
    
    // Main processing logic
    return await processEvent(event, configCache);
};
```

### Lambda Layers Optimization

```bash
# Create optimized layer for dependencies
mkdir lambda-layer
cd lambda-layer
npm init -y
npm install axios csv-parser @aws-sdk/client-s3 @aws-sdk/client-cloudwatch

# Create layer
zip -r ../dependencies-layer.zip .
aws lambda publish-layer-version \
    --layer-name apilados-dependencies \
    --zip-file fileb://../dependencies-layer.zip \
    --compatible-runtimes nodejs18.x \
    --profile production

# Attach layer to function
aws lambda update-function-configuration \
    --function-name apilados-pipeline-ingest \
    --layers arn:aws:lambda:us-east-1:123456789012:layer:apilados-dependencies:1 \
    --profile production
```

## Memory Management

### Memory Profiling

#### Built-in Memory Monitoring

```typescript
// Memory monitoring utility
class MemoryMonitor {
    private startMemory: NodeJS.MemoryUsage;
    
    constructor() {
        this.startMemory = process.memoryUsage();
    }
    
    getCurrentUsage(): MemoryUsage {
        const current = process.memoryUsage();
        return {
            heapUsed: Math.round(current.heapUsed / 1024 / 1024),
            heapTotal: Math.round(current.heapTotal / 1024 / 1024),
            external: Math.round(current.external / 1024 / 1024),
            rss: Math.round(current.rss / 1024 / 1024),
            heapUsedDelta: Math.round((current.heapUsed - this.startMemory.heapUsed) / 1024 / 1024)
        };
    }
    
    logMemoryUsage(context: string): void {
        const usage = this.getCurrentUsage();
        console.log(`[Memory] ${context}: Heap ${usage.heapUsed}MB/${usage.heapTotal}MB, RSS ${usage.rss}MB, Delta +${usage.heapUsedDelta}MB`);
    }
}

// Usage in lambda function
const memoryMonitor = new MemoryMonitor();

export const handler = async (event: any) => {
    memoryMonitor.logMemoryUsage("Start");
    
    // Processing logic
    await processData();
    memoryMonitor.logMemoryUsage("After processing");
    
    // Cleanup
    if (global.gc) {
        global.gc();
        memoryMonitor.logMemoryUsage("After GC");
    }
};
```

#### Memory Leak Detection

```typescript
// Memory leak detection utility
class MemoryLeakDetector {
    private samples: number[] = [];
    private readonly maxSamples = 10;
    
    recordMemoryUsage(): void {
        const usage = process.memoryUsage().heapUsed / 1024 / 1024;
        this.samples.push(usage);
        
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
    }
    
    detectLeak(): boolean {
        if (this.samples.length < this.maxSamples) return false;
        
        // Check if memory is consistently increasing
        let increasingCount = 0;
        for (let i = 1; i < this.samples.length; i++) {
            if (this.samples[i] > this.samples[i - 1]) {
                increasingCount++;
            }
        }
        
        return increasingCount >= this.maxSamples * 0.8; // 80% increasing trend
    }
    
    getMemoryTrend(): string {
        if (this.samples.length < 2) return "insufficient data";
        
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const change = ((last - first) / first) * 100;
        
        return `${change.toFixed(1)}% change over ${this.samples.length} samples`;
    }
}
```

### Memory Optimization Strategies

#### Streaming Processing

```typescript
// Use streaming for large file processing
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import csvParser from 'csv-parser';

async function processLargeFile(filePath: string): Promise<void> {
    const results: any[] = [];
    const batchSize = 100;
    
    await pipeline(
        createReadStream(filePath),
        csvParser(),
        async function* (source) {
            let batch: any[] = [];
            
            for await (const chunk of source) {
                batch.push(chunk);
                
                if (batch.length >= batchSize) {
                    yield batch;
                    batch = [];
                }
            }
            
            if (batch.length > 0) {
                yield batch;
            }
        },
        async function (source) {
            for await (const batch of source) {
                await processBatch(batch);
                // Force garbage collection after each batch
                if (global.gc) global.gc();
            }
        }
    );
}
```

#### Object Pool Pattern

```typescript
// Object pooling for frequently created objects
class ObjectPool<T> {
    private pool: T[] = [];
    private createFn: () => T;
    private resetFn: (obj: T) => void;
    
    constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize = 10) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        
        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
        }
    }
    
    acquire(): T {
        return this.pool.pop() || this.createFn();
    }
    
    release(obj: T): void {
        this.resetFn(obj);
        this.pool.push(obj);
    }
}

// Usage for API request objects
const requestPool = new ObjectPool(
    () => ({ data: null, headers: {}, config: {} }),
    (obj) => { obj.data = null; obj.headers = {}; obj.config = {}; }
);
```

## Processing Optimization

### Batch Processing Optimization

#### Dynamic Batch Sizing

```typescript
class AdaptiveBatchProcessor {
    private currentBatchSize: number;
    private readonly minBatchSize = 10;
    private readonly maxBatchSize = 500;
    private performanceHistory: number[] = [];
    
    constructor(initialBatchSize = 100) {
        this.currentBatchSize = initialBatchSize;
    }
    
    async processBatch(items: any[]): Promise<void> {
        const startTime = Date.now();
        const memoryBefore = process.memoryUsage().heapUsed;
        
        // Process batch
        await this.executeBatch(items);
        
        const duration = Date.now() - startTime;
        const memoryAfter = process.memoryUsage().heapUsed;
        const memoryUsed = (memoryAfter - memoryBefore) / 1024 / 1024;
        
        // Record performance
        const performance = this.calculatePerformanceScore(duration, memoryUsed, items.length);
        this.performanceHistory.push(performance);
        
        // Adjust batch size
        this.adjustBatchSize(performance);
    }
    
    private calculatePerformanceScore(duration: number, memoryUsed: number, itemCount: number): number {
        // Higher score is better
        const throughput = itemCount / (duration / 1000); // items per second
        const memoryEfficiency = itemCount / memoryUsed; // items per MB
        
        return (throughput * 0.7) + (memoryEfficiency * 0.3);
    }
    
    private adjustBatchSize(currentPerformance: number): void {
        if (this.performanceHistory.length < 3) return;
        
        const recentAvg = this.performanceHistory.slice(-3).reduce((a, b) => a + b) / 3;
        const previousAvg = this.performanceHistory.slice(-6, -3).reduce((a, b) => a + b) / 3;
        
        if (currentPerformance > recentAvg * 1.1) {
            // Performance improving, increase batch size
            this.currentBatchSize = Math.min(this.maxBatchSize, this.currentBatchSize * 1.2);
        } else if (currentPerformance < previousAvg * 0.9) {
            // Performance degrading, decrease batch size
            this.currentBatchSize = Math.max(this.minBatchSize, this.currentBatchSize * 0.8);
        }
        
        console.log(`[Batch] Adjusted batch size to ${Math.round(this.currentBatchSize)}`);
    }
    
    getBatchSize(): number {
        return Math.round(this.currentBatchSize);
    }
}
```

#### Parallel Processing with Concurrency Control

```typescript
class ConcurrencyController {
    private readonly maxConcurrency: number;
    private activePromises = 0;
    private queue: (() => Promise<any>)[] = [];
    
    constructor(maxConcurrency: number) {
        this.maxConcurrency = maxConcurrency;
    }
    
    async execute<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const wrappedTask = async () => {
                try {
                    this.activePromises++;
                    const result = await task();
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    this.activePromises--;
                    this.processQueue();
                }
            };
            
            if (this.activePromises < this.maxConcurrency) {
                wrappedTask();
            } else {
                this.queue.push(wrappedTask);
            }
        });
    }
    
    private processQueue(): void {
        if (this.queue.length > 0 && this.activePromises < this.maxConcurrency) {
            const task = this.queue.shift()!;
            task();
        }
    }
}

// Usage
const concurrencyController = new ConcurrencyController(5);

async function processItemsConcurrently(items: any[]): Promise<void> {
    const promises = items.map(item => 
        concurrencyController.execute(() => processItem(item))
    );
    
    await Promise.all(promises);
}
```

### Database Connection Optimization

```typescript
// Connection pooling for external APIs
class APIConnectionPool {
    private pool: AxiosInstance[] = [];
    private readonly maxConnections = 10;
    private readonly timeout = 30000;
    
    constructor(baseURL: string, token: string) {
        // Pre-create connections
        for (let i = 0; i < this.maxConnections; i++) {
            this.pool.push(this.createConnection(baseURL, token));
        }
    }
    
    private createConnection(baseURL: string, token: string): AxiosInstance {
        return axios.create({
            baseURL,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: this.timeout,
            // Keep-alive for connection reuse
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true })
        });
    }
    
    getConnection(): AxiosInstance {
        return this.pool[Math.floor(Math.random() * this.pool.length)];
    }
}
```

## CCTs Performance Tuning

### Intelligent Mode Selection

```typescript
class CCTsPerformanceOptimizer {
    private readonly memoryThreshold = 0.7; // 70% of available memory
    private readonly recordCountThreshold = 50000;
    
    async optimizeCCTsMode(recordCount: number, availableMemory: number): Promise<'preload' | 'ondemand'> {
        const estimatedMemoryUsage = this.estimateMemoryUsage(recordCount);
        const memoryUtilization = estimatedMemoryUsage / availableMemory;
        
        console.log(`[CCTs] Records: ${recordCount}, Estimated memory: ${estimatedMemoryUsage}MB, Utilization: ${(memoryUtilization * 100).toFixed(1)}%`);
        
        if (memoryUtilization > this.memoryThreshold || recordCount > this.recordCountThreshold) {
            console.log(`[CCTs] Using on-demand mode due to memory/size constraints`);
            return 'ondemand';
        }
        
        console.log(`[CCTs] Using preload mode for optimal performance`);
        return 'preload';
    }
    
    private estimateMemoryUsage(recordCount: number): number {
        // Each CCT record: ~100 bytes (key + value + Map overhead)
        const bytesPerRecord = 100;
        const totalBytes = recordCount * bytesPerRecord;
        return Math.round(totalBytes / 1024 / 1024); // Convert to MB
    }
}
```

### CCTs Caching Strategies

```typescript
// Multi-level caching for CCTs
class CCTsCache {
    private l1Cache = new Map<string, number>(); // In-memory cache
    private l2Cache = new Map<string, number>(); // Larger, slower cache
    private readonly l1MaxSize = 1000;
    private readonly l2MaxSize = 10000;
    private accessCount = new Map<string, number>();
    
    get(key: string): number | null {
        // Check L1 cache first
        if (this.l1Cache.has(key)) {
            this.recordAccess(key);
            return this.l1Cache.get(key)!;
        }
        
        // Check L2 cache
        if (this.l2Cache.has(key)) {
            const value = this.l2Cache.get(key)!;
            this.promoteToL1(key, value);
            return value;
        }
        
        return null;
    }
    
    set(key: string, value: number): void {
        this.l1Cache.set(key, value);
        this.recordAccess(key);
        
        // Manage L1 cache size
        if (this.l1Cache.size > this.l1MaxSize) {
            this.evictFromL1();
        }
    }
    
    private promoteToL1(key: string, value: number): void {
        this.l1Cache.set(key, value);
        this.recordAccess(key);
        
        if (this.l1Cache.size > this.l1MaxSize) {
            this.evictFromL1();
        }
    }
    
    private evictFromL1(): void {
        // Move least recently used items to L2
        const sortedByAccess = Array.from(this.accessCount.entries())
            .sort((a, b) => a[1] - b[1]);
        
        const toEvict = sortedByAccess.slice(0, Math.floor(this.l1MaxSize * 0.2));
        
        for (const [key] of toEvict) {
            if (this.l1Cache.has(key)) {
                const value = this.l1Cache.get(key)!;
                this.l2Cache.set(key, value);
                this.l1Cache.delete(key);
                
                // Manage L2 cache size
                if (this.l2Cache.size > this.l2MaxSize) {
                    const oldestL2Key = this.l2Cache.keys().next().value;
                    this.l2Cache.delete(oldestL2Key);
                }
            }
        }
    }
    
    private recordAccess(key: string): void {
        this.accessCount.set(key, (this.accessCount.get(key) || 0) + 1);
    }
    
    getStats(): { l1Size: number; l2Size: number; hitRate: number } {
        const totalAccesses = Array.from(this.accessCount.values()).reduce((a, b) => a + b, 0);
        const cacheHits = this.l1Cache.size + this.l2Cache.size;
        
        return {
            l1Size: this.l1Cache.size,
            l2Size: this.l2Cache.size,
            hitRate: totalAccesses > 0 ? (cacheHits / totalAccesses) * 100 : 0
        };
    }
}
```

## API and Network Optimization

### Request Optimization

```typescript
// Optimized API client with retry and circuit breaker
class OptimizedAPIClient {
    private circuitBreaker: CircuitBreaker;
    private requestQueue: RequestQueue;
    
    constructor(baseURL: string, token: string) {
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            recoveryTimeout: 30000
        });
        
        this.requestQueue = new RequestQueue({
            maxConcurrency: 10,
            rateLimitPerSecond: 50
        });
    }
    
    async makeRequest(endpoint: string, data?: any): Promise<any> {
        return this.circuitBreaker.execute(async () => {
            return this.requestQueue.add(async () => {
                const response = await this.api.post(endpoint, data);
                return response.data;
            });
        });
    }
}

// Circuit breaker implementation
class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    
    constructor(private config: { failureThreshold: number; recoveryTimeout: number }) {}
    
    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
                this.state = 'half-open';
            } else {
                throw new Error('Circuit breaker is open');
            }
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    private onSuccess(): void {
        this.failures = 0;
        this.state = 'closed';
    }
    
    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
        
        if (this.failures >= this.config.failureThreshold) {
            this.state = 'open';
        }
    }
}
```

### Response Caching

```typescript
// Response caching with TTL
class ResponseCache {
    private cache = new Map<string, { data: any; expiry: number }>();
    private readonly defaultTTL = 300000; // 5 minutes
    
    get(key: string): any | null {
        const entry = this.cache.get(key);
        
        if (!entry) return null;
        
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.data;
    }
    
    set(key: string, data: any, ttl = this.defaultTTL): void {
        this.cache.set(key, {
            data,
            expiry: Date.now() + ttl
        });
    }
    
    clear(): void {
        this.cache.clear();
    }
    
    size(): number {
        return this.cache.size;
    }
}
```

## Cost Optimization

### Lambda Cost Optimization

```bash
# Cost analysis script
#!/bin/bash

FUNCTION_NAME="apilados-pipeline-ingest"
START_DATE=$(date -d '30 days ago' --iso-8601)
END_DATE=$(date --iso-8601)

# Get invocation metrics
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
    --start-time $START_DATE \
    --end-time $END_DATE \
    --period 86400 \
    --statistics Sum \
    --profile production

# Get duration metrics
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Duration \
    --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
    --start-time $START_DATE \
    --end-time $END_DATE \
    --period 86400 \
    --statistics Average \
    --profile production

# Calculate estimated costs
echo "Calculating Lambda costs..."
INVOCATIONS=$(aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=$FUNCTION_NAME --start-time $START_DATE --end-time $END_DATE --period 2592000 --statistics Sum --query 'Datapoints[0].Sum' --output text --profile production)
AVG_DURATION=$(aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Duration --dimensions Name=FunctionName,Value=$FUNCTION_NAME --start-time $START_DATE --end-time $END_DATE --period 2592000 --statistics Average --query 'Datapoints[0].Average' --output text --profile production)
MEMORY_SIZE=$(aws lambda get-function-configuration --function-name $FUNCTION_NAME --query 'MemorySize' --output text --profile production)

# Cost calculation (approximate)
REQUEST_COST=$(echo "$INVOCATIONS * 0.0000002" | bc -l)
COMPUTE_COST=$(echo "$INVOCATIONS * $AVG_DURATION * $MEMORY_SIZE * 0.0000166667 / 1024" | bc -l)
TOTAL_COST=$(echo "$REQUEST_COST + $COMPUTE_COST" | bc -l)

echo "Monthly Lambda costs:"
echo "  Invocations: $INVOCATIONS"
echo "  Average duration: ${AVG_DURATION}ms"
echo "  Memory size: ${MEMORY_SIZE}MB"
echo "  Request cost: \$${REQUEST_COST}"
echo "  Compute cost: \$${COMPUTE_COST}"
echo "  Total cost: \$${TOTAL_COST}"
```

### S3 Cost Optimization

```bash
# S3 storage optimization
aws s3api put-bucket-lifecycle-configuration \
    --bucket apilados-production-data \
    --lifecycle-configuration '{
        "Rules": [{
            "ID": "CostOptimization",
            "Status": "Enabled",
            "Filter": {"Prefix": "uploads/"},
            "Transitions": [{
                "Days": 30,
                "StorageClass": "STANDARD_IA"
            }, {
                "Days": 90,
                "StorageClass": "GLACIER"
            }, {
                "Days": 365,
                "StorageClass": "DEEP_ARCHIVE"
            }]
        }]
    }' \
    --profile production

# Enable intelligent tiering
aws s3api put-bucket-intelligent-tiering-configuration \
    --bucket apilados-production-data \
    --id EntireBucket \
    --intelligent-tiering-configuration '{
        "Id": "EntireBucket",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "Tierings": [{
            "Days": 1,
            "AccessTier": "ARCHIVE_ACCESS"
        }, {
            "Days": 90,
            "AccessTier": "DEEP_ARCHIVE_ACCESS"
        }]
    }' \
    --profile production
```

## Monitoring and Profiling

### Performance Dashboard

```bash
# Create comprehensive performance dashboard
aws cloudwatch put-dashboard \
    --dashboard-name "Apilados-Performance" \
    --dashboard-body '{
        "widgets": [
            {
                "type": "metric",
                "properties": {
                    "metrics": [
                        ["AWS/Lambda", "Duration", "FunctionName", "apilados-pipeline-ingest"],
                        ["AWS/Lambda", "MemoryUtilization", "FunctionName", "apilados-pipeline-ingest"]
                    ],
                    "period": 300,
                    "stat": "Average",
                    "region": "us-east-1",
                    "title": "Lambda Performance"
                }
            },
            {
                "type": "metric",
                "properties": {
                    "metrics": [
                        ["Apilados/Pipeline/Production", "ExecutionTime"],
                        ["Apilados/Pipeline/Production", "RecordsProcessed"],
                        ["Apilados/Pipeline/Production", "SuccessRate"]
                    ],
                    "period": 300,
                    "stat": "Average",
                    "region": "us-east-1",
                    "title": "Processing Metrics"
                }
            }
        ]
    }' \
    --profile production
```

### Performance Alerts

```bash
# Create performance alerts
aws cloudwatch put-metric-alarm \
    --alarm-name "Apilados-High-Duration" \
    --alarm-description "Alert when execution time exceeds 8 minutes" \
    --metric-name Duration \
    --namespace AWS/Lambda \
    --statistic Average \
    --period 300 \
    --threshold 480000 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=FunctionName,Value=apilados-pipeline-ingest \
    --evaluation-periods 2 \
    --alarm-actions arn:aws:sns:us-east-1:123456789012:performance-alerts \
    --profile production

aws cloudwatch put-metric-alarm \
    --alarm-name "Apilados-High-Memory" \
    --alarm-description "Alert when memory utilization exceeds 80%" \
    --metric-name MemoryUtilization \
    --namespace AWS/Lambda \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=FunctionName,Value=apilados-pipeline-ingest \
    --evaluation-periods 1 \
    --alarm-actions arn:aws:sns:us-east-1:123456789012:performance-alerts \
    --profile production
```

### Performance Testing Framework

```typescript
// Automated performance testing
class PerformanceTester {
    private results: PerformanceResult[] = [];
    
    async runPerformanceTest(testConfig: TestConfig): Promise<PerformanceReport> {
        console.log(`Starting performance test: ${testConfig.name}`);
        
        const startTime = Date.now();
        const startMemory = process.memoryUsage();
        
        try {
            // Run the test
            await this.executeTest(testConfig);
            
            const endTime = Date.now();
            const endMemory = process.memoryUsage();
            
            const result: PerformanceResult = {
                testName: testConfig.name,
                duration: endTime - startTime,
                memoryUsed: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024,
                success: true,
                timestamp: new Date()
            };
            
            this.results.push(result);
            return this.generateReport();
            
        } catch (error) {
            console.error(`Performance test failed: ${error}`);
            throw error;
        }
    }
    
    private generateReport(): PerformanceReport {
        const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;
        const avgMemory = this.results.reduce((sum, r) => sum + r.memoryUsed, 0) / this.results.length;
        
        return {
            totalTests: this.results.length,
            averageDuration: avgDuration,
            averageMemoryUsage: avgMemory,
            successRate: (this.results.filter(r => r.success).length / this.results.length) * 100,
            recommendations: this.generateRecommendations()
        };
    }
    
    private generateRecommendations(): string[] {
        const recommendations: string[] = [];
        const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;
        const avgMemory = this.results.reduce((sum, r) => sum + r.memoryUsed, 0) / this.results.length;
        
        if (avgDuration > 300000) { // 5 minutes
            recommendations.push("Consider increasing Lambda memory or optimizing processing logic");
        }
        
        if (avgMemory > 1000) { // 1GB
            recommendations.push("High memory usage detected - consider using streaming processing");
        }
        
        return recommendations;
    }
}
```

## Performance Optimization Checklist

### Pre-Deployment Optimization

- [ ] Lambda memory size optimized based on profiling
- [ ] Cold start optimization implemented
- [ ] Batch processing configured optimally
- [ ] CCTs mode selection automated
- [ ] API connection pooling enabled
- [ ] Response caching implemented
- [ ] Memory leak detection in place

### Post-Deployment Monitoring

- [ ] Performance dashboards created
- [ ] Performance alerts configured
- [ ] Cost monitoring enabled
- [ ] Regular performance testing scheduled
- [ ] Memory usage trends monitored
- [ ] API response time tracking
- [ ] Throughput optimization validated

### Continuous Optimization

- [ ] Monthly performance reviews
- [ ] Cost optimization analysis
- [ ] Memory usage optimization
- [ ] API efficiency improvements
- [ ] Batch size tuning
- [ ] Caching strategy refinement
- [ ] Performance regression testing

This performance optimization guide ensures the Apilados Pipeline operates at peak efficiency while maintaining cost-effectiveness and reliability.